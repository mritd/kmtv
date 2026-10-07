import XCTest
@testable import KMTV

/// Ports web/src/sync/syncMerge.test.ts so all clients share the same merge behavior.
///
/// 移植自 web/src/sync/syncMerge.test.ts, 保证所有客户端的合并行为一致.
final class SyncMergeTests: XCTestCase {
    private func payload(_ kind: SyncKind, _ key: String) -> SyncPayload {
        switch kind {
        case .watch: .watch(WatchPayload(title: key))
        case .favorite: .favorite(FavoritePayload(title: key))
        case .search: .search(SearchPayload(query: key))
        }
    }

    private func rec(_ kind: SyncKind, _ key: String, _ time: Int64, deleted: Bool = false, dirty: Bool = false, synced: Bool = true) -> LocalRecord {
        LocalRecord(payload: payload(kind, key), key: key, eventTimeMs: time, deleted: deleted, dirty: dirty, synced: synced)
    }

    private func state(_ records: LocalRecord...) -> SyncState {
        SyncState(username: "alice", epoch: "e1", records: Dictionary(uniqueKeysWithValues: records.map { ($0.id, $0) }))
    }

    private func wire(_ kind: SyncKind, _ key: String, _ time: Int64, deleted: Bool = false, payload override: SyncPayload? = nil) -> SyncRecordWire {
        SyncRecordWire(kind: kind, key: key, payload: override ?? payload(kind, key), eventTimeMs: time, deleted: deleted, rev: 1)
    }

    func testCollectChangesOrdersClearsThenOldestDirty() {
        var s = state(
            rec(.watch, "b", 30, dirty: true),
            rec(.favorite, "a", 10, deleted: true, dirty: true),
            rec(.search, "c", 20, dirty: true),
            rec(.search, "clean", 5)
        )
        s.pendingClears = [.search: 15]
        let batch = SyncMerge.collectChanges(s, limit: 3)
        XCTAssertEqual(batch.changes, [
            SyncChangeWire(kind: .search, op: .clear, key: nil, payload: nil, eventTimeMs: 15),
            SyncChangeWire(kind: .favorite, op: .delete, key: "a", payload: nil, eventTimeMs: 10),
            SyncChangeWire(kind: .search, op: .upsert, key: nil, payload: .search(SearchPayload(query: "c")), eventTimeMs: 20),
        ])
        XCTAssertEqual(batch.targets, [nil, "favorite|a", "search|c"])
    }

    func testCollectChangesStopsAtByteBudgetButTakesFirstChange() {
        let long = String(repeating: "\u{4E2D}", count: 400)
        let s = state(
            rec(.search, "a\(long)", 1, dirty: true),
            rec(.search, "b\(long)", 2, dirty: true),
            rec(.search, "c\(long)", 3, dirty: true)
        )
        XCTAssertEqual(SyncMerge.collectChanges(s, maxBytes: 3_000).changes.count, 2)
        XCTAssertEqual(SyncMerge.collectChanges(s, maxBytes: 10).changes.count, 1)
    }

    func testCollectChangesNewestFirstForBackgroundFlush() {
        let s = state(rec(.search, "old", 1, dirty: true), rec(.search, "mid", 2, dirty: true), rec(.search, "new", 3, dirty: true))
        XCTAssertEqual(SyncMerge.collectChanges(s, limit: 2, newestFirst: true).targets, ["search|new", "search|mid"])
    }

    func testAppliedAdoptsCanonicalKeyAndEventTime() {
        let s = state(rec(.search, "Alpha", 10, dirty: true, synced: false))
        let batch = SyncMerge.collectChanges(s)
        let out = SyncMerge.applyPushResults(s, batch: batch, response: SyncPushResponse(
            epoch: "e2", rev: 1, serverTimeMs: 1,
            results: [SyncResultWire(index: 0, status: .applied, record: wire(.search, "alpha", 9))]
        ))
        XCTAssertEqual(out.state.epoch, "e2")
        XCTAssertNil(out.state.records["search|Alpha"])
        XCTAssertEqual(out.state.records["search|alpha"]?.eventTimeMs, 9)
        XCTAssertEqual(out.state.records["search|alpha"]?.dirty, false)
        XCTAssertEqual(out.state.records["search|alpha"]?.synced, true)
    }

