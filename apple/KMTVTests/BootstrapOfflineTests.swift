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
    private(set) var activeScopeKey: String?
    /// Calls in order, as `activate:<scope>`, `offline:<scope>`, and `deactivate`.
    ///
    /// 按顺序记录的调用, 形如 `activate:<scope>`, `offline:<scope>` 与 `deactivate`.
    private(set) var events: [String] = []

    func activate(scopeKey: String, preparer: any DownloadPreparing) async {
        activated.append(scopeKey)
        activeScopeKey = scopeKey
        events.append("activate:\(scopeKey)")
    }

    func openOffline(scopeKey: String) {
        offline.append(scopeKey)
        activeScopeKey = scopeKey
        events.append("offline:\(scopeKey)")
    }

    func deactivate() async {
        beginDeactivate()
    }
    @discardableResult
    func beginDeactivate() -> Task<Void, Never> {
        deactivations += 1
        if activeScopeKey != nil {
            activeScopeKey = nil
            events.append("deactivate")
        }
        return Task {}
    }
    func deleteScope(_ scopeKey: String) async { deleted.append(scopeKey) }
    var hasCompletedDownloads: Bool { !completedScopes.isEmpty }
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
    private var log: RequestLog!

    override func setUp() async throws {
        defaults = UserDefaults(suiteName: "BootstrapOfflineTests-\(UUID().uuidString)")
        scope = FakeDownloadScope()
        log = RequestLog()
        AuthStore(serverURL: serverURL).clear()
    }

    override func tearDown() async throws {
        for vm in viewModels { vm.sync?.stop() }
        viewModels = []
        URLProtocolStub.requestHandler = nil
        HeldResponseProtocol.release()
        AuthStore(serverURL: serverURL).clear()
    }

    private func makeViewModel(me: @escaping (URLRequest) throws -> (HTTPURLResponse, Data)) throws -> AppViewModel {
        let container = try ModelContainerFactory.makeInMemory()
        containers.append(container)
        container.mainContext.insert(Server(url: serverURL))
        try container.mainContext.save()
        let log = log!
        URLProtocolStub.requestHandler = { request in
            let path = request.url?.path ?? ""
            log.append(path)
            if path == "/api/v1/auth/me" { return try me(request) }
            if path == "/api/v1/auth/login" {
                return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                        Data(#"{"id":5,"username":"alice","role":"user","access_token":"fresh","expires_at":"2099-01-01T00:00:00Z"}"#.utf8))
            }
            let body = path == "/api/v1/settings" ? #"{"settings":{"version":"v1.1.0"}}"#
                : #"{"epoch":"e1","server_time_ms":1,"rev":0,"reset":false,"has_more":false,"clears":[],"records":[]}"#
            return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil,
                                    headerFields: ["Content-Type": "application/json"])!, Data(body.utf8))
        }
        let config = URLSessionConfiguration.ephemeral
        // Answers like `URLProtocolStub`, and can hold one path until released.
        //
        // 与 `URLProtocolStub` 一样应答, 并可挂起某个路径直到放行.
        config.protocolClasses = [HeldResponseProtocol.self]
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
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertFalse(log.paths.contains { $0.hasPrefix("/api/v1/sync") }, "offline mode never syncs")

        // A sync requested offline (a foreground return, a page) returns at once instead of waiting
        // for a start that never comes.
        let engine = try XCTUnwrap(vm.sync?.engine)
        let clock = ContinuousClock()
        let started = clock.now
        await engine.requestSync(.foreground, waitingAtMost: .seconds(3))
        XCTAssertLessThan(clock.now - started, .seconds(1))
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

    func testOfflineNeedsCompletedDownloadsAndReachability() async throws {
        _ = seedIdentity(completed: false)
        let noDownloads = try makeViewModel(me: failing(URLError(.notConnectedToInternet)))
        await noDownloads.bootstrap()
        guard case .serverSetup = noDownloads.state else { return XCTFail("no downloads should go to setup") }

        // Downloads stay watchable whatever server the app is set up with; the configured server's
        // identity still records watch progress.
        _ = seedIdentity(server: "https://other.example")
        let otherServer = try makeViewModel(me: failing(URLError(.notConnectedToInternet)))
        await otherServer.bootstrap()
        guard case .offline(let found) = otherServer.state else { return XCTFail("other server should go offline") }
        XCTAssertEqual(found, DownloadIdentity(serverURL: serverURL, userID: 5, username: "alice"))

        _ = seedIdentity()
        let unauthorized = try makeViewModel(me: status(401, #"{"code":1002,"error":"not logged in"}"#))
        await unauthorized.bootstrap()
        guard case .serverSetup = unauthorized.state else { return XCTFail("401 should go to setup") }
    }

    func testRejectedSavedTokenSaysTheSessionExpired() async throws {
        let store = AuthStore(serverURL: serverURL)
        try store.save(accessToken: "stale", expiresAt: .now.addingTimeInterval(3600))
        defer { store.clear() }
        ToastManager.shared.currentMessage = nil
        let vm = try makeViewModel(me: status(401, #"{"code":1002,"error":"not logged in"}"#))
        await vm.bootstrap()
        // `.authExpired` is handled in a main-actor task after the request fails.
        for _ in 0..<50 where ToastManager.shared.currentMessage == nil {
            try await Task.sleep(for: .milliseconds(20))
        }
        guard case .serverSetup = vm.state else { return XCTFail("expected setup, got \(vm.state)") }
        XCTAssertEqual(ToastManager.shared.currentMessage,
                       String(localized: "Session expired, please sign in again", bundle: .main))
    }

    func testUnauthorizedWithoutATokenSaysAnonymousAccessIsOff() async throws {
        AuthStore(serverURL: serverURL).clear()
        ToastManager.shared.currentMessage = nil
        let vm = try makeViewModel(me: status(401, #"{"code":1002,"error":"not logged in"}"#))
        await vm.bootstrap()
        guard case .serverSetup = vm.state else { return XCTFail("expected setup, got \(vm.state)") }
        XCTAssertEqual(ToastManager.shared.currentMessage,
                       String(localized: "Anonymous access is disabled, please sign in", bundle: .main))
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

    func testFailedReconnectFromOfflineReleasesTheOfflineScope() async throws {
        let identity = seedIdentity()
        var answer: (URLRequest) throws -> (HTTPURLResponse, Data) = failing(URLError(.cannotConnectToHost))
        let vm = try makeViewModel { try answer($0) }
        await vm.bootstrap()
        guard case .offline = vm.state else { return XCTFail("expected offline") }
        answer = status(401, #"{"code":1002,"error":"not logged in"}"#)
        await vm.reconnect()
        guard case .serverSetup = vm.state else { return XCTFail("expected setup, got \(vm.state)") }
        XCTAssertNil(scope.activeScopeKey)
        XCTAssertEqual(scope.events, ["offline:\(identity.scopeKey)", "deactivate"])
    }

    func testReconnectAsAnotherUserReleasesTheOfflineScopeBeforeAuthenticating() async throws {
        let identity = seedIdentity()
        var reachable = false
        let vm = try makeViewModel { request in
            guard reachable else { throw URLError(.cannotConnectToHost) }
            return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                    Data(#"{"id":7,"username":"bob","role":"user","allow_adult_content":false}"#.utf8))
        }
        await vm.bootstrap()
        reachable = true
        await vm.reconnect()
        guard case .authenticated = vm.state else { return XCTFail("expected authenticated, got \(vm.state)") }
        let bob = syncScopeKey(serverURL: serverURL, userID: 7)
        XCTAssertEqual(scope.events, ["offline:\(identity.scopeKey)", "deactivate", "activate:\(bob)"])
    }

    func testReconnectAsTheSameUserKeepsTheScope() async throws {
        let identity = seedIdentity()
        var reachable = false
        let vm = try makeViewModel { request in
            guard reachable else { throw URLError(.cannotConnectToHost) }
            return self.ok(request)
        }
        await vm.bootstrap()
        reachable = true
        await vm.reconnect()
        XCTAssertEqual(scope.events, ["offline:\(identity.scopeKey)", "activate:\(identity.scopeKey)"])
    }

    func testIncompatibleServerReleasesTheOfflineScope() async throws {
        let identity = seedIdentity()
        var reachable = false
        let vm = try makeViewModel { request in
            guard reachable else { throw URLError(.cannotConnectToHost) }
            return self.ok(request)
        }
        await vm.bootstrap()
        reachable = true
        let handler = URLProtocolStub.requestHandler
        URLProtocolStub.requestHandler = { request in
            guard request.url?.path == "/api/v1/settings" else { return try handler!(request) }
            return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil,
                                    headerFields: ["Content-Type": "application/json"])!,
                    Data(#"{"settings":{"version":"v0.0.1"}}"#.utf8))
        }
        await vm.reconnect()
        guard case .incompatibleServer = vm.state else { return XCTFail("expected incompatible, got \(vm.state)") }
        XCTAssertNil(scope.activeScopeKey)
        XCTAssertEqual(scope.events, ["offline:\(identity.scopeKey)", "deactivate"])
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

    func testHangingServerTimesOutIntoOfflineWhenDownloadsExist() async throws {
        _ = seedIdentity()
        let vm = try makeViewModel(me: failing(URLProtocolStub.Hang()))
        vm.bootstrapTimeout = .milliseconds(200)
        await vm.bootstrap()
        guard case .offline = vm.state else { return XCTFail("expected offline, got \(vm.state)") }
    }

    func testHangingServerWithoutDownloadsGoesToSetup() async throws {
        _ = seedIdentity(completed: false)
        let vm = try makeViewModel(me: failing(URLProtocolStub.Hang()))
        vm.bootstrapTimeout = .milliseconds(200)
        await vm.bootstrap()
        guard case .serverSetup = vm.state else { return XCTFail("expected setup, got \(vm.state)") }
    }

    func testOfflineNeedsACompletedDownload() async throws {
        _ = seedIdentity(completed: false)
        let none = try makeViewModel(me: failing(URLError(.notConnectedToInternet)))
        XCTAssertFalse(none.hasOfflineDownloads)
        none.openDownloadsOffline()
        guard case .loading = none.state else { return XCTFail("expected no change, got \(none.state)") }

        _ = seedIdentity()
        let vm = try makeViewModel(me: failing(URLError(.notConnectedToInternet)))
        XCTAssertTrue(vm.hasOfflineDownloads)
    }

    func testDownloadsWithoutAKnownIdentityStillOpenOffline() async throws {
        scope.completedScopes.insert(syncScopeKey(serverURL: "https://gone.example", userID: 3))
        let vm = try makeViewModel(me: failing(URLError(.notConnectedToInternet)))
        await vm.bootstrap()
        guard case .offline(let found) = vm.state else { return XCTFail("expected offline, got \(vm.state)") }
        XCTAssertNil(found, "no identity: the library opens without a local watch store")
        XCTAssertNil(vm.sync)
        XCTAssertTrue(scope.offline.isEmpty)
    }

    func testOpeningOfflineDuringBootstrapDropsTheBootstrapResult() async throws {
        let identity = seedIdentity()
        let vm = try makeViewModel(me: failing(URLProtocolStub.Hang()))
        vm.bootstrapTimeout = .milliseconds(300)
        let running = Task { await vm.bootstrap() }
        try await Task.sleep(for: .milliseconds(50))
        vm.openDownloadsOffline()
        await running.value
        guard case .offline(let found) = vm.state else { return XCTFail("expected offline, got \(vm.state)") }
        XCTAssertEqual(found, identity)
        // The timed-out bootstrap must not open the scope a second time or replace the screen.
        XCTAssertEqual(scope.offline, [identity.scopeKey])
    }

    func testLogoutKeepsDownloadsWatchableOffline() async throws {
        let vm = try makeViewModel { self.ok($0) }
        await vm.bootstrap()
        let identity = DownloadIdentity(serverURL: serverURL, userID: 5, username: "alice")
        scope.completedScopes.insert(identity.scopeKey)
        await vm.logout()
        XCTAssertNil(LastIdentityStore(defaults: defaults).load())
        XCTAssertTrue(vm.hasOfflineDownloads)
        vm.openDownloadsOffline()
        guard case .offline(let found) = vm.state else { return XCTFail("expected offline, got \(vm.state)") }
        XCTAssertNil(found, "a signed-out account must not record offline progress")
        XCTAssertNil(vm.sync)
    }

    func testUnreachablePrefersTheIdentityOfTheConfiguredServer() async throws {
        let here = seedIdentity()
        let elsewhere = seedIdentity(server: "https://other.example")
        let vm = try makeViewModel(me: failing(URLError(.notConnectedToInternet)))
        XCTAssertNil(vm.offlineIdentity(serverURL: "https://third.example"), "another server's account is never used")
        XCTAssertEqual(vm.offlineIdentity(serverURL: "https://other.example"), elsewhere)
        await vm.bootstrap()
        guard case .offline(let found) = vm.state else { return XCTFail("expected offline, got \(vm.state)") }
        XCTAssertEqual(found, here)
    }

    func testKnownIdentitiesMigrateFromTheLastIdentity() {
        let identity = DownloadIdentity(serverURL: serverURL, userID: 9, username: "carol")
        let data = try! JSONEncoder().encode(identity)
        defaults.set(data, forKey: LastIdentityStore.key)
        let store = LastIdentityStore(defaults: defaults)
        XCTAssertEqual(store.known(), [identity])
        store.clear()
        XCTAssertNil(store.load())
        XCTAssertEqual(store.known(), [identity], "signing out keeps the identity for offline viewing")
    }

    // MARK: - Session lifecycle

    private var context: ModelContext { containers.last!.mainContext }

    private func waitUntil(_ condition: () -> Bool) async throws {
        for _ in 0..<100 where !condition() { try await Task.sleep(for: .milliseconds(20)) }
    }

    func testLogoutDuringBootstrapDropsTheLateUser() async throws {
        let vm = try makeViewModel { self.ok($0) }
        HeldResponseProtocol.hold("/api/v1/auth/me")
        let running = Task { await vm.bootstrap() }
        try await waitUntil { HeldResponseProtocol.heldCount > 0 }
        await vm.logout()
        HeldResponseProtocol.release()
        await running.value
        try await Task.sleep(for: .milliseconds(100))
        guard case .serverSetup = vm.state else { return XCTFail("expected setup, got \(vm.state)") }
        XCTAssertNil(vm.currentUser)
        XCTAssertNil(vm.apiClient)
        XCTAssertNil(vm.sync)
        XCTAssertTrue(scope.activated.isEmpty, "a session the user left must not activate downloads")
        XCTAssertNil(LastIdentityStore(defaults: defaults).load())
        XCTAssertNil(Server.current(in: context))
    }

    func testAuthExpiredForAnOldTokenKeepsTheSession() async throws {
        let vm = try makeViewModel { self.ok($0) }
        try await vm.connectServer(url: serverURL, username: "alice", password: "secret")
        guard case .authenticated = vm.state else { return XCTFail("expected authenticated, got \(vm.state)") }
        ToastManager.shared.currentMessage = nil

        // A request sent with the previous session's token comes back 401 after the new sign-in.
        //
        // 用上一个会话的 token 发出的请求在新登录之后返回 401.
        NotificationCenter.default.post(name: .authExpired, object: nil,
                                        userInfo: [Notification.rejectedTokenKey: "previous"])
        try await Task.sleep(for: .milliseconds(100))
        guard case .authenticated = vm.state else { return XCTFail("a stale 401 ended the session: \(vm.state)") }
        XCTAssertNil(ToastManager.shared.currentMessage)

        NotificationCenter.default.post(name: .authExpired, object: nil,
                                        userInfo: [Notification.rejectedTokenKey: "fresh"])
        try await waitUntil { if case .serverSetup = vm.state { true } else { false } }
        guard case .serverSetup = vm.state else { return XCTFail("the current token's 401 must end the session") }
        XCTAssertEqual(ToastManager.shared.currentMessage,
                       String(localized: "Session expired, please sign in again", bundle: .main))
        XCTAssertNil(AuthStore(serverURL: serverURL).load())
    }

    func testExpiredSavedTokenSaysTheSessionExpired() async throws {
        let store = AuthStore(serverURL: serverURL)
        try store.save(accessToken: "old", expiresAt: .now.addingTimeInterval(-60))
        ToastManager.shared.currentMessage = nil
        let vm = try makeViewModel(me: status(401, #"{"code":1002,"error":"not logged in"}"#))
        await vm.bootstrap()
        guard case .serverSetup = vm.state else { return XCTFail("expected setup, got \(vm.state)") }
        XCTAssertEqual(ToastManager.shared.currentMessage,
                       String(localized: "Session expired, please sign in again", bundle: .main))
        XCTAssertEqual(store.read(), .missing, "the expired credential is cleared once handled")
    }

    func testExpiredSavedTokenWhileOfflineIsReportedOnTheNextConnect() async throws {
        _ = seedIdentity()
        let store = AuthStore(serverURL: serverURL)
        try store.save(accessToken: "old", expiresAt: .now.addingTimeInterval(-60))
        var reachable = false
        let vm = try makeViewModel { request in
            guard reachable else { throw URLError(.cannotConnectToHost) }
            return (HTTPURLResponse(url: request.url!, statusCode: 401, httpVersion: nil, headerFields: nil)!,
                    Data(#"{"code":1002,"error":"not logged in"}"#.utf8))
        }
        await vm.bootstrap()
        guard case .offline = vm.state else { return XCTFail("expected offline, got \(vm.state)") }
        ToastManager.shared.currentMessage = nil
        reachable = true
        await vm.reconnect()
        guard case .serverSetup = vm.state else { return XCTFail("expected setup, got \(vm.state)") }
        XCTAssertEqual(ToastManager.shared.currentMessage,
                       String(localized: "Session expired, please sign in again", bundle: .main))
    }

    func testFailedConnectKeepsThePreviousServer() async throws {
        let store = AuthStore(serverURL: serverURL)
        try store.save(accessToken: "kept", expiresAt: .now.addingTimeInterval(3600))
        let vm = try makeViewModel { self.ok($0) }
        URLProtocolStub.requestHandler = { _ in throw URLError(.cannotFindHost) }
        do {
            try await vm.connectServer(url: "https://typo.example", username: "", password: "")
            XCTFail("expected the connect to fail")
        } catch {}
        XCTAssertEqual(Server.current(in: context)?.url, serverURL)
        XCTAssertEqual(store.load()?.accessToken, "kept")
        XCTAssertNil(vm.apiClient)
        XCTAssertNil(vm.currentUser)
    }

    func testConnectFinishingAfterChoosingOfflineKeepsOfflineMode() async throws {
        let identity = seedIdentity()
        let vm = try makeViewModel { self.ok($0) }
        HeldResponseProtocol.hold("/api/v1/auth/me")
        let connect = Task { try await vm.connectServer(url: "https://new.example", username: "", password: "") }
        try await waitUntil { HeldResponseProtocol.heldCount > 0 }
        vm.openDownloadsOffline()
        HeldResponseProtocol.release()
        let result = await connect.result
        XCTAssertThrowsError(try result.get()) { XCTAssertTrue($0 is CancellationError, "got \($0)") }
        guard case .offline(let found) = vm.state else { return XCTFail("expected offline, got \(vm.state)") }
        XCTAssertEqual(found, identity)
        XCTAssertEqual(scope.events, ["offline:\(identity.scopeKey)"])
        XCTAssertEqual(Server.current(in: context)?.url, serverURL, "a dropped connect replaces nothing")
    }

    func testCancellingConnectStopsTheRequest() async throws {
        let vm = try makeViewModel(me: failing(URLProtocolStub.Hang()))
        let start = ContinuousClock.now
        let connect = Task { try await vm.connectServer(url: serverURL, username: "", password: "") }
        try await Task.sleep(for: .milliseconds(100))
        connect.cancel()
        let result = await connect.result
        XCTAssertThrowsError(try result.get()) { XCTAssertTrue($0 is CancellationError, "got \($0)") }
        XCTAssertLessThan(ContinuousClock.now - start, .seconds(3), "cancel must not wait for the connect timeout")
        guard case .loading = vm.state else { return XCTFail("a cancelled connect changes nothing, got \(vm.state)") }
    }

    func testConnectTimeoutReportsTimedOut() async throws {
        let vm = try makeViewModel(me: failing(URLProtocolStub.Hang()))
        vm.connectTimeout = .milliseconds(200)
        do {
            try await vm.connectServer(url: serverURL, username: "", password: "")
            XCTFail("expected a timeout")
        } catch let error as URLError {
            XCTAssertEqual(error.code, .timedOut)
        }
    }

    func testReconnectAsTheSameUserReusesTheStore() async throws {
        _ = seedIdentity()
        var reachable = false
        let vm = try makeViewModel { request in
            guard reachable else { throw URLError(.cannotConnectToHost) }
            return self.ok(request)
        }
        await vm.bootstrap()
        let offlineStore = try XCTUnwrap(vm.sync?.store)
        reachable = true
        await vm.reconnect()
        guard case .authenticated = vm.state else { return XCTFail("expected authenticated, got \(vm.state)") }
        XCTAssertTrue(vm.sync?.store === offlineStore, "one scope must have one store")
        await vm.reconnect()
        XCTAssertTrue(vm.sync?.store === offlineStore)
    }
}

/// Answers through `URLProtocolStub.requestHandler`, but holds requests for one path until
/// `release()`, without blocking URL loading, so other requests keep flowing meanwhile.
///
/// 通过 `URLProtocolStub.requestHandler` 应答, 但会挂起某个路径的请求直到 `release()`; 挂起时不阻塞
/// URL 加载, 其他请求照常进行.
final class HeldResponseProtocol: URLProtocol {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var heldPath: String?
    nonisolated(unsafe) private static var held: [(HeldResponseProtocol, CFRunLoop)] = []

    /// Holds every later request for `path`.
    ///
    /// 挂起之后所有 `path` 的请求.
    static func hold(_ path: String) {
        lock.withLock { heldPath = path }
    }

    /// Number of requests held right now.
    ///
    /// 当前被挂起的请求数.
    static var heldCount: Int { lock.withLock { held.count } }

    /// Stops holding and answers every held request.
    ///
    /// 停止挂起并应答所有被挂起的请求.
    static func release() {
        let pending = lock.withLock { () -> [(HeldResponseProtocol, CFRunLoop)] in
            defer { held = []; heldPath = nil }
            return held
        }
        for (request, loop) in pending {
            CFRunLoopPerformBlock(loop, CFRunLoopMode.commonModes.rawValue) { request.answer() }
            CFRunLoopWakeUp(loop)
        }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let holds = Self.lock.withLock { () -> Bool in
            guard request.url?.path == Self.heldPath else { return false }
            Self.held.append((self, CFRunLoopGetCurrent()))
            return true
        }
        if !holds { answer() }
    }

    override func stopLoading() {}

    private func answer() {
        guard let handler = URLProtocolStub.requestHandler else { return }
        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch is URLProtocolStub.Hang {
            return
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }
}
