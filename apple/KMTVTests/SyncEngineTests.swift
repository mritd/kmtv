import XCTest
@testable import KMTV

/// Drives push-then-pull cycles against a scripted API and a manual scheduler.
///
/// 使用脚本化 API 与手动调度器驱动 "先推送再拉取" 的同步流程.
@MainActor
final class SyncEngineTests: XCTestCase {
    private let wall = ManualClock(1_790_000_000_000)
    private let offline = APIError.networkError(URLError(.notConnectedToInternet))

    private func setup(_ pulls: [Result<SyncPullResponse, Error>] = [], username: String = "admin", start: Bool = true) throws
        -> (SyncStore, SyncEngine, FakeSyncAPI, FakeSyncScheduler) {
        let store = makeSyncStore(try ModelContainerFactory.makeInMemory(), username: username)
        let api = FakeSyncAPI()
        api.pulls = pulls
        let scheduler = FakeSyncScheduler()
        let engine = SyncEngine(api: api, store: store, now: wall.now, schedule: scheduler.scheduler)
        if start { engine.start() }
        return (store, engine, api, scheduler)
    }

    private func page(_ epoch: String = "e1", rev: Int64 = 0, reset: Bool = false, hasMore: Bool = false,
                      records: [SyncRecordWire] = []) -> Result<SyncPullResponse, Error> {
        .success(SyncPullResponse(epoch: epoch, rev: rev, reset: reset, hasMore: hasMore, records: records))
    }

    func testPushesThenPullsAndApplies() async throws {
        let (store, engine, api, _) = try setup([page(rev: 3, records: [
            SyncRecordWire(kind: .favorite, key: "show x", payload: .favorite(FavoritePayload(title: "Show X")), eventTimeMs: 5, rev: 3),
        ])])
        store.upsert(.search(SearchPayload(query: "Alpha")))

        await engine.requestSync(.launch)

        XCTAssertEqual(api.pushes.first?.epoch, "")
        XCTAssertEqual(api.pushes.first?.cursor, 0)
        XCTAssertEqual(api.pushes.first?.changes.first?.op, .upsert)
        XCTAssertEqual(store.state.records["search|alpha"]?.dirty, false)
        XCTAssertTrue(store.isFavorite(title: "Show X"))
        XCTAssertEqual(store.state.epoch, "e1")
        XCTAssertEqual(store.state.cursor, 3)
        engine.stop()
    }

    func testNewEpochReuploads() async throws {
        // The full pull after the re-upload returns the record, as the real server would.
        //
        // 重新上传后的全量拉取会返回该记录, 与真实服务端一致.
        let kept = SyncRecordWire(kind: .favorite, key: "kept", payload: .favorite(FavoritePayload(title: "Kept")), eventTimeMs: 1_000, rev: 1)
        let (store, engine, api, _) = try setup([page("e2", reset: true), page("e2", rev: 1, records: [kept])])
        store.upsert(.favorite(FavoritePayload(title: "Kept")))
        store.update { state in
            var next = state
            next.epoch = "e1"
            next.cursor = 9
            next.records = state.records.mapValues { var r = $0; r.dirty = false; r.synced = true; return r }
            return next
        }

        await engine.requestSync(.launch)

        XCTAssertEqual(api.pushes.count, 1)
        XCTAssertEqual(api.pushes.first?.epoch, "e2")
        XCTAssertEqual(api.pushes.first?.changes.first?.kind, .favorite)
        XCTAssertEqual(store.state.epoch, "e2")
        XCTAssertEqual(store.state.cursor, 1)
        XCTAssertTrue(store.isFavorite(title: "Kept"))
        engine.stop()
    }

