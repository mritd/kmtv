import SwiftData
import XCTest
@testable import KMTV

/// Fake downloads scope recording what the app view model asked for.
///
/// 记录 App 视图模型调用情况的假下载作用域.
@MainActor
final class FakeDownloadScope: DownloadScopeControlling {
    var activated: [String] = []
    var offline: [String] = []
    var deactivations = 0
    var deleted: [String] = []
    var completedScopes: Set<String> = []

    func activate(scopeKey: String, preparer: any DownloadPreparing) async { activated.append(scopeKey) }
    func openOffline(scopeKey: String) { offline.append(scopeKey) }
    func deactivate() async { deactivations += 1 }
    func deleteScope(_ scopeKey: String) async { deleted.append(scopeKey) }
    func hasCompleted(in scopeKey: String) -> Bool { completedScopes.contains(scopeKey) }
}

/// Covers how the app view model drives downloads: identity, activation, offline launch.
///
/// 覆盖 App 视图模型如何驱动下载: 身份, 激活与离线启动.
@MainActor
final class BootstrapOfflineTests: XCTestCase {
    private let serverURL = "https://kmtv.example"
    private var containers: [ModelContainer] = []
    private var defaults: UserDefaults!
    private var scope: FakeDownloadScope!

    private var viewModels: [AppViewModel] = []

    override func setUp() async throws {
        defaults = UserDefaults(suiteName: "BootstrapOfflineTests-\(UUID().uuidString)")
        scope = FakeDownloadScope()
    }

    override func tearDown() async throws {
        for vm in viewModels { vm.sync?.stop() }
        viewModels = []
        URLProtocolStub.requestHandler = nil
    }

