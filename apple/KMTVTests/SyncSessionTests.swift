import SwiftUI
import XCTest
@testable import KMTV

/// Covers which identities get an engine and how scene phases drive the engine.
///
/// 覆盖哪些身份拥有同步引擎, 以及场景状态如何驱动引擎.
@MainActor
final class SyncSessionTests: XCTestCase {
    func testAnonymousSessionHasNoEngine() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let session = SyncSession(context: container.mainContext, serverURL: "https://kmtv.example",
                                  user: User(id: 0, username: "anonymous", role: "user", allowAdultContent: false), api: FakeSyncAPI())
        XCTAssertNil(session.engine)
        XCTAssertEqual(session.store.scopeKey, "kmtv.sync.v1:https://kmtv.example:0")
        XCTAssertEqual(session.store.state.username, "")
    }

    func testEngineStaysIdleUntilStarted() async throws {
        let container = try ModelContainerFactory.makeInMemory()
        let api = FakeSyncAPI()
        let session = SyncSession(context: container.mainContext, serverURL: "https://kmtv.example",
                                  user: User(id: 5, username: "alice", role: "user", allowAdultContent: false), api: api)
        session.store.upsert(.search(SearchPayload(query: "before the version check")))
        await session.engine?.flushNow()
        await session.engine?.requestSync(.foreground, waitingAtMost: .milliseconds(20))
        XCTAssertTrue(api.pushes.isEmpty)
        XCTAssertEqual(api.pullCount, 0)

        session.start()
        await waitUntil { api.pullCount == 1 }
        XCTAssertEqual(api.pushes.first?.changes.count, 1)
        session.stop()
    }

    func testForegroundSyncRunsOnlyAfterTheBackground() async throws {
        let container = try ModelContainerFactory.makeInMemory()
        let api = FakeSyncAPI()
        let session = SyncSession(context: container.mainContext, serverURL: "https://kmtv.example",
                                  user: User(id: 5, username: "alice", role: "user", allowAdultContent: false), api: api)
        session.start()
        await waitUntil { api.pullCount == 1 }

        session.handleScenePhase(.inactive)
        session.handleScenePhase(.active)
        try await Task.sleep(for: .milliseconds(50))
        XCTAssertEqual(api.pullCount, 1)

        session.handleScenePhase(.background)
        session.handleScenePhase(.active)
        await waitUntil { api.pullCount == 2 }
        XCTAssertEqual(api.pullCount, 2)
        session.stop()
    }

    func testSignedInSessionSyncsOnLaunchAndFlushesOnBackground() async throws {
        let container = try ModelContainerFactory.makeInMemory()
        let api = FakeSyncAPI()
        let session = SyncSession(context: container.mainContext, serverURL: "https://kmtv.example",
                                  user: User(id: 5, username: "alice", role: "user", allowAdultContent: false), api: api)
        XCTAssertNotNil(session.engine)
        session.start()
        await waitUntil { api.pullCount == 1 }
        XCTAssertEqual(api.pullCount, 1)

        session.store.upsert(.search(SearchPayload(query: "pending")))
        session.handleScenePhase(.background)
        await waitUntil { !api.pushes.isEmpty }
        XCTAssertEqual(api.pushes.first?.changes.count, 1)
        session.stop()
    }

    func testNetworkComingBackSyncsAndStopStopsListening() async throws {
        let container = try ModelContainerFactory.makeInMemory()
        let api = FakeSyncAPI()
        let reachability = FakeReachability()
        let session = SyncSession(context: container.mainContext, serverURL: "https://kmtv.example",
                                  user: User(id: 5, username: "alice", role: "user", allowAdultContent: false), api: api,
                                  reachability: reachability.observe)
        XCTAssertNil(reachability.fire, "nothing listens before the session starts")
        session.start()
        await waitUntil { api.pullCount == 1 }
        XCTAssertNotNil(reachability.fire)

        reachability.fire?()
        await waitUntil { api.pullCount == 2 }
        XCTAssertEqual(api.pullCount, 2)

        session.stop()
        XCTAssertEqual(reachability.cancelled, 1)
    }

    func testBackgroundFlushRunsInsideABackgroundTaskThatEndsOnce() async throws {
        let container = try ModelContainerFactory.makeInMemory()
        let api = FakeSyncAPI()
        let background = FakeBackgroundTask()
        let session = SyncSession(context: container.mainContext, serverURL: "https://kmtv.example",
                                  user: User(id: 5, username: "alice", role: "user", allowAdultContent: false), api: api,
                                  beginBackgroundTask: background.begin)
        session.start()
        await waitUntil { api.pullCount == 1 }

        session.store.upsert(.search(SearchPayload(query: "pending")))
        session.handleScenePhase(.background)
        XCTAssertEqual(background.begun, 1)
        await waitUntil { background.ended == 1 }
        XCTAssertEqual(api.pushes.first?.changes.count, 1)
        XCTAssertEqual(background.ended, 1)

        // The system's time ran out after the flush ended: ending again does nothing.
        //
        // 补写结束后系统时间才用完: 再次结束不会产生影响.
        background.expire?()
        XCTAssertEqual(background.ended, 1)
        session.stop()
    }

    func testBackgroundTaskExpiryEndsTheTaskWhileTheFlushIsStillRunning() async throws {
        let container = try ModelContainerFactory.makeInMemory()
        let api = FakeSyncAPI()
        let background = FakeBackgroundTask()
        let session = SyncSession(context: container.mainContext, serverURL: "https://kmtv.example",
                                  user: User(id: 5, username: "alice", role: "user", allowAdultContent: false), api: api,
                                  beginBackgroundTask: background.begin)
        session.start()
        await waitUntil { api.pullCount == 1 }
        api.pushGate = SyncTestGate()
        session.store.upsert(.search(SearchPayload(query: "pending")))
        session.handleScenePhase(.background)
        await waitUntil { api.pushGate?.waiting == 1 }

        background.expire?()
        XCTAssertEqual(background.ended, 1)
        api.pushGate?.open()
        await waitUntil { api.pullCount == 2 }
        XCTAssertEqual(background.ended, 1, "finishing the flush must not end the task a second time")
        session.stop()
    }

    func testSessionStopsSyncingWhenTheActiveUserChanged() async throws {
        let container = try ModelContainerFactory.makeInMemory()
        let api = FakeSyncAPI()
        var activeID: Int64? = 6
        let session = SyncSession(context: container.mainContext, serverURL: "https://kmtv.example",
                                  user: User(id: 5, username: "alice", role: "user", allowAdultContent: false), api: api,
                                  activeUserID: { activeID })
        let expired = NotificationCounter()
        let observer = NotificationCenter.default.addObserver(forName: .authExpired, object: nil, queue: nil) { _ in
            expired.increment()
        }
        defer { NotificationCenter.default.removeObserver(observer) }
        session.store.upsert(.search(SearchPayload(query: "belongs to alice")))
        session.start()
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertEqual(api.pullCount, 0, "a request for another user must never reach the server")
        XCTAssertTrue(api.pushes.isEmpty)

        // Even once the active user is alice again, the engine that was shut off stays shut off.
        //
        // 即使当前用户又变回 alice, 已被关闭的引擎也保持关闭.
        activeID = 5
        await session.engine?.requestSync(.foreground)
        await session.engine?.flushNow()
        XCTAssertEqual(api.pullCount, 0)
        XCTAssertTrue(api.pushes.isEmpty)
        XCTAssertEqual(expired.count, 0, "a user mismatch must not look like an expired login")

        let matching = SyncSession(context: container.mainContext, serverURL: "https://kmtv.example",
                                   user: User(id: 5, username: "alice", role: "user", allowAdultContent: false), api: api,
                                   activeUserID: { activeID })
        matching.start()
        await waitUntil { api.pullCount == 1 }
        XCTAssertEqual(api.pullCount, 1)
        matching.stop()
        session.stop()
    }
}

/// Counts notifications posted from any thread.
///
/// 统计从任意线程发出的通知数量.
private final class NotificationCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var stored = 0

    var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return stored
    }

    func increment() {
        lock.lock()
        stored += 1
        lock.unlock()
    }
}

/// Reachability fake: `fire` simulates the network coming back.
///
/// 可达性替身: `fire` 模拟网络恢复.
@MainActor
private final class FakeReachability {
    var fire: (@MainActor @Sendable () -> Void)?
    var cancelled = 0

    var observe: SyncReachability {
        { onOnline in
            self.fire = onOnline
            return { self.cancelled += 1 }
        }
    }
}

/// Background task fake that counts begin and end calls and keeps the expiration handler.
///
/// 后台任务替身, 统计开始与结束次数并保存到期回调.
@MainActor
private final class FakeBackgroundTask {
    var begun = 0
    var ended = 0
    var expire: (@MainActor @Sendable () -> Void)?

    var begin: SyncBackgroundTaskStarter {
        { onExpire in
            self.begun += 1
            self.expire = onExpire
            return { self.ended += 1 }
        }
    }
}
