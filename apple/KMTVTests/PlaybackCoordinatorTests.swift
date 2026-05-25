import XCTest
@testable import KMTV

@MainActor
final class PlaybackCoordinatorTests: XCTestCase {
    func testStartCreatesPlayerAndCleanupReleasesIt() {
        let coordinator = PlaybackCoordinator()
        let url = URL(string: "https://media.example/video.m3u8")!

        coordinator.start(
            url: url,
            startTime: 0,
            rate: 1.0,
            onTime: { _, _ in },
            onEnd: {},
            onError: { _ in }
        )

        XCTAssertNotNil(coordinator.player)

        coordinator.cleanup()

        XCTAssertNil(coordinator.player)
    }
}
