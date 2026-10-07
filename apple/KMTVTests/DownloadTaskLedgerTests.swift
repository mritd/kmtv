import XCTest
@testable import KMTV

/// Covers the task ledger's claims, cancel refcounts, reconcile merge, and refill rule without a
/// transport or storage.
///
/// 在没有传输层与存储的情况下, 覆盖任务账本的占用, 取消计数, 对账合并与补充规则.
final class DownloadTaskLedgerTests: XCTestCase {
    private func id(_ entry: Int, generation: Int = 1, episode: String = "e") -> DownloadTaskID {
        DownloadTaskID(scopeHash: "s", showDir: "h", episodeDir: episode, generation: generation, entryIndex: entry)
    }

    func testClaimReleaseAndRoom() {
        var ledger = DownloadTaskLedger(limit: 3)
        XCTAssertTrue(ledger.hasRoom())
        ledger.claim([id(0), id(1)])
        XCTAssertEqual(ledger.room, 1)
        XCTAssertTrue(ledger.isClaimed(id(0)))
        XCTAssertFalse(ledger.isCancelling(id(0)))
        ledger.claim([id(2)])
        XCTAssertFalse(ledger.hasRoom())
        ledger.release(id(1))
        XCTAssertFalse(ledger.isClaimed(id(1)))
        XCTAssertEqual(ledger.inFlight, [id(0), id(2)])
    }

    func testCancelKeepsIDsClaimedUntilItEnds() {
        var ledger = DownloadTaskLedger(limit: 10)
        ledger.claim([id(0), id(1)])
        let ids: Set = [id(0), id(5)]
        ledger.beginCancel(ids)
        // Claimed whether or not they were in flight, and no longer counted in flight.
        //
        // 无论之前是否处于进行中都被占用, 且不再计入进行中.
        XCTAssertEqual(ledger.inFlight, [id(1)])
        XCTAssertTrue(ledger.isClaimed(id(0)))
        XCTAssertTrue(ledger.isClaimed(id(5)))
        XCTAssertTrue(ledger.isCancelling(id(5)))
        ledger.endCancel(ids)
        XCTAssertFalse(ledger.isClaimed(id(0)))
        XCTAssertFalse(ledger.isCancelling(id(5)))
    }

    func testACancelThatKeepsItsRoomFreesItWhenItEnds() {
        var ledger = DownloadTaskLedger(limit: 2)
        ledger.claim([id(0), id(1)])
        ledger.beginCancel([id(0)], freeingRoom: false)
        XCTAssertFalse(ledger.hasRoom(), "the transport still holds the task being cancelled")
        XCTAssertTrue(ledger.isClaimed(id(0)))
        ledger.endCancel([id(0)])
        XCTAssertTrue(ledger.hasRoom())
        XCTAssertEqual(ledger.inFlight, [id(1)])
    }

    func testOverlappingCancelsReleaseOnTheLastEnd() {
        var ledger = DownloadTaskLedger(limit: 10)
        ledger.beginCancel([id(0)])
        ledger.beginCancel([id(0)])
        ledger.endCancel([id(0)])
        XCTAssertTrue(ledger.isCancelling(id(0)))
        ledger.endCancel([id(0)])
        XCTAssertFalse(ledger.isCancelling(id(0)))
    }

    func testEndCancelDropsAnIDAReconcileAdoptedMeanwhile() {
        var ledger = DownloadTaskLedger(limit: 10)
        ledger.claim([id(0)])
        ledger.beginCancel([id(0)])
        // A reconcile that started after the cancel sees the task still in the transport.
        //
        // 在取消之后开始的对账仍在传输层中看到该任务.
        let token = ledger.beginReconcile()
        let stale = ledger.mergeReconcile(token, outstanding: [id(0)]) { _ in true }
        XCTAssertTrue(stale.isEmpty)
        XCTAssertEqual(ledger.inFlight, [id(0)])
        ledger.endCancel([id(0)])
        XCTAssertTrue(ledger.inFlight.isEmpty)
    }

    func testReconcileKeepsCurrentTasksAndReturnsStaleOnes() {
        var ledger = DownloadTaskLedger(limit: 10)
        ledger.claim([id(0), id(9)])
        let token = ledger.beginReconcile()
        let stale = ledger.mergeReconcile(token, outstanding: [id(0), id(1), id(2)]) { $0.entryIndex != 2 }
        XCTAssertEqual(stale, [id(2)])
        // id(9) was claimed before the await but the transport no longer has it.
        //
        // id(9) 在等待之前已被占用, 但传输层已不再持有它.
        XCTAssertEqual(ledger.inFlight, [id(0), id(1)])
    }

    func testReconcileKeepsTasksClaimedDuringItsAwait() {
        var ledger = DownloadTaskLedger(limit: 10)
        let token = ledger.beginReconcile()
        ledger.claim([id(3)])
        _ = ledger.mergeReconcile(token, outstanding: []) { _ in true }
        XCTAssertEqual(ledger.inFlight, [id(3)])
    }

    func testReconcileSkipsIDsCancelledDuringItsAwait() {
        var ledger = DownloadTaskLedger(limit: 10)
        ledger.claim([id(0), id(1)])
        let token = ledger.beginReconcile()
        ledger.beginCancel([id(0)])
        ledger.endCancel([id(0)])
        // The snapshot predates the cancel; the reconcile neither adopts nor cancels id(0) again.
        //
        // 快照早于取消; 对账既不会重新接管 id(0), 也不会再次取消它.
        let stale = ledger.mergeReconcile(token, outstanding: [id(0), id(1)]) { _ in true }
        XCTAssertTrue(stale.isEmpty)
        XCTAssertEqual(ledger.inFlight, [id(1)])
    }

    func testReconcileKeepsAnIDRecreatedAfterACancelDuringItsAwait() {
        var ledger = DownloadTaskLedger(limit: 10)
        ledger.claim([id(0)])
        let token = ledger.beginReconcile()
        ledger.beginCancel([id(0)])
        ledger.endCancel([id(0)])
        ledger.claim([id(0)])
        let stale = ledger.mergeReconcile(token, outstanding: [id(0)]) { _ in false }
        XCTAssertTrue(stale.isEmpty)
        XCTAssertEqual(ledger.inFlight, [id(0)])
    }

    func testStarvedQueueRefillsInBatches() {
        var ledger = DownloadTaskLedger(limit: 20)
        XCTAssertEqual(ledger.refillBatch, 2)
        XCTAssertFalse(ledger.takeRefill())
        ledger.claim((0..<20).map { id($0) })
        ledger.markStarved()
        XCTAssertFalse(ledger.takeRefill())
        ledger.release(id(0))
        XCTAssertFalse(ledger.takeRefill())
        ledger.release(id(1))
        XCTAssertTrue(ledger.takeRefill())
        XCTAssertFalse(ledger.starved)
        XCTAssertFalse(ledger.takeRefill())
        XCTAssertEqual(DownloadTaskLedger(limit: 5).refillBatch, 1)
    }
}
