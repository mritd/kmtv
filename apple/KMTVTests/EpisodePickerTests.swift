import SwiftData
import XCTest
@testable import KMTV

/// Covers the picker's per-source badges and cross-source hints matched by episode number.
///
/// 覆盖选集 sheet 的按源角标, 以及按集数匹配的跨源提示.
@MainActor
final class EpisodePickerTests: XCTestCase {
    private func download(_ container: ModelContainer, source: String, video: String, index: Int, name: String,
                          state: DownloadState) -> DownloadEpisode {
        let show = DownloadShow(scopeKey: "s", title: "Show", cover: "", type: "", year: "", createdAt: .now)
        let ep = DownloadEpisode(show: show, sourceKey: source, sourceName: "Name-\(source)", videoId: video,
                                 episodeIndex: index, episodeName: name, lineIndex: 0, episodeCount: 10,
                                 episodeURL: "u", queueOrder: index, createdAt: .now)
        ep.state = state
        container.mainContext.insert(ep)
        return ep
    }

    func testBadgesOnlyForCurrentSourceAndVideo() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let eps = [
            download(container, source: "a", video: "v", index: 0, name: "第01集", state: .completed),
            download(container, source: "a", video: "v", index: 1, name: "第02集", state: .downloading),
            download(container, source: "a", video: "v", index: 2, name: "第03集", state: .queued),
            download(container, source: "b", video: "w", index: 3, name: "第04集", state: .completed),
        ]
        let badges = EpisodePickerModel.badges(episodes: eps, sourceKey: "a", videoId: "v") { ep in
            ep.state == .downloading ? .downloading(0.5) : ep.state == .queued ? .queued : .completed
        }
        XCTAssertEqual(badges, [0: .downloaded, 1: .downloading(0.5), 2: .queued])
    }

    func testDownloadingBadgesMoveInFivePercentSteps() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let ep = download(container, source: "a", video: "v", index: 0, name: "第01集", state: .downloading)
        func badge(_ progress: Double) -> EpisodeDownloadBadge? {
            EpisodePickerModel.badges(episodes: [ep], sourceKey: "a", videoId: "v") { _ in .downloading(progress) }[0]
        }
        XCTAssertEqual(badge(0.53), .downloading(0.5))
        XCTAssertEqual(badge(0.549), .downloading(0.5))
        XCTAssertEqual(badge(0.55), .downloading(0.55))
        XCTAssertEqual(badge(0.999), .downloading(0.95))
    }

    func testOtherSourceHintsMatchEpisodeNumbers() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let downloads = [
            download(container, source: "b", video: "w", index: 7, name: "第02集", state: .completed),
            download(container, source: "a", video: "v", index: 0, name: "第01集", state: .completed),
            download(container, source: "b", video: "w", index: 8, name: "预告", state: .completed),
        ]
        let episodes = [Episode(name: "EP1", url: "1"), Episode(name: "EP2", url: "2"), Episode(name: "花絮", url: "3")]
        XCTAssertEqual(EpisodePickerModel.otherSourceHints(episodes: episodes, downloads: downloads, sourceKey: "a"),
                       [1: "Name-b"])
    }
}
