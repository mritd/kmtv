import XCTest
@testable import KMTV

/// The selection controller on its own, against a host that records the playback side.
///
/// 单独测试选择控制器, 宿主只记录播放一侧的动作.
@MainActor
final class PlaybackSelectionControllerTests: XCTestCase {
    /// Detail replies per source, optionally held by a gate or failing.
    ///
    /// 按视频源区分的详情响应, 可由 gate 挂起或返回失败.
    @MainActor
    private final class FakeDetailAPI: PlaybackDetailAPIProtocol {
        var details: [String: VideoDetail] = [:]
        var gates: [String: SyncTestGate] = [:]
        var failing: Set<String> = []

        func detail(sourceKey: String, videoId: String) async throws -> VideoDetail {
            if let gate = gates[sourceKey] { await gate.wait() }
            if failing.contains(sourceKey) { throw URLError(.badServerResponse) }
            guard let detail = details[sourceKey] else { throw URLError(.fileDoesNotExist) }
            return detail
        }

        func playbackURL(url: String, source: String) async throws -> PlaybackURLResponse {
            PlaybackURLResponse(mode: "direct", url: url)
        }
    }

    /// Records each playback-side call in order.
    ///
    /// 按顺序记录每次播放一侧的调用.
    @MainActor
    private final class RecordingHost: PlaybackSelectionHost {
        var currentTime: TimeInterval = 0
        var duration: TimeInterval = 0
        var calls: [String] = []

        func detachOutgoingItem() { calls.append("detach") }
        func startPlayback() { calls.append("start") }
        func streamWithoutLocalCopy() { calls.append("stream") }
        func handlePlaybackEnded() { calls.append("ended") }
    }

    private static func detail(_ title: String = "Show", lines: [[String]]) -> VideoDetail {
        VideoDetail(id: "v", title: title, type: "tv", year: "2026", cover: "", desc: "", director: "", actor: "",
                    area: "", episodes: lines.map { $0.map { Episode(name: $0, url: "https://cdn.example/\($0).m3u8") } })
    }

    private static func source(_ key: String) -> SourceResult {
        SourceResult(sourceKey: key, sourceName: key.uppercased(), videoId: "video-\(key)", durationMs: 0, episodes: [])
    }

    private func makeController(_ api: FakeDetailAPI, host: RecordingHost,
                                sources: [String] = ["s1", "s2"]) -> PlaybackSelectionController {
        let controller = PlaybackSelectionController(
            apiClient: api, syncStore: nil, syncEngine: nil, playerSyncWait: .zero,
            sources: sources.map(Self.source), sourceKey: sources.first ?? "s1", videoId: "video-s1", title: "Show",
            coverHint: "", initialEpisodeIndex: nil
        )
        controller.host = host
        return controller
    }

    func testOpenLoadsDetailAndStartsPlayback() async {
        let api = FakeDetailAPI()
        api.details["s1"] = Self.detail(lines: [["EP1", "EP2"]])
        let host = RecordingHost()
        let controller = makeController(api, host: host)

        await controller.open(autoplay: true)

        XCTAssertEqual(controller.loadState, .loaded)
        XCTAssertEqual(controller.currentSourceKey, "s1")
        XCTAssertEqual(host.calls, ["start"])
    }

    func testOpenOvertakenByUserSwitchYieldsToTheSwitch() async {
        let api = FakeDetailAPI()
        api.details["s1"] = Self.detail(lines: [["EP1"]])
        api.details["s2"] = Self.detail(lines: [["EP1"]])
        let gate = SyncTestGate()
        api.gates["s1"] = gate
        let host = RecordingHost()
        let controller = makeController(api, host: host)

        let open = Task { await controller.open(autoplay: true) }
        while gate.waiting == 0 { await Task.yield() }
        let switchTask = controller.selectSource("s2", autoplay: true)
        await switchTask.value
        gate.open()
        await open.value

        // The open's late reply never commits, and only the switch starts playback.
        //
        // 打开流程迟到的响应不会提交, 只有切换会开始播放.
        XCTAssertEqual(controller.currentSourceKey, "s2")
        XCTAssertEqual(controller.loadState, .loaded)
        XCTAssertEqual(host.calls, ["detach", "start"])
    }

