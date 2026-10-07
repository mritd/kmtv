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

extension EpisodeSelectionTests {
    private func twoLineSelection(line: Int, episode: Int) -> EpisodeSelection {
        let detail = VideoDetail(
            id: "v1", title: "Video", type: "", year: "", cover: "", desc: "", director: "", actor: "", area: "",
            episodes: [
                [Episode(name: "第1集", url: "a1"), Episode(name: "第2集", url: "a2"), Episode(name: "第3集", url: "a3")],
                [Episode(name: "EP01", url: "b1")],
            ]
        )
        return EpisodeSelection(detail: detail, sources: [], currentSourceKey: "s1",
                                currentLineIndex: line, currentEpisodeIndex: episode)
    }

    func testClampedIndicesFollowTheClampedLine() {
        XCTAssertTrue(twoLineSelection(line: 0, episode: 2).clampedIndices() == (0, 2))
        XCTAssertTrue(twoLineSelection(line: 5, episode: 2).clampedIndices() == (1, 0))
        XCTAssertTrue(twoLineSelection(line: -1, episode: -3).clampedIndices() == (0, 0))
        let empty = EpisodeSelection(detail: nil, sources: [], currentSourceKey: "s1",
                                     currentLineIndex: 3, currentEpisodeIndex: 4)
        XCTAssertTrue(empty.clampedIndices() == (0, 0))
    }

    func testEpisodeMatchingComparesTheFirstNumber() {
        let selection = twoLineSelection(line: 0, episode: 0)
        XCTAssertEqual(selection.episodeIndex(matchingNumberIn: "EP2"), 1)
        XCTAssertEqual(selection.episodeIndex(matchingNumberIn: "Episode 3 (HD 1080)"), 2)
        XCTAssertNil(selection.episodeIndex(matchingNumberIn: "EP9"))
        XCTAssertNil(selection.episodeIndex(matchingNumberIn: "Finale"))
        // Numbers compare as text, as before: "01" does not match "1".
        //
        // 数字按文本比较, 与此前一致: "01" 不匹配 "1".
        XCTAssertNil(selection.episodeIndex(matchingNumberIn: "EP01"))
    }
}