    func testPushConflictIsResolvedThroughPull() async throws {
        let q = SyncRecordWire(kind: .search, key: "q", payload: .search(SearchPayload(query: "q")), eventTimeMs: 1_000, rev: 1)
        let (store, engine, api, _) = try setup([page("e2", reset: true), page("e2", rev: 1, records: [q])])
        store.upsert(.search(SearchPayload(query: "q")))
        store.update { var next = $0; next.epoch = "e1"; next.cursor = 4; return next }
        var first = true
        api.pushHandler = { request in
            if first {
                first = false
                throw APIError.serverError(409, 1210, "sync cursor ahead")
            }
            return SyncPushResponse(epoch: request.epoch, rev: 1, serverTimeMs: 1,
                                    results: request.changes.indices.map { SyncResultWire(index: $0, status: .applied) })
        }

        await engine.requestSync(.launch)

        XCTAssertEqual(api.pushes.count, 2)
        XCTAssertEqual(api.pushes.first?.epoch, "e1")
        XCTAssertEqual(api.pushes.first?.cursor, 4)
        XCTAssertEqual(api.pushes.last?.epoch, "e2")
        XCTAssertEqual(api.pushes.last?.cursor, 0)
        XCTAssertEqual(store.state.records["search|q"]?.dirty, false)
        engine.stop()
    }

    func testNewEpochDropsDataWrittenUnderAnotherUsername() async throws {
        let (store, engine, _, _) = try setup([page("e2", reset: true), page("e2", rev: 1)], username: "bob")
        store.upsert(.search(SearchPayload(query: "someone else")))
        store.update { var next = $0; next.username = "alice"; next.epoch = "e1"; next.cursor = 4; return next }

        await engine.requestSync(.launch)

        // The fake acknowledges the push under the stale epoch; the real server answers 409, so
        // nothing of the other account is stored there. Either way it must not survive or be re-sent.
        //
        // fake 会确认使用旧 epoch 的推送; 真实服务端会返回 409, 因此不会保存另一个账号的数据.
        // 无论哪种情况, 这些数据都不能保留, 也不能被重新推送.
        XCTAssertTrue(store.searchItems.isEmpty)
        XCTAssertFalse(store.state.records.values.contains { $0.dirty })
        XCTAssertEqual(store.state.username, "bob")
        XCTAssertEqual(store.state.epoch, "e2")
        engine.stop()
    }

    func testSameEpochPullRecordsCurrentUsername() async throws {
        let (store, engine, _, _) = try setup([page(rev: 2)], username: "alice2")
        store.update { var next = $0; next.username = "alice"; next.epoch = "e1"; next.cursor = 1; return next }
        await engine.requestSync(.launch)
        XCTAssertEqual(store.state.username, "alice2")
        XCTAssertEqual(store.state.cursor, 2)
        engine.stop()
    }

    func testFirstPullKeepsRecordsThisDevicePushed() async throws {
        let (store, engine, _, _) = try setup([page(rev: 1)])
        store.upsert(.search(SearchPayload(query: "mine")))
        await engine.requestSync(.launch)
        XCTAssertEqual(store.record(.search, key: "mine")?.synced, true)
        engine.stop()
    }

    func testSameEpochResetBelowTheCursorReuploads() async throws {
        // A restore from an older copy: the server's rev (3) is below this device's cursor (9).
        //
        // 从旧副本恢复: 服务端 rev (3) 低于本设备的游标 (9).
        let kept = SyncRecordWire(kind: .favorite, key: "kept", payload: .favorite(FavoritePayload(title: "Kept")), eventTimeMs: 1_000, rev: 4)
        let (store, engine, api, _) = try setup([page(rev: 3, reset: true), page(rev: 5, records: [kept])])
        store.upsert(.favorite(FavoritePayload(title: "Kept")))
        store.update { state in
            var next = state
            next.epoch = "e1"
            next.cursor = 9
            next.records = state.records.mapValues { var r = $0; r.dirty = false; r.synced = true; return r }
            return next
        }

        await engine.requestSync(.launch)

        XCTAssertEqual(api.pushes.count, 1)
        XCTAssertEqual(api.pushes.first?.epoch, "e1")
        XCTAssertEqual(api.pushes.first?.cursor, 0)
        XCTAssertEqual(api.pushes.first?.changes.first?.kind, .favorite)
        XCTAssertEqual(store.state.cursor, 5)
        XCTAssertTrue(store.isFavorite(title: "Kept"))
        engine.stop()
    }

