import SwiftData
import XCTest
@testable import KMTV

/// Covers when the app opens the sync store and when it lets the engine talk to the server.
///
/// 覆盖应用何时打开同步存储, 以及何时允许引擎访问服务端.
@MainActor
final class AppViewModelSyncTests: XCTestCase {
    private let serverURL = "https://sync-wiring.example"
    private var containers: [ModelContainer] = []

    override func tearDown() {
        URLProtocolStub.requestHandler = nil
        super.tearDown()
    }

    /// Answers `me` and `settings`, logs every other path, and can hold `settings` until released.
    ///
    /// 响应 `me` 与 `settings`, 记录其他所有路径, 并可让 `settings` 等待放行.
    private func makeViewModel(version: String, log: RequestLog, settingsGate: RequestGate? = nil) throws -> AppViewModel {
        let container = try ModelContainerFactory.makeInMemory()
        containers.append(container)
        container.mainContext.insert(Server(url: serverURL))
        try container.mainContext.save()
        URLProtocolStub.requestHandler = { request in
            let path = request.url?.path ?? ""
            let body: String
            switch path {
            case "/api/v1/auth/me":
                body = #"{"id":5,"username":"alice","role":"user","allow_adult_content":false}"#
            case "/api/v1/settings":
                settingsGate?.wait()
                body = #"{"settings":{"version":"\#(version)"}}"#
            default:
                log.append(path)
                body = #"{"epoch":"e1","server_time_ms":1,"rev":0,"reset":false,"has_more":false,"clears":[],"records":[]}"#
            }
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil,
                                           headerFields: ["Content-Type": "application/json"])!
            return (response, Data(body.utf8))
        }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [URLProtocolStub.self]
        return AppViewModel(modelContext: container.mainContext, session: URLSession(configuration: config))
    }

    private func isAuthenticated(_ vm: AppViewModel) -> Bool {
        if case .authenticated = vm.state { return true }
        return false
    }

    func testBootstrapOpensTheStoreBeforeTheVersionCheckAndThenSyncs() async throws {
        let log = RequestLog()
        let gate = RequestGate()
        defer { gate.open() }
        let vm = try makeViewModel(version: "v1.1.0", log: log, settingsGate: gate)

        let bootstrap = Task { await vm.bootstrap() }
        await waitUntil { self.isAuthenticated(vm) }
        XCTAssertNotNil(vm.sync, "screens must find the store as soon as they appear")
        XCTAssertTrue(log.paths.isEmpty, "the engine must wait for the version check")
        gate.open()
        await bootstrap.value

        await waitUntil { log.paths.contains("/api/v1/sync/pull") }
        XCTAssertTrue(log.paths.contains("/api/v1/sync/pull"))
        vm.sync?.stop()
    }

    func testSyncStopsReachingTheServerWhenTheSignedInUserChanges() async throws {
        let log = RequestLog()
        let vm = try makeViewModel(version: "v1.1.0", log: log)
        await vm.bootstrap()
        await waitUntil { log.paths.contains("/api/v1/sync/pull") }
        let before = log.paths.count
        XCTAssertGreaterThan(before, 0)

        // The app is now signed in as someone else; the session still belongs to alice.
        //
        // 应用现在登录的是别人, 而会话仍属于 alice.
        vm.currentUser = User(id: 6, username: "bob", role: "user", allowAdultContent: false)
        vm.sync?.store.upsert(.search(SearchPayload(query: "alice only")))
        await vm.sync?.engine?.flushNow()
        await vm.sync?.engine?.requestSync(.foreground)
        try await Task.sleep(for: .milliseconds(100))

        XCTAssertEqual(log.paths.count, before, "a session bound to alice must not call the server as bob")
        vm.sync?.stop()
    }

    func testBootstrapSendsNoSyncRequestToAnOlderServer() async throws {
        let log = RequestLog()
        let vm = try makeViewModel(version: "v1.0.6", log: log)

        await vm.bootstrap()
        try await Task.sleep(for: .milliseconds(100))

        guard case .incompatibleServer(let found, let required) = vm.state else {
            return XCTFail("expected the incompatible-server state, got \(vm.state)")
        }
        XCTAssertEqual(found, "v1.0.6")
        XCTAssertEqual(required, "v1.1.0")
        XCTAssertNil(vm.sync)
        XCTAssertTrue(log.paths.isEmpty)
    }

    func testConnectServerChecksTheVersionBeforeSyncing() async throws {
        let log = RequestLog()
        let vm = try makeViewModel(version: "v1.0.6", log: log)

        try await vm.connectServer(url: serverURL, username: "", password: "")
        try await Task.sleep(for: .milliseconds(100))

        guard case .incompatibleServer = vm.state else {
            return XCTFail("expected the incompatible-server state, got \(vm.state)")
        }
        XCTAssertNil(vm.sync)
        XCTAssertTrue(log.paths.isEmpty)
    }

    func testSessionClosedDuringTheVersionCheckIsNotRevived() async throws {
        let log = RequestLog()
        let gate = RequestGate()
        defer { gate.open() }
        let vm = try makeViewModel(version: "v1.0.6", log: log, settingsGate: gate)

        let bootstrap = Task { await vm.bootstrap() }
        await waitUntil { vm.sync != nil }
        vm.disconnectServer()
        gate.open()
        await bootstrap.value
        try await Task.sleep(for: .milliseconds(100))

        guard case .serverSetup = vm.state else {
            return XCTFail("a stale version check must not change the state, got \(vm.state)")
        }
        XCTAssertNil(vm.sync)
        XCTAssertTrue(log.paths.isEmpty)
    }
}

/// Holds stubbed requests until `open()`; after that every request passes.
///
/// 在 `open()` 之前挂起桩请求; 之后所有请求直接通过.
final class RequestGate: @unchecked Sendable {
    private let lock = NSLock()
    private let semaphore = DispatchSemaphore(value: 0)
    private var opened = false

    func wait() {
        lock.lock()
        let passed = opened
        lock.unlock()
        guard !passed else { return }
        semaphore.wait()
        semaphore.signal()
    }

    func open() {
        lock.lock()
        let first = !opened
        opened = true
        lock.unlock()
        if first { semaphore.signal() }
    }
}

/// Request paths seen by the stub, readable from the test while URL loading runs elsewhere.
///
/// 桩记录的请求路径; URL 加载在其他线程运行时, 测试也能读取.
final class RequestLog: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: [String] = []

    func append(_ path: String) {
        lock.lock()
        stored.append(path)
        lock.unlock()
    }

    var paths: [String] {
        lock.lock()
        defer { lock.unlock() }
        return stored
    }
}
