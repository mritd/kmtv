import XCTest
@testable import KMTV

/// Covers per-record increasing event times and server offset estimation.
///
/// 覆盖按记录递增的事件时间与服务端时间差估算.
@MainActor
final class SyncClockTests: XCTestCase {
    func testBeatsThePreviousEventTimeOfTheSameRecord() {
        let clock = SyncClock(offsetMs: 0, now: { 1_000 })
        XCTAssertEqual(clock.next(), 1_000)
        XCTAssertEqual(clock.next(after: 1_000), 1_001)
        XCTAssertEqual(clock.next(after: 5_000), 5_001)
        XCTAssertEqual(clock.next(after: 10), 1_000)
    }

    func testAlignsToServerWithRequestMidpoint() {
        let wall = ManualClock(10_000)
        let clock = SyncClock(offsetMs: 0, now: wall.now)
        clock.observe(serverTimeMs: 15_100, sentAtMs: 10_000, receivedAtMs: 10_200)
        XCTAssertEqual(clock.offsetMs, 5_000)
        wall.nowMs = 10_300
        XCTAssertEqual(clock.next(), 15_300)
    }

    func testStaysMonotonicPerRecordWhenOffsetMovesBack() {
        let wall = ManualClock(10_000)
        let clock = SyncClock(offsetMs: 5_000, now: wall.now)
        let first = clock.next()
        XCTAssertEqual(first, 15_000)
        clock.observe(serverTimeMs: 9_000, sentAtMs: 10_000, receivedAtMs: 10_000)
        wall.nowMs = 10_001
        XCTAssertEqual(clock.next(), 9_001)
        XCTAssertEqual(clock.next(after: first), 15_001)
    }

    func testIgnoresInvalidObservations() {
        let clock = SyncClock(offsetMs: 42, now: { 0 })
        clock.observe(serverTimeMs: 0, sentAtMs: 0, receivedAtMs: 10)
        clock.observe(serverTimeMs: 5_000, sentAtMs: 20, receivedAtMs: 10)
        XCTAssertEqual(clock.offsetMs, 42)
    }
}