    func testPullsFromCursorZeroAreFullAndDeltaPullsAreNot() async throws {
        let (store, engine, api, _) = try setup([page(rev: 2, hasMore: true), page(rev: 4), page(rev: 5)])
        await engine.requestSync(.launch)
        XCTAssertEqual(api.pullSinces, [0, 2])
        XCTAssertEqual(api.pullFulls, [true, true])

        wall.nowMs += 60_000
        await engine.requestSync(.foreground)
        XCTAssertEqual(api.pullSinces, [0, 2, 4])
        XCTAssertEqual(api.pullFulls, [true, true, false])
        XCTAssertEqual(store.state.cursor, 5)
        engine.stop()
    }

    func testEveryPageOfAFullResyncIsFull() async throws {
        let (store, engine, api, _) = try setup([page(rev: 5, reset: true), page(rev: 3, hasMore: true), page(rev: 5)])
        store.update { var next = $0; next.epoch = "e1"; next.cursor = 1; return next }
        await engine.requestSync(.launch)
        XCTAssertEqual(api.pullSinces, [1, 0, 3])
        XCTAssertEqual(api.pullFulls, [false, true, true])
        engine.stop()
    }

    func testSameEpochResetDropsDataOfAnotherUsername() async throws {
        // The user ID was reused after a restore: rev (3) is below the cursor (9) and the stored
        // username belongs to someone else, so nothing of theirs may be kept or pushed.
        //
        // 恢复后用户 ID 被复用: rev (3) 低于游标 (9), 且已存的用户名属于他人, 因此其数据不能保留或推送.
        let (store, engine, api, _) = try setup([page(rev: 3, reset: true), page(rev: 3)], username: "bob")
        store.upsert(.search(SearchPayload(query: "someone else")))
        store.update { state in
            var next = state
            next.username = "alice"
            next.epoch = "e1"
            next.cursor = 9
            next.records = state.records.mapValues { var r = $0; r.dirty = false; r.synced = true; return r }
            return next
        }

        await engine.requestSync(.launch)

        XCTAssertTrue(store.searchItems.isEmpty)
        XCTAssertTrue(api.pushes.isEmpty)
        XCTAssertEqual(store.state.username, "bob")
        XCTAssertEqual(store.state.epoch, "e1")
        XCTAssertEqual(store.state.cursor, 3)
        engine.stop()
    }

    func testSameEpochResetWithTheSameUsernameStillReuploads() async throws {
        let (store, engine, api, _) = try setup([page(rev: 3, reset: true), page(rev: 3)], username: "alice")
        store.upsert(.search(SearchPayload(query: "mine")))
        store.update { state in
            var next = state
            next.username = "alice"
            next.epoch = "e1"
            next.cursor = 9
            next.records = state.records.mapValues { var r = $0; r.dirty = false; r.synced = true; return r }
            return next
        }

        await engine.requestSync(.launch)

        XCTAssertEqual(api.pushes.first?.changes.first?.kind, .search)
        XCTAssertNotNil(store.record(.search, key: "mine"))
        engine.stop()
    }

    func testFullResyncRemovesUnseenSyncedRows() async throws {
        let (store, engine, _, _) = try setup([page(rev: 2, reset: true), page(rev: 2, records: [
            SyncRecordWire(kind: .search, key: "kept", payload: .search(SearchPayload(query: "kept")), eventTimeMs: 1, rev: 2),
        ])])
        store.update { state in
            var next = state
            next.epoch = "e1"
            next.cursor = 1
            for key in ["kept", "gone"] {
                next.records["search|\(key)"] = LocalRecord(payload: .search(SearchPayload(query: key)), key: key,
                                                             eventTimeMs: 1, deleted: false, dirty: false, synced: true)
            }
            return next
        }

        await engine.requestSync(.launch)

        XCTAssertNotNil(store.record(.search, key: "kept"))
        XCTAssertNil(store.record(.search, key: "gone"))
        engine.stop()
    }

