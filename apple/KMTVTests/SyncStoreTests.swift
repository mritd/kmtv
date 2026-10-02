import SwiftData
import XCTest
@testable import KMTV

/// Covers persistence, identity scoping, local writes, clears, and caps of the SwiftData sync store.
///
/// 覆盖 SwiftData 同步存储的持久化, 身份隔离, 本地写入, 清空和上限.
@MainActor
final class SyncStoreTests: XCTestCase {
    func testUpsertPersistsAndReloads() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let store = makeSyncStore(container)
        let saved = store.upsert(.favorite(FavoritePayload(title: "  Show X ", sourceKey: "s")))
        XCTAssertEqual(saved?.key, "show x")
        XCTAssertEqual(saved?.dirty, true)
        XCTAssertEqual(saved?.synced, false)
        XCTAssertEqual(saved?.payload.favorite?.title, "Show X")

        let reopened = makeSyncStore(container)
        XCTAssertTrue(reopened.isFavorite(title: "SHOW X"))
        XCTAssertEqual(reopened.favoriteItems.first?.sourceKey, "s")
        XCTAssertEqual(reopened.scopeKey, "kmtv.sync.v1:https://kmtv.example:1")
    }

    func testBlankKeyIsIgnoredAndSyncedFlagSurvivesEdits() throws {
        let store = makeSyncStore(try ModelContainerFactory.makeInMemory())
        XCTAssertNil(store.upsert(.search(SearchPayload(query: "   "))))
        store.update { state in
            var next = state
            next.records["search|a"] = LocalRecord(payload: .search(SearchPayload(query: "a")), key: "a",
                                                   eventTimeMs: 1, deleted: false, dirty: false, synced: true)
            return next
        }
        XCTAssertEqual(store.upsert(.search(SearchPayload(query: "A")))?.synced, true)
    }

    func testRemoveWritesTombstoneHiddenFromReads() throws {
        let store = makeSyncStore(try ModelContainerFactory.makeInMemory())
        store.upsert(.search(SearchPayload(query: "Alpha")))
        store.remove(.search, key: " ALPHA ")
        XCTAssertNil(store.record(.search, key: "alpha"))
        XCTAssertTrue(store.searchItems.isEmpty)
        XCTAssertEqual(store.state.records["search|alpha"]?.deleted, true)
        XCTAssertEqual(store.state.records["search|alpha"]?.dirty, true)
    }

    func testClearRemovesOneKindAndRecordsPendingClear() throws {
        let store = makeSyncStore(try ModelContainerFactory.makeInMemory())
        store.upsert(.search(SearchPayload(query: "a")))
        store.upsert(.favorite(FavoritePayload(title: "f")))
        store.clear(.search)
        XCTAssertTrue(store.searchItems.isEmpty)
        XCTAssertEqual(store.favoriteItems.count, 1)
        XCTAssertNotNil(store.state.pendingClears[.search])
        XCTAssertNotNil(makeSyncStore(store.contextForTesting.container).state.pendingClears[.search])
    }

    func testStateSavedUnderOlderUsernameIsKeptUntilEpochChanges() throws {
        let container = try ModelContainerFactory.makeInMemory()
        makeSyncStore(container, username: "alice").upsert(.search(SearchPayload(query: "kept")))
        let renamed = makeSyncStore(container, username: "alice2")
        XCTAssertEqual(renamed.username, "alice2")
        XCTAssertEqual(renamed.state.username, "alice")
        XCTAssertEqual(renamed.searchItems.map(\.query), ["kept"])
    }

    func testEachRecordBeatsItsPreviousEventTimeWithFrozenClock() throws {
        let store = makeSyncStore(try ModelContainerFactory.makeInMemory())
        XCTAssertEqual(store.upsert(.search(SearchPayload(query: "a")))?.eventTimeMs, 1_000)
        XCTAssertEqual(store.upsert(.search(SearchPayload(query: "a")))?.eventTimeMs, 1_001)
        XCTAssertEqual(store.upsert(.search(SearchPayload(query: "b")))?.eventTimeMs, 1_000)
        store.remove(.search, key: "a")
        XCTAssertEqual(store.state.records["search|a"]?.eventTimeMs, 1_002)
        store.clear(.search)
        XCTAssertEqual(store.state.pendingClears[.search], 1_003)
        XCTAssertEqual(store.upsert(.search(SearchPayload(query: "c")))?.eventTimeMs, 1_004)
    }

    func testScopesAreIsolatedByServerAndUser() throws {
        let container = try ModelContainerFactory.makeInMemory()
        makeSyncStore(container).upsert(.watch(WatchPayload(title: "T")))
        XCTAssertTrue(makeSyncStore(container, userID: 0, username: "").watchItems.isEmpty)
        XCTAssertTrue(makeSyncStore(container, serverURL: "https://other.example").watchItems.isEmpty)
    }

    func testLocalChangeListenersFireForLocalWritesOnly() throws {
        let store = makeSyncStore(try ModelContainerFactory.makeInMemory())
        var kinds: [SyncKind] = []
        let cancel = store.onLocalChange { kinds.append($0) }
        store.upsert(.search(SearchPayload(query: "a")))
        store.update { $0 }
        store.remove(.favorite, key: "x")
        cancel()
        store.clear(.watch)
        XCTAssertEqual(kinds, [.search, .favorite])
    }

    func testWatchCapTrimsOldest() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let wall = ManualClock()
        let store = SyncStore(context: container.mainContext, serverURL: "https://kmtv.example", userID: 1,
                              username: "admin", clock: SyncClock(offsetMs: 0, now: { wall.nowMs += 1; return wall.nowMs }))
        for index in 0..<201 { store.upsert(.watch(WatchPayload(title: "t\(index)"))) }
        XCTAssertEqual(store.watchItems.count, 200)
        XCTAssertNil(store.watch(title: "t0"))
        XCTAssertEqual(makeSyncStore(container).watchItems.count, 200)
    }
}