    private func makeViewModel(me: @escaping (URLRequest) throws -> (HTTPURLResponse, Data)) throws -> AppViewModel {
        let container = try ModelContainerFactory.makeInMemory()
        containers.append(container)
        container.mainContext.insert(Server(url: serverURL))
        try container.mainContext.save()
        URLProtocolStub.requestHandler = { request in
            let path = request.url?.path ?? ""
            if path == "/api/v1/auth/me" { return try me(request) }
            let body = path == "/api/v1/settings" ? #"{"settings":{"version":"v1.1.0"}}"#
                : #"{"epoch":"e1","server_time_ms":1,"rev":0,"reset":false,"has_more":false,"clears":[],"records":[]}"#
            return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil,
                                    headerFields: ["Content-Type": "application/json"])!, Data(body.utf8))
        }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [URLProtocolStub.self]
        let vm = AppViewModel(modelContext: container.mainContext, session: URLSession(configuration: config),
                              downloads: scope, identityStore: LastIdentityStore(defaults: defaults))
        viewModels.append(vm)
        return vm
    }

    private func ok(_ request: URLRequest) -> (HTTPURLResponse, Data) {
        (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
         Data(#"{"id":5,"username":"alice","role":"user","allow_adult_content":false}"#.utf8))
    }

    func testAuthenticationSavesIdentityAndActivatesScope() async throws {
        let vm = try makeViewModel { self.ok($0) }
        await vm.bootstrap()
        let identity = LastIdentityStore(defaults: defaults).load()
        XCTAssertEqual(identity, DownloadIdentity(serverURL: serverURL, userID: 5, username: "alice"))
        XCTAssertEqual(scope.activated, [syncScopeKey(serverURL: serverURL, userID: 5)])
        await vm.logout()
        XCTAssertNil(LastIdentityStore(defaults: defaults).load())
        XCTAssertGreaterThanOrEqual(scope.deactivations, 1)
    }

    func testAnonymousUserNeitherSavesIdentityNorActivates() async throws {
        let vm = try makeViewModel { request in
            (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
             Data(#"{"id":0,"username":"guest","role":"guest","allow_adult_content":false}"#.utf8))
        }
        await vm.bootstrap()
        XCTAssertNil(LastIdentityStore(defaults: defaults).load())
        XCTAssertTrue(scope.activated.isEmpty)
    }

    func testDifferentUserReplacesIdentityAndActivatesItsScope() async throws {
        LastIdentityStore(defaults: defaults).save(DownloadIdentity(serverURL: serverURL, userID: 5, username: "alice"))
        let vm = try makeViewModel { request in
            (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
             Data(#"{"id":7,"username":"bob","role":"user","allow_adult_content":false}"#.utf8))
        }
        await vm.bootstrap()
        XCTAssertEqual(LastIdentityStore(defaults: defaults).load()?.userID, 7)
        XCTAssertEqual(scope.activated, [syncScopeKey(serverURL: serverURL, userID: 7)])
    }

    func testDroppedSyncScopeDeletesItsDownloads() async throws {
        let vm = try makeViewModel { self.ok($0) }
        await vm.bootstrap()
        vm.sync?.engine?.onScopeDropped?()
        for _ in 0..<50 where scope.deleted.isEmpty { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertEqual(scope.deleted, [syncScopeKey(serverURL: serverURL, userID: 5)])
    }

    private func seedIdentity(server: String = "https://kmtv.example", completed: Bool = true) -> DownloadIdentity {
        let identity = DownloadIdentity(serverURL: server, userID: 5, username: "alice")
        LastIdentityStore(defaults: defaults).save(identity)
        if completed { scope.completedScopes.insert(identity.scopeKey) }
        return identity
    }

    private func failing(_ error: Error) -> (URLRequest) throws -> (HTTPURLResponse, Data) {
        { _ in throw error }
    }

    private func status(_ code: Int, _ body: String) -> (URLRequest) throws -> (HTTPURLResponse, Data) {
        { request in (HTTPURLResponse(url: request.url!, statusCode: code, httpVersion: nil, headerFields: nil)!, Data(body.utf8)) }
    }

    func testUnreachableServerWithDownloadsEntersOffline() async throws {
        let identity = seedIdentity()
        let vm = try makeViewModel(me: failing(URLError(.cannotConnectToHost)))
        await vm.bootstrap()
        guard case .offline(let found) = vm.state else { return XCTFail("expected offline, got \(vm.state)") }
        XCTAssertEqual(found, identity)
        XCTAssertEqual(scope.offline, [identity.scopeKey])
        XCTAssertEqual(vm.sync?.store.scopeKey, identity.scopeKey)
        XCTAssertNil(vm.sync?.engine)
    }

    func testGatewayErrorsAndCaptivePortalsCountAsUnreachable() async throws {
        _ = seedIdentity()
        let gateway = try makeViewModel(me: status(502, "<html>bad gateway</html>"))
        await gateway.bootstrap()
        guard case .offline = gateway.state else { return XCTFail("502 should go offline") }
        let portal = try makeViewModel(me: status(200, "<html>login to wifi</html>"))
        await portal.bootstrap()
        guard case .offline = portal.state else { return XCTFail("captive portal should go offline") }
    }

    func testOfflineNeedsCompletedDownloadsMatchingServerAndReachability() async throws {
        _ = seedIdentity(completed: false)
        let noDownloads = try makeViewModel(me: failing(URLError(.notConnectedToInternet)))
        await noDownloads.bootstrap()
        guard case .serverSetup = noDownloads.state else { return XCTFail("no downloads should go to setup") }

        _ = seedIdentity(server: "https://other.example")
        let otherServer = try makeViewModel(me: failing(URLError(.notConnectedToInternet)))
        await otherServer.bootstrap()
        guard case .serverSetup = otherServer.state else { return XCTFail("other server should go to setup") }

        _ = seedIdentity()
        let unauthorized = try makeViewModel(me: status(401, #"{"code":1002,"error":"not logged in"}"#))
        await unauthorized.bootstrap()
        guard case .serverSetup = unauthorized.state else { return XCTFail("401 should go to setup") }
    }

    func testReconnectLeavesOfflineWhenServerAnswers() async throws {
        _ = seedIdentity()
        var reachable = false
        let vm = try makeViewModel { request in
            guard reachable else { throw URLError(.cannotConnectToHost) }
            return self.ok(request)
        }
        await vm.bootstrap()
        guard case .offline = vm.state else { return XCTFail("expected offline") }
        reachable = true
        await vm.reconnect()
        guard case .authenticated = vm.state else { return XCTFail("expected authenticated, got \(vm.state)") }
        XCTAssertEqual(scope.activated.count, 1)
    }

    func testUnreachableClassification() {
        XCTAssertTrue(BootstrapFailure.isUnreachable(URLError(.timedOut)))
        XCTAssertTrue(BootstrapFailure.isUnreachable(APIError.networkError(URLError(.dnsLookupFailed))))
        XCTAssertTrue(BootstrapFailure.isUnreachable(APIError.serverError(503, 1300, "")))
        XCTAssertTrue(BootstrapFailure.isUnreachable(APIError.decodingError(URLError(.cannotDecodeContentData))))
        XCTAssertFalse(BootstrapFailure.isUnreachable(APIError.serverError(401, 1002, "")))
        XCTAssertFalse(BootstrapFailure.isUnreachable(APIError.serverError(404, 1300, "")))
        XCTAssertFalse(BootstrapFailure.isUnreachable(URLError(.cancelled)))
        XCTAssertFalse(BootstrapFailure.isUnreachable(CancellationError()))
    }
}