    func testInterruptedFullResyncIsRedoneNotResumed() async throws {
        // The server purged tombstones up to rev 3; page 1 of the full resync reaches rev 3 and the
        // second page fails. The saved cursor must stay below min_rev so the next cycle redoes it.
        //
        // 服务端清理了 rev 3 及之前的墓碑; 全量重同步的第 1 页到达 rev 3, 第 2 页失败. 已保存的游标
        // 必须仍低于 min_rev, 让下一轮重做全量重同步.
        let kept = SyncRecordWire(kind: .search, key: "kept", payload: .search(SearchPayload(query: "kept")), eventTimeMs: 1, rev: 3)
        let (store, engine, api, _) = try setup([
            page(rev: 5, reset: true), page(rev: 3, hasMore: true, records: [kept]), .failure(offline),
            page(rev: 5, reset: true), page(rev: 3, hasMore: true, records: [kept]), page(rev: 5),
        ])
        store.update { state in
            var next = state
            next.epoch = "e1"
            next.cursor = 1
            for key in ["kept", "gone"] {
                next.records["search|\(key)"] = LocalRecord(payload: .search(SearchPayload(query: key)), key: key,
                                                             eventTimeMs: 1, deleted: false, dirty: false, synced: true)
            }
            return next
        }

        await engine.requestSync(.launch)
        XCTAssertEqual(store.state.cursor, 1)
        XCTAssertNotNil(store.record(.search, key: "gone"))

        await engine.requestSync(.foreground)
        XCTAssertEqual(api.pullSinces, [1, 0, 3, 1, 0, 3])
        XCTAssertNil(store.record(.search, key: "gone"))
        XCTAssertNotNil(store.record(.search, key: "kept"))
        XCTAssertEqual(store.state.cursor, 5)
        engine.stop()
    }

    func testUnauthorizedStopsTheEngine() async throws {
        let (_, engine, api, _) = try setup([.failure(APIError.unauthorized)])
        var reported = 0
        engine.onUnauthorized = { reported += 1 }
        await engine.requestSync(.launch)
        await engine.requestSync(.foreground)
        XCTAssertEqual(reported, 1)
        XCTAssertEqual(api.pullCount, 1)
    }

    func testRetryBacksOff() async throws {
        let (_, engine, api, scheduler) = try setup([.failure(offline), .failure(offline)])
        await engine.requestSync(.launch)
        XCTAssertEqual(scheduler.armedDelays, [2_000])

        // Firing the timer starts the retry cycle in its own task; wait for its failure to re-arm.
        //
        // 触发定时器会在独立任务中启动重试; 等待其失败后重新设置定时器.
        scheduler.fireNext()
        await waitUntil { !scheduler.armedDelays.isEmpty }
        XCTAssertEqual(api.pullCount, 2)
        XCTAssertEqual(scheduler.armedDelays, [4_000])
        engine.stop()
        XCTAssertEqual(scheduler.armedDelays, [])
    }

    func testStartResetsTheRetryBackoff() async throws {
        let (_, engine, api, scheduler) = try setup([.failure(offline), .failure(offline), .failure(offline)])
        await engine.requestSync(.launch)
        scheduler.fireNext()
        await waitUntil { !scheduler.armedDelays.isEmpty }
        XCTAssertEqual(scheduler.armedDelays, [4_000])

        engine.stop()
        engine.start()
        await engine.requestSync(.foreground)

        XCTAssertEqual(api.pullCount, 3)
        XCTAssertEqual(scheduler.armedDelays, [2_000])
        engine.stop()
    }