    func testEditDuringPushStaysDirty() {
        let batch = SyncMerge.collectChanges(state(rec(.search, "a", 10, dirty: true)))
        let out = SyncMerge.applyPushResults(state(rec(.search, "a", 11, dirty: true)), batch: batch, response: SyncPushResponse(
            epoch: "e1", rev: 1, serverTimeMs: 1,
            results: [SyncResultWire(index: 0, status: .applied, record: wire(.search, "a", 10))]
        ))
        XCTAssertEqual(out.state.records["search|a"]?.dirty, true)
        XCTAssertEqual(out.state.records["search|a"]?.eventTimeMs, 11)
    }

    func testAcknowledgedTombstonesAndClearsAreRemoved() {
        var s = state(rec(.favorite, "x", 10, deleted: true, dirty: true))
        s.pendingClears = [.search: 5]
        let batch = SyncMerge.collectChanges(s)
        let out = SyncMerge.applyPushResults(s, batch: batch, response: SyncPushResponse(
            epoch: "e1", rev: 2, serverTimeMs: 1,
            results: [
                SyncResultWire(index: 0, status: .applied, clear: SyncClearWire(kind: .search, clearedAtMs: 5, rev: 1)),
                SyncResultWire(index: 1, status: .applied, record: wire(.favorite, "x", 10, deleted: true)),
            ]
        ))
        XCTAssertTrue(out.state.pendingClears.isEmpty)
        XCTAssertTrue(out.state.records.isEmpty)
    }

    func testStaleAdoptsServerRecordOrDropsRow() {
        let s = state(rec(.favorite, "x", 10, deleted: true, dirty: true), rec(.search, "gone", 11, dirty: true))
        let batch = SyncMerge.collectChanges(s)
        let out = SyncMerge.applyPushResults(s, batch: batch, response: SyncPushResponse(
            epoch: "e1", rev: 2, serverTimeMs: 1,
            results: [
                SyncResultWire(index: 0, status: .stale, record: wire(.favorite, "x", 20, payload: .favorite(FavoritePayload(title: "X", year: "2021")))),
                SyncResultWire(index: 1, status: .stale, record: nil),
            ]
        ))
        XCTAssertEqual(out.state.records["favorite|x"]?.deleted, false)
        XCTAssertEqual(out.state.records["favorite|x"]?.payload.favorite?.year, "2021")
        XCTAssertNil(out.state.records["search|gone"])
    }

    func testInvalidClearsDirtyAndLimitIsReported() {
        let s = state(rec(.watch, "bad", 10, dirty: true), rec(.favorite, "full", 11, dirty: true))
        let batch = SyncMerge.collectChanges(s)
        let out = SyncMerge.applyPushResults(s, batch: batch, response: SyncPushResponse(
            epoch: "e1", rev: 0, serverTimeMs: 1,
            results: [SyncResultWire(index: 0, status: .invalid, reason: "too long"), SyncResultWire(index: 1, status: .limit)]
        ))
        XCTAssertEqual(out.state.records["watch|bad"]?.dirty, false)
        XCTAssertNil(out.state.records["favorite|full"])
        XCTAssertEqual(out.rejected.map(\.key), ["full"])
        XCTAssertEqual(out.invalid.map(\.record.key), ["bad"])
        XCTAssertEqual(out.invalid.map(\.reason), ["too long"])
    }

