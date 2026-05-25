import XCTest
@testable import KMTV

final class EpisodeSelectionTests: XCTestCase {
    func testEpisodesPreferSelectedDetailLine() {
        let detail = VideoDetail(
            id: "v1", title: "Video", type: "", year: "", cover: "", desc: "",
            director: "", actor: "", area: "",
            episodes: [
                [Episode(name: "EP1", url: "https://cdn1/ep1.m3u8")],
                [Episode(name: "EP1", url: "https://cdn2/ep1.m3u8")]
            ]
        )
        let source = SourceResult(sourceKey: "s1", sourceName: "S1", videoId: "v1", durationMs: 0, episodes: [])
        let selection = EpisodeSelection(
            detail: detail,
            sources: [source],
            currentSourceKey: "s1",
            currentLineIndex: 1,
            currentEpisodeIndex: 0
        )

        XCTAssertEqual(selection.episodes.first?.url, "https://cdn2/ep1.m3u8")
        XCTAssertEqual(selection.currentEpisode?.name, "EP1")
    }

    func testEpisodesFallBackToSearchResultWhenDetailMissing() {
        let episode = Episode(name: "EP1", url: "https://search/ep1.m3u8")
        let source = SourceResult(sourceKey: "s1", sourceName: "S1", videoId: "v1", durationMs: 0, episodes: [episode])
        let selection = EpisodeSelection(
            detail: nil,
            sources: [source],
            currentSourceKey: "s1",
            currentLineIndex: 0,
            currentEpisodeIndex: 0
        )

        XCTAssertEqual(selection.currentEpisode, episode)
    }

    func testEpisodesFallBackToFirstDetailLineWhenLineIndexIsOutOfBounds() {
        let detail = VideoDetail(
            id: "v1", title: "Video", type: "", year: "", cover: "", desc: "",
            director: "", actor: "", area: "",
            episodes: [
                [Episode(name: "EP1", url: "https://cdn1/ep1.m3u8")],
                [Episode(name: "EP1", url: "https://cdn2/ep1.m3u8")]
            ]
        )
        let source = SourceResult(sourceKey: "s1", sourceName: "S1", videoId: "v1", durationMs: 0, episodes: [])
        let selection = EpisodeSelection(
            detail: detail,
            sources: [source],
            currentSourceKey: "s1",
            currentLineIndex: 9,
            currentEpisodeIndex: 0
        )

        XCTAssertEqual(selection.currentEpisode?.url, "https://cdn1/ep1.m3u8")
    }

    func testSourceHelpersReturnCurrentVideoIDAndCleanName() {
        let source = SourceResult(
            sourceKey: "s1",
            sourceName: "source-main",
            videoId: "v1",
            durationMs: 0,
            episodes: []
        )
        let selection = EpisodeSelection(
            detail: nil,
            sources: [source],
            currentSourceKey: "s1",
            currentLineIndex: 0,
            currentEpisodeIndex: 0
        )

        XCTAssertEqual(selection.sourceVideoID(), "v1")
        XCTAssertEqual(selection.sourceName(), "source-main")
    }

    func testSourceHelpersFallbackToSourceKeyWhenSourceMissing() {
        let selection = EpisodeSelection(
            detail: nil,
            sources: [],
            currentSourceKey: "missing",
            currentLineIndex: 0,
            currentEpisodeIndex: 0
        )

        XCTAssertEqual(selection.sourceVideoID(), "")
        XCTAssertEqual(selection.sourceName(), "missing")
    }
}
