import XCTest
@testable import KMTV

/// Covers the per-item checkpoint rules: cadence, the first tick of a new item, the once-per-item
/// outro skip, live-only decisions, the finished record, the rewatch, and the dedupe.
///
/// 覆盖每个 item 的检查点规则: 保存节奏, 新 item 的第一次时间更新, 每个 item 只触发一次的片尾跳过,
/// 仅当前 item 可做的决定, 已看完记录, 重看与去重.
final class PlaybackProgressTrackerTests: XCTestCase {
    private let start = ContinuousClock.now

    func testSavesOnTheFirstTickThenEveryFiveSecondsOfWallClock() {
        var tracker = PlaybackProgressTracker()
        XCTAssertTrue(tracker.tick(current: 10, duration: 1000, isLive: true, skipOutroSeconds: 0, now: start).save)
        XCTAssertFalse(tracker.tick(current: 600, duration: 1000, isLive: true, skipOutroSeconds: 0,
                                    now: start + .seconds(4)).save)
        XCTAssertTrue(tracker.tick(current: 601, duration: 1000, isLive: true, skipOutroSeconds: 0,
                                   now: start + .seconds(5)).save)
    }

    func testANewItemDoesNotSaveOnItsFirstTick() {
        var tracker = PlaybackProgressTracker()
        tracker.beginItem(at: start)
        XCTAssertFalse(tracker.tick(current: 1, duration: 1000, isLive: true, skipOutroSeconds: 0, now: start).save)
        XCTAssertTrue(tracker.tick(current: 6, duration: 1000, isLive: true, skipOutroSeconds: 0,
                                   now: start + .seconds(5)).save)
    }

    func testOnlyTheLiveItemSavesOrSkips() {
        var tracker = PlaybackProgressTracker()
        let tick = tracker.tick(current: 990, duration: 1000, isLive: false, skipOutroSeconds: 30, now: start)
        XCTAssertEqual(tick, PlaybackProgressTracker.Tick())
        // The throttle was not consumed by the outgoing item.
        //
        // 节流器没有被正在离开的 item 消耗.
        XCTAssertTrue(tracker.tick(current: 10, duration: 1000, isLive: true, skipOutroSeconds: 0, now: start).save)
    }

    func testNonFiniteReportsNeverSave() {
        var tracker = PlaybackProgressTracker()
        XCTAssertFalse(tracker.tick(current: .nan, duration: 1000, isLive: true, skipOutroSeconds: 0, now: start).save)
        XCTAssertFalse(tracker.tick(current: 10, duration: .infinity, isLive: true, skipOutroSeconds: 0, now: start).save)
        XCTAssertTrue(tracker.tick(current: 10, duration: 1000, isLive: true, skipOutroSeconds: 0, now: start).save)
    }

    func testTheOutroSkipFiresOncePerItem() {
        var tracker = PlaybackProgressTracker()
        let first = tracker.tick(current: 980, duration: 1000, isLive: true, skipOutroSeconds: 30, now: start)
        XCTAssertEqual(first, PlaybackProgressTracker.Tick(save: true, skipOutro: true))
        XCTAssertFalse(tracker.tick(current: 985, duration: 1000, isLive: true, skipOutroSeconds: 30,
                                    now: start).skipOutro)
        tracker.beginItem(at: start)
        XCTAssertTrue(tracker.tick(current: 985, duration: 1000, isLive: true, skipOutroSeconds: 30,
                                   now: start).skipOutro)
    }

    func testTheDedupeDropsARepeatedCheckpoint() {
        var tracker = PlaybackProgressTracker()
        XCTAssertTrue(tracker.admit("s1|v|0|0|34"))
        XCTAssertFalse(tracker.admit("s1|v|0|0|34"))
        XCTAssertTrue(tracker.admit("s1|v|0|0|35"))
        tracker.forgetLastCheckpoint()
        XCTAssertTrue(tracker.admit("s1|v|0|0|35"))
    }

    func testTheFinishedRecordBlocksLateCheckpointsUntilASeek() {
        var tracker = PlaybackProgressTracker()
        tracker.markEndWritten()
        XCTAssertTrue(tracker.endCheckpointWritten)
        XCTAssertFalse(tracker.admit("s1|v|0|0|999"))
        // A late tick still in the finished zone keeps the block.
        //
        // 仍在看完区内的迟到时间更新保持拦截.
        _ = tracker.tick(current: 999, duration: 1000, isLive: true, skipOutroSeconds: 0, now: start)
        XCTAssertTrue(tracker.endCheckpointWritten)
        tracker.seekStarted()
        XCTAssertFalse(tracker.endCheckpointWritten)
        XCTAssertTrue(tracker.admit("s1|v|0|0|999"))
    }

    func testScrubbingBackOutOfTheFinishedZoneIsARewatchSavedAtOnce() {
        var tracker = PlaybackProgressTracker()
        XCTAssertTrue(tracker.tick(current: 100, duration: 1000, isLive: true, skipOutroSeconds: 0, now: start).save)
        tracker.markEndWritten()

        let tick = tracker.tick(current: 200, duration: 1000, isLive: true, skipOutroSeconds: 0, now: start)

        XCTAssertFalse(tracker.endCheckpointWritten)
        XCTAssertTrue(tick.save, "the rewatch resets the throttle, so it is saved at once")
    }

    func testANewItemClearsTheFinishedRecord() {
        var tracker = PlaybackProgressTracker()
        tracker.markEndWritten()
        tracker.beginItem(at: start)
        XCTAssertFalse(tracker.endCheckpointWritten)
    }
}
