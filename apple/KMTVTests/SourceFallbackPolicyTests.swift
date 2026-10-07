import XCTest
@testable import KMTV

/// Covers the fallback order: local copy, finished last episode, next line, next source, nothing.
///
/// 覆盖回退顺序: 本地副本, 已看完的最后一集, 下一条线路, 下一个视频源, 无可用.
final class SourceFallbackPolicyTests: XCTestCase {
    private func selection(lines: Int = 1, episodes: Int = 2, line: Int = 0, episode: Int = 0,
                           sources: [String] = ["s1", "s2"], current: String = "s1") -> EpisodeSelection {
        let detail = VideoDetail(
            id: "v", title: "Video", type: "", year: "", cover: "", desc: "", director: "", actor: "", area: "",
            episodes: (0..<lines).map { l in (0..<episodes).map { Episode(name: "EP\($0 + 1)", url: "https://cdn\(l)/\($0)") } }
        )
        return EpisodeSelection(
            detail: detail,
            sources: sources.map { SourceResult(sourceKey: $0, sourceName: $0, videoId: "v-\($0)", durationMs: 0, episodes: []) },
            currentSourceKey: current, currentLineIndex: line, currentEpisodeIndex: episode
        )
    }

    func testALocalCopyFallsBackToStreamingFirst() {
        XCTAssertEqual(SourceFallbackPolicy.afterItemFailure(playingLocalCopy: true, selection: selection(lines: 2),
                                                             current: 0, duration: 0),
                       .streamSameSelection)
        XCTAssertEqual(SourceFallbackPolicy.afterItemFailure(playingLocalCopy: false, selection: selection(lines: 2),
                                                             current: 0, duration: 0),
                       .nextLine(1))
    }

    func testTheLastEpisodePastTheFinishedThresholdCountsAsEnded() {
        let last = selection(lines: 2, episode: 1)
        XCTAssertEqual(SourceFallbackPolicy.afterFailure(selection: last, current: 990, duration: 1000), .finish)
        XCTAssertEqual(SourceFallbackPolicy.afterFailure(selection: last, current: 100, duration: 1000), .nextLine(1))
        // An earlier episode near its end is still a failure.
        //
        // 较早的分集即使接近结尾仍算失败.
        XCTAssertEqual(SourceFallbackPolicy.afterFailure(selection: selection(lines: 2), current: 990, duration: 1000),
                       .nextLine(1))
    }

    func testTheNextLineComesBeforeTheNextSource() {
        XCTAssertEqual(SourceFallbackPolicy.afterFailure(selection: selection(lines: 3, line: 1), current: 0, duration: 0),
                       .nextLine(2))
        XCTAssertEqual(SourceFallbackPolicy.afterFailure(selection: selection(lines: 3, line: 2), current: 0, duration: 0),
                       .nextSource("s2"))
    }

    func testTheNextSourceSkipsTheFailingOne() {
        let failing = selection(sources: ["s1", "s2", "s3"], current: "s2")
        XCTAssertEqual(SourceFallbackPolicy.afterFailure(selection: failing, current: 0, duration: 0), .nextSource("s1"))
    }

    func testNothingIsLeftWhenOnlyTheFailingSourceRemains() {
        XCTAssertEqual(SourceFallbackPolicy.afterFailure(selection: selection(sources: ["s1"]), current: 0, duration: 0),
                       .allSourcesFailed)
        XCTAssertEqual(SourceFallbackPolicy.afterFailure(selection: selection(sources: []), current: 0, duration: 0),
                       .allSourcesFailed)
    }

    func testPlayableDetailNeedsAFirstLineWithEpisodes() {
        XCTAssertTrue(SourceFallbackPolicy.isPlayable(selection().detail!))
        var empty = selection().detail!
        empty.episodes = []
        XCTAssertFalse(SourceFallbackPolicy.isPlayable(empty))
        empty.episodes = [[], [Episode(name: "EP1", url: "u")]]
        XCTAssertFalse(SourceFallbackPolicy.isPlayable(empty))
    }
}