    func testLocalChangesWaitForAPendingRetry() async throws {
        let (store, engine, _, scheduler) = try setup([.failure(offline)])
        await engine.requestSync(.launch)
        XCTAssertEqual(scheduler.armedDelays, [2_000])

        store.upsert(.search(SearchPayload(query: "during backoff")))

        XCTAssertEqual(scheduler.armedDelays, [2_000], "the retry pushes the change; no debounce timer may bypass the backoff")
        engine.stop()
    }

    func testSuccessfulFlushRunsThePendingRetry() async throws {
        let (store, engine, api, scheduler) = try setup([.failure(offline)])
        await engine.requestSync(.launch)
        XCTAssertEqual(api.pullCount, 1)
        XCTAssertEqual(scheduler.armedDelays, [2_000])

        store.upsert(.search(SearchPayload(query: "while offline")))
        await engine.flushNow()
        await waitUntil { api.pullCount == 2 }

        XCTAssertEqual(api.pushes.count, 1)
        XCTAssertEqual(api.pullCount, 2)
        XCTAssertEqual(scheduler.armedDelays, [], "the push proved the server reachable, so the backoff timer is released")
        engine.stop()
    }

    func testStaysIdleUntilStart() async throws {
        let (store, engine, api, scheduler) = try setup(start: false)
        store.upsert(.search(SearchPayload(query: "before start")))
        XCTAssertEqual(scheduler.armedDelays, [])
        await engine.requestSync(.launch)
        await engine.flushNow()
        XCTAssertEqual(api.pushes.count, 0)
        XCTAssertEqual(api.pullCount, 0)

        engine.start()
        engine.start()
        await engine.requestSync(.launch)
        XCTAssertEqual(api.pushes.count, 1)
        XCTAssertEqual(api.pullCount, 1)

        store.upsert(.search(SearchPayload(query: "after start")))
        XCTAssertEqual(scheduler.armedDelays, [2_000])
        scheduler.fireNext()
        await waitUntil { api.pushes.count == 2 }
        XCTAssertEqual(api.pushes.count, 2)
        engine.stop()
    }

    func testStopDuringInFlightRequestLeavesStoreAlone() async throws {
        let (store, engine, api, _) = try setup()
        let gate = SyncTestGate()
        api.pushGate = gate
        store.upsert(.search(SearchPayload(query: "late")))

        let cycle = Task { await engine.requestSync(.launch) }
        await waitUntil { gate.waiting == 1 }
        engine.stop()
        gate.open()
        await cycle.value

        XCTAssertEqual(store.state.records["search|late"]?.dirty, true)
        XCTAssertEqual(store.state.records["search|late"]?.synced, false)
        XCTAssertEqual(store.state.epoch, "")
        XCTAssertEqual(api.pullCount, 0)
    }

    func testFlushResponseAfterStopAndStartIsIgnored() async throws {
        let (store, engine, api, _) = try setup()
        let gate = SyncTestGate()
        api.pushGate = gate
        store.upsert(.search(SearchPayload(query: "late")))

        let flush = Task { await engine.flushNow() }
        await waitUntil { gate.waiting == 1 }
        engine.stop()
        engine.start()
        gate.open()
        await flush.value

        XCTAssertEqual(store.state.records["search|late"]?.dirty, true)
        XCTAssertEqual(store.state.records["search|late"]?.synced, false)
        XCTAssertEqual(store.state.epoch, "")
        engine.stop()
    }

    func testCycleResponseAfterStopAndStartIsIgnored() async throws {
        let (store, engine, api, _) = try setup([page("old", rev: 7)])
        let gate = SyncTestGate()
        api.pullGate = gate

        let cycle = Task { await engine.requestSync(.launch) }
        await waitUntil { gate.waiting == 1 }
        engine.stop()
        engine.start()
        gate.open()
        await cycle.value

        XCTAssertEqual(store.state.epoch, "")
        XCTAssertEqual(store.state.cursor, 0)
        engine.stop()
    }