    func testCancelledSwitchNeverCommits() async {
        let api = FakeDetailAPI()
        api.details["s2"] = Self.detail(lines: [["EP1"]])
        let gate = SyncTestGate()
        api.gates["s2"] = gate
        let host = RecordingHost()
        let controller = makeController(api, host: host)

        let task = controller.selectSource("s2", autoplay: true)
        while gate.waiting == 0 { await Task.yield() }
        controller.cancelSwitch()
        gate.open()
        await task.value

        XCTAssertEqual(controller.currentSourceKey, "s1")
        XCTAssertNil(controller.detail)
        XCTAssertTrue(host.calls.isEmpty)
    }

    func testFollowNextLineDetachesAndStartsOnlyWithAutoplay() {
        let host = RecordingHost()
        let controller = makeController(FakeDetailAPI(), host: host)
        controller.detail = Self.detail(lines: [["EP1"], ["EP1"], ["EP1"]])

        XCTAssertNil(controller.follow(.nextLine(1), autoplay: true))
        XCTAssertEqual(controller.currentLineIndex, 1)
        XCTAssertEqual(host.calls, ["detach", "start"])

        controller.follow(.nextLine(2), autoplay: false)
        XCTAssertEqual(controller.currentLineIndex, 2)
        XCTAssertEqual(host.calls, ["detach", "start", "detach"])
    }

    func testFollowHandsLocalCopyAndFinishToTheHost() {
        let host = RecordingHost()
        let controller = makeController(FakeDetailAPI(), host: host)

        controller.follow(.streamSameSelection, autoplay: true)
        controller.follow(.finish, autoplay: true)

        XCTAssertEqual(host.calls, ["stream", "ended"])
    }

    func testFollowAllSourcesFailedDropsTheSourceAndReportsIt() {
        let host = RecordingHost()
        let controller = makeController(FakeDetailAPI(), host: host, sources: ["s1"])

        controller.follow(.allSourcesFailed, autoplay: true)

        XCTAssertTrue(controller.sources.isEmpty)
        XCTAssertEqual(controller.error, PlayerError.allSourcesFailed.localizedDescription)
        XCTAssertTrue(host.calls.isEmpty)
    }

    func testFailedOpenFallsBackToTheNextSource() async {
        let api = FakeDetailAPI()
        api.failing = ["s1"]
        api.details["s2"] = Self.detail(lines: [["EP1"]])
        let host = RecordingHost()
        let controller = makeController(api, host: host)

        await controller.open(autoplay: true)

        XCTAssertEqual(controller.currentSourceKey, "s2")
        XCTAssertEqual(controller.sources.map(\.sourceKey), ["s2"])
        XCTAssertEqual(controller.loadState, .loaded)
        XCTAssertEqual(host.calls, ["detach", "start"])
    }

    func testFailedOpenWithNoSourceLeftShowsFailure() async {
        let api = FakeDetailAPI()
        api.failing = ["s1"]
        let host = RecordingHost()
        let controller = makeController(api, host: host, sources: ["s1"])

        await controller.open(autoplay: true)

        XCTAssertEqual(controller.loadState, .failed(PlayerError.allSourcesFailed.localizedDescription))
        XCTAssertTrue(host.calls.isEmpty)
    }

    func testRecoveryReadsThePositionFromTheHost() {
        let host = RecordingHost()
        host.currentTime = 95
        host.duration = 100
        let controller = makeController(FakeDetailAPI(), host: host)
        controller.detail = Self.detail(lines: [["EP1"], ["EP1"]])

        // The last episode failed past the finished threshold, so it counts as ended rather than
        // moving on to the next line.
        //
        // 最后一集在看完阈值之后失败, 因此视为播放结束, 而不是切换到下一条线路.
        XCTAssertNil(controller.recoverFromFailure(autoplay: true))
        XCTAssertEqual(host.calls, ["ended"])
        XCTAssertEqual(controller.currentLineIndex, 0)
    }
}
