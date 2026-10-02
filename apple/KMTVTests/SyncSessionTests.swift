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
        await session.engine?.requestSync(.foreground)
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

    func testSessionStopsSyncingWhenTheActiveUserChanged() async throws {
        let container = try ModelContainerFactory.makeInMemory()
        let api = FakeSyncAPI()
        var activeID: Int64? = 6
        let session = SyncSession(context: container.mainContext, serverURL: "https://kmtv.example",
                                  user: User(id: 5, username: "alice", role: "user", allowAdultContent: false), api: api,
                                  activeUserID: { activeID })
        session.store.upsert(.search(SearchPayload(query: "belongs to alice")))
        session.start()
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertEqual(api.pullCount, 0, "a request for another user must never reach the server")
        XCTAssertTrue(api.pushes.isEmpty)

        activeID = 5
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