    func testPageEntryJoinsRunningCycle() async throws {
        let (_, engine, api, _) = try setup()
        let gate = SyncTestGate()
        api.pullGate = gate
        let launch = Task { await engine.requestSync(.launch) }
        await waitUntil { gate.waiting == 1 }
        var pageStarted = false
        let page = Task {
            pageStarted = true
            await engine.requestSync(.page)
        }
        await waitUntil { pageStarted }
        gate.open()
        await launch.value
        await page.value
        XCTAssertEqual(api.pullCount, 1)
        engine.stop()
    }

    func testOverlappingFlushesShareOnePush() async throws {
        let (store, engine, api, _) = try setup()
        let gate = SyncTestGate()
        api.pushGate = gate
        store.upsert(.search(SearchPayload(query: "once")))
        let first = Task { await engine.flushNow() }
        await waitUntil { gate.waiting == 1 }
        var secondStarted = false
        let second = Task {
            secondStarted = true
            await engine.flushNow()
        }
        await waitUntil { secondStarted }
        gate.open()
        await first.value
        await second.value
        XCTAssertEqual(api.pushes.count, 1)
        engine.stop()
    }

    func testJoinedFlushPushesARecordWrittenDuringIt() async throws {
        // The flush hits a conflict and waits for a full cycle. The record lands during the cycle's
        // last pull, after its last push, and the joined flush cancelled the record's push timer, so
        // only one more flush can push it.
        //
        // 补写遇到冲突, 等待完整的一轮同步. 记录在这一轮最后一次推送之后, 最后一次拉取期间写入,
        // 且加入的补写取消了该记录的推送定时器, 因此只有再补写一次才能推送它.
        let (store, engine, api, scheduler) = try setup([page("e2", reset: true), page("e2", rev: 1)])
        store.upsert(.search(SearchPayload(query: "first")))
        store.update { var next = $0; next.epoch = "e1"; next.cursor = 4; return next }
        let gate = SyncTestGate()
        api.pushHandler = { [weak api] request in
            if request.epoch == "e1" { throw APIError.serverError(409, 1209, "sync epoch mismatch") }
            // Hold the pull that follows the cycle's last push.
            //
            // 挂起这一轮最后一次推送之后的拉取.
            api?.pullGate = gate
            return SyncPushResponse(epoch: request.epoch, rev: 1, serverTimeMs: 1,
                                    results: request.changes.indices.map { SyncResultWire(index: $0, status: .applied) })
        }

        let first = Task { await engine.flushNow() }
        await waitUntil { gate.waiting == 1 }
        store.upsert(.watch(WatchPayload(title: "Movie", progressSec: 5, durationSec: 100)))
        var joinedStarted = false
        let joined = Task {
            joinedStarted = true
            await engine.flushNow()
        }
        await waitUntil { joinedStarted }
        gate.open()
        await first.value
        await joined.value

        XCTAssertEqual(api.pushes.last?.changes.map(\.kind), [.watch])
        XCTAssertEqual(store.state.records["watch|movie"]?.dirty, false)
        XCTAssertEqual(store.state.records["watch|movie"]?.synced, true)
        XCTAssertEqual(scheduler.armedDelays, [])
        engine.stop()
    }

    func testJoinedFlushLeavesItsNewRecordToThePendingRetryAfterAFailure() async throws {
        let (store, engine, api, scheduler) = try setup()
        let gate = SyncTestGate()
        api.pushGate = gate
        var calls = 0
        let error = offline
        api.pushHandler = { request in
            calls += 1
            if calls == 1 { throw error }
            return SyncPushResponse(epoch: "e1", rev: 1, serverTimeMs: 1,
                                    results: request.changes.indices.map { SyncResultWire(index: $0, status: .applied) })
        }
        store.upsert(.search(SearchPayload(query: "first")))

        let first = Task { await engine.flushNow() }
        await waitUntil { gate.waiting == 1 }
        store.upsert(.watch(WatchPayload(title: "Movie", progressSec: 5, durationSec: 100)))
        var joinedStarted = false
        let joined = Task {
            joinedStarted = true
            await engine.flushNow()
        }
        await waitUntil { joinedStarted }
        gate.open()
        await first.value
        await joined.value

        // The failed flush armed a retry, so the joined flush must not push again behind its back.
        //
        // 失败的补写已设置重试, 加入的补写不能绕过它再推送一次.
        XCTAssertEqual(api.pushes.count, 1)
        XCTAssertEqual(scheduler.armedDelays, [2_000])

        scheduler.fireNext()
        await waitUntil { store.state.records["watch|movie"]?.dirty == false }

        XCTAssertEqual(api.pushes.count, 2)
        XCTAssertEqual(store.state.records["watch|movie"]?.synced, true)
        engine.stop()
    }

