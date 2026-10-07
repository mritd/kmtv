import SwiftData
import XCTest
@testable import KMTV

/// Covers which downloaded episode the show header plays.
///
/// 覆盖剧集头部按钮选择播放哪一集下载.
@MainActor
final class DownloadResumePickerTests: XCTestCase {
    private var container: ModelContainer!

    override func setUp() async throws {
        container = try ModelContainerFactory.makeInMemory()
    }

    private func episodes(_ count: Int, source: String = "a") -> [DownloadEpisode] {
        let show = DownloadShow(scopeKey: "s", title: "Show", cover: "", type: "", year: "", createdAt: .now)
        return (0..<count).map { index in
            let ep = DownloadEpisode(show: show, sourceKey: source, sourceName: source, videoId: "v",
                                     episodeIndex: index, episodeName: "第\(index + 1)集", lineIndex: 0,
                                     episodeCount: count, episodeURL: "u", queueOrder: index, createdAt: .now)
            ep.state = .completed
            container.mainContext.insert(ep)
            return ep
        }
    }

    func testWatchRecordPicksItsEpisode() {
        let eps = episodes(5)
        let watch = WatchPayload(title: "Show", sourceKey: "a", episodeIndex: 3, progressSec: 60, durationSec: 1200)
        let target = DownloadResumePicker.target(episodes: eps, watch: watch)
        XCTAssertEqual(target?.0.episodeIndex, 3)
        XCTAssertEqual(target?.1, true)
    }

    func testFinishedRecordMovesToTheNextDownload() {
        let eps = episodes(5)
        let watch = WatchPayload(title: "Show", sourceKey: "a", episodeIndex: 1, completed: true)
        let target = DownloadResumePicker.target(episodes: eps, watch: watch)
        XCTAssertEqual(target?.0.episodeIndex, 2)
        XCTAssertEqual(target?.1, false)
    }

    func testWithoutRecordTheLastStartedEpisodeContinues() {
        let eps = episodes(5)
        for index in 1...3 { eps[index].positionSec = 2 }
        let target = DownloadResumePicker.target(episodes: eps, watch: nil)
        XCTAssertEqual(target?.0.episodeIndex, 3)
        XCTAssertEqual(target?.1, true)
    }

    func testNothingWatchedPlaysTheFirstEpisode() {
        let eps = episodes(3)
        let target = DownloadResumePicker.target(episodes: eps, watch: nil)
        XCTAssertEqual(target?.0.episodeIndex, 0)
        XCTAssertEqual(target?.1, false)
        XCTAssertNil(DownloadResumePicker.target(episodes: [], watch: nil))
    }

    func testRecordForAnEpisodeNotDownloadedFallsBack() {
        let eps = episodes(3)
        eps[1].positionSec = 30
        let watch = WatchPayload(title: "Show", sourceKey: "a", episodeIndex: 9, progressSec: 10)
        XCTAssertEqual(DownloadResumePicker.target(episodes: eps, watch: watch)?.0.episodeIndex, 1)
    }
}
