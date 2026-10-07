import XCTest
@testable import KMTV

/// Covers the progress rules both players share.
///
/// 覆盖两个播放器共用的进度规则.
final class PlaybackProgressPolicyTests: XCTestCase {
    func testCompletionIsTheLastThirtySecondsOrNinetyFivePercent() {
        typealias Policy = PlaybackProgressPolicy
        // Under ten minutes the 30-second tail comes before 95 percent.
        //
        // 不到十分钟时, 最后 30 秒先于 95% 到达.
        XCTAssertTrue(Policy.isCompleted(current: 370, duration: 400), "exactly 30 seconds left")
        XCTAssertFalse(Policy.isCompleted(current: 369, duration: 400))
        XCTAssertTrue(Policy.isCompleted(current: 9500, duration: 10000), "95 percent of a long episode")
        XCTAssertFalse(Policy.isCompleted(current: 9400, duration: 10000))
        XCTAssertTrue(Policy.isCompleted(current: 1, duration: 20), "a clip shorter than the tail")
    }

    func testUnknownPositionsNeverComplete() {
        typealias Policy = PlaybackProgressPolicy
        XCTAssertFalse(Policy.isCompleted(current: 0, duration: 1000))
        XCTAssertFalse(Policy.isCompleted(current: 10, duration: 0))
        XCTAssertFalse(Policy.isCompleted(current: .nan, duration: 1000))
        XCTAssertFalse(Policy.isCompleted(current: 990, duration: .infinity))
    }

    func testOutroSkipFiresInsideTheSkippedTailOnly() {
        typealias Policy = PlaybackProgressPolicy
        XCTAssertFalse(Policy.shouldSkipOutro(current: 900, duration: 1000, skipOutroSeconds: 0), "off at 0")
        XCTAssertFalse(Policy.shouldSkipOutro(current: 899, duration: 1000, skipOutroSeconds: 100))
        XCTAssertTrue(Policy.shouldSkipOutro(current: 900, duration: 1000, skipOutroSeconds: 100))
        XCTAssertFalse(Policy.shouldSkipOutro(current: 1000, duration: 1000, skipOutroSeconds: 100),
                       "the end itself belongs to the end notification")
        XCTAssertFalse(Policy.shouldSkipOutro(current: 900, duration: 0, skipOutroSeconds: 100))
    }

    func testUpNextAppearsAMinuteBeforeTheEndOrTheOutro() {
        typealias Policy = PlaybackProgressPolicy
        XCTAssertFalse(Policy.isNearEnd(current: 939, duration: 1000, skipOutroSeconds: 0))
        XCTAssertTrue(Policy.isNearEnd(current: 940, duration: 1000, skipOutroSeconds: 0))
        XCTAssertTrue(Policy.isNearEnd(current: 840, duration: 1000, skipOutroSeconds: 100))
        XCTAssertFalse(Policy.isNearEnd(current: 10, duration: 0, skipOutroSeconds: 0))
    }

    func testSaveThrottleUsesTheInjectedClock() {
        let start = ContinuousClock.now
        var throttle = PlaybackProgressPolicy.SaveThrottle(interval: .seconds(5))
        XCTAssertTrue(throttle.shouldSave(at: start), "the first tick saves")
        XCTAssertFalse(throttle.shouldSave(at: start.advanced(by: .seconds(4))))
        XCTAssertTrue(throttle.shouldSave(at: start.advanced(by: .seconds(5))))

        throttle.restart(at: start.advanced(by: .seconds(20)))
        XCTAssertFalse(throttle.shouldSave(at: start.advanced(by: .seconds(21))), "a new item waits a full period")
        throttle.reset()
        XCTAssertTrue(throttle.shouldSave(at: start.advanced(by: .seconds(21))), "a reset saves at once")
    }
}