    func testFlushConflictRunsAFullCycle() async throws {
        let q = SyncRecordWire(kind: .search, key: "q", payload: .search(SearchPayload(query: "q")), eventTimeMs: 1_000, rev: 1)
        let (store, engine, api, _) = try setup([page("e2", reset: true), page("e2", rev: 1, records: [q])])
        store.upsert(.search(SearchPayload(query: "q")))
        store.update { var next = $0; next.epoch = "e1"; next.cursor = 4; return next }
        api.pushHandler = { request in
            if request.epoch == "e1" { throw APIError.serverError(409, 1209, "sync epoch mismatch") }
            return SyncPushResponse(epoch: request.epoch, rev: 1, serverTimeMs: 1,
                                    results: request.changes.indices.map { SyncResultWire(index: $0, status: .applied) })
        }

        await engine.flushNow()

        XCTAssertEqual(api.pushes.last?.epoch, "e2")
        XCTAssertEqual(api.pushes.last?.cursor, 0)
        XCTAssertEqual(store.state.epoch, "e2")
        XCTAssertEqual(store.state.records["search|q"]?.dirty, false)
        engine.stop()
    }

    func testPageSyncIsThrottled() async throws {
        let (_, engine, api, _) = try setup()
        await engine.requestSync(.page)
        await engine.requestSync(.page)
        XCTAssertEqual(api.pullCount, 1)
        wall.nowMs += 30_000
        await engine.requestSync(.page)
        XCTAssertEqual(api.pullCount, 2)
        engine.stop()
    }

    func testLocalChangesAreDebouncedAndWatchPushesThrottled() async throws {
        let (store, engine, api, scheduler) = try setup()
        store.upsert(.search(SearchPayload(query: "a")))
        XCTAssertEqual(scheduler.armedDelays, [2_000])
        scheduler.fireNext()
        await engine.requestSync(.change)
        XCTAssertEqual(api.pushes.count, 1)

        store.upsert(.watch(WatchPayload(title: "Movie", progressSec: 5, durationSec: 100)))
        XCTAssertEqual(scheduler.armedDelays, [30_000])
        engine.stop()
    }

    func testFavoriteLimitIsReported() async throws {
        let (store, engine, api, _) = try setup()
        api.pushHandler = { request in
            SyncPushResponse(epoch: "e1", rev: 0, serverTimeMs: 1, results: [SyncResultWire(index: 0, status: .limit)])
        }
        var rejected: [LocalRecord] = []
        engine.onLimit = { rejected = $0 }
        store.upsert(.favorite(FavoritePayload(title: "One Too Many")))
        await engine.requestSync(.launch)
        XCTAssertEqual(rejected.map(\.key), ["one too many"])
        XCTAssertFalse(store.isFavorite(title: "One Too Many"))
        engine.stop()
    }

    func testPlayerWaitReturnsAfterTimeout() async throws {
        let (_, engine, api, _) = try setup()
        api.hangPull = true
        let start = ContinuousClock.now
        await engine.requestSync(.player, waitingAtMost: .milliseconds(50))
        XCTAssertLessThan(ContinuousClock.now - start, .seconds(2))
        engine.stop()
    }
}