    func testPullAppliesClearsBeforeRecordsAndMergeRules() {
        let s = state(
            rec(.search, "old", 5),
            rec(.search, "clean", 50),
            rec(.watch, "dirty-newer", 60, dirty: true),
            rec(.watch, "dirty-older", 40, dirty: true),
            rec(.favorite, "gone", 30)
        )
        var seen = Set<String>()
        let next = SyncMerge.applyPullPage(s, page: SyncPullResponse(
            epoch: "e1", rev: 7,
            clears: [SyncClearWire(kind: .search, clearedAtMs: 10, rev: 3)],
            records: [
                wire(.search, "clean", 55),
                wire(.watch, "dirty-newer", 59),
                wire(.watch, "dirty-older", 41),
                wire(.favorite, "gone", 31, deleted: true),
                wire(.favorite, "fresh", 32),
                wire(.favorite, "never-seen-tombstone", 33, deleted: true),
                SyncRecordWire(kind: nil, key: "x", payload: nil, eventTimeMs: 1),
            ]
        ), seen: &seen)
        XCTAssertNil(next.records["search|old"])
        XCTAssertEqual(next.records["search|clean"]?.eventTimeMs, 55)
        XCTAssertEqual(next.records["watch|dirty-newer"]?.eventTimeMs, 60)
        XCTAssertEqual(next.records["watch|dirty-newer"]?.dirty, true)
        XCTAssertEqual(next.records["watch|dirty-older"]?.eventTimeMs, 41)
        XCTAssertEqual(next.records["watch|dirty-older"]?.dirty, false)
        XCTAssertNil(next.records["favorite|gone"])
        XCTAssertEqual(next.records["favorite|fresh"]?.synced, true)
        XCTAssertNil(next.records["favorite|never-seen-tombstone"])
        XCTAssertEqual(next.cursor, 7)
        XCTAssertEqual(seen, ["favorite|fresh", "search|clean", "watch|dirty-newer", "watch|dirty-older"])
    }

    func testPullSkipsRecordsCoveredByPendingClear() {
        var s = state()
        s.pendingClears = [.search: 20]
        var seen = Set<String>()
        let next = SyncMerge.applyPullPage(s, page: SyncPullResponse(
            epoch: "e1", rev: 2, records: [wire(.search, "before", 20), wire(.search, "after", 21)]
        ), seen: &seen)
        XCTAssertEqual(Array(next.records.keys), ["search|after"])
        XCTAssertEqual(seen, ["search|after"])
    }

    func testFullResyncRemovesOnlySyncedCleanUnseenRows() {
        let s = state(
            rec(.search, "kept", 1),
            rec(.search, "gone", 2),
            rec(.search, "local-only", 3, dirty: true, synced: false),
            rec(.search, "dirty", 4, dirty: true)
        )
        let next = SyncMerge.finishFullResync(s, seen: ["search|kept"])
        XCTAssertEqual(Set(next.records.keys), ["search|dirty", "search|kept", "search|local-only"])
    }

    func testNewEpochMarksEverythingForUpload() {
        var s = state(rec(.favorite, "x", 1))
        s.cursor = 9
        let next = SyncMerge.resetForServerLoss(s, epoch: "e9", username: "alice")
        XCTAssertEqual(next.epoch, "e9")
        XCTAssertEqual(next.cursor, 0)
        XCTAssertEqual(next.username, "alice")
        XCTAssertEqual(next.records["favorite|x"]?.dirty, true)
        XCTAssertEqual(next.records["favorite|x"]?.synced, false)
    }

    func testNewEpochDropsDataOfAnotherUsername() {
        var s = state(rec(.favorite, "x", 1))
        s.cursor = 9
        s.clockOffsetMs = 7
        s.pendingClears = [.search: 3]
        let next = SyncMerge.resetForServerLoss(s, epoch: "e9", username: "bob")
        XCTAssertEqual(next, SyncState(username: "bob", epoch: "e9", clockOffsetMs: 7))
    }

    func testCapsTrimSearchAndListNewestFirst() {
        let records = (0..<52).map { rec(.search, String(format: "q%02d", $0), Int64($0 + 1)) }
        let next = SyncMerge.applyCaps(SyncState(username: "a", records: Dictionary(uniqueKeysWithValues: records.map { ($0.id, $0) })))
        let live = SyncMerge.listLive(next, kind: .search)
        XCTAssertEqual(live.count, 50)
        XCTAssertEqual(live.first?.key, "q51")
        XCTAssertNil(next.records["search|q00"])
        XCTAssertTrue(SyncMerge.listLive(state(rec(.favorite, "x", 1, deleted: true)), kind: .favorite).isEmpty)
    }

    func testTiesBreakByCodePointLikeServerByteOrder() {
        let keys = ["\u{1F600}", "\u{FF5E}", "b"].map { rec(.search, $0, 1) }
        XCTAssertEqual(keys.sorted(by: SyncMerge.compare).map(\.key), ["b", "\u{FF5E}", "\u{1F600}"])
    }
}
