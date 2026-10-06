import XCTest
@testable import KMTV

/// Covers the display state derived from stored state, progress, and the network path.
///
/// 覆盖由持久化状态, 进度与网络路径推导出的展示状态.
@MainActor
final class DownloadDisplayStateTests: XCTestCase {
    private func state(_ stored: DownloadState, reason: DownloadPauseReason? = nil, failure: DownloadFailure? = nil,
                       done: Int = 1, total: Int = 4, preparing: Bool = false, satisfied: Bool = true,
                       expensive: Bool = false, constrained: Bool = false, cellular: Bool = false) -> DownloadDisplayState {
        DownloadManager.displayState(state: stored, pauseReason: reason, failure: failure, done: done, total: total,
                                     preparing: preparing, satisfied: satisfied, expensive: expensive,
                                     constrained: constrained, allowsCellular: cellular)
    }

    func testStoredStatesWin() {
        XCTAssertEqual(state(.completed, satisfied: false), .completed)
        XCTAssertEqual(state(.failed, failure: .sourceStatus(404)), .failed(.sourceStatus(404)))
        XCTAssertEqual(state(.failed), .failed(.network))
        XCTAssertEqual(state(.paused, reason: .signedOut), .paused(.signedOut))
        XCTAssertEqual(state(.paused), .paused(.user))
    }

    func testActiveStatesFollowNetwork() {
        XCTAssertEqual(state(.downloading), .downloading(0.25))
        XCTAssertEqual(state(.downloading, total: 0), .downloading(0))
        XCTAssertEqual(state(.queued), .queued)
        XCTAssertEqual(state(.queued, preparing: true), .preparing)
        XCTAssertEqual(state(.downloading, satisfied: false), .waitingNetwork)
        XCTAssertEqual(state(.downloading, expensive: true), .waitingWiFi)
        XCTAssertEqual(state(.downloading, expensive: true, cellular: true), .downloading(0.25))
        XCTAssertEqual(state(.queued, constrained: true, cellular: true), .waitingWiFi)
    }

    func testMonitorRestoreCallback() {
        let monitor = DownloadNetworkMonitor(start: false)
        var restored = 0
        monitor.onRestore = { restored += 1 }
        monitor.update(satisfied: false, expensive: false, constrained: false)
        monitor.update(satisfied: true, expensive: false, constrained: false)
        monitor.update(satisfied: true, expensive: true, constrained: false)
        XCTAssertEqual(restored, 1)
        XCTAssertTrue(monitor.isExpensive)
    }

    func testBytesFormatting() {
        XCTAssertFalse(DownloadFormatting.bytes(1_200_000_000).isEmpty)
        XCTAssertEqual(DownloadFormatting.duration(3_725), "1:02:05")
        XCTAssertEqual(DownloadFormatting.duration(65), "1:05")
    }
}
