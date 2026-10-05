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
}
