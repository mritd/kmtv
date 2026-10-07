import XCTest
@testable import KMTV

/// How the player page turns a download tap into queued requests and a toast outcome.
///
/// 播放页如何把一次下载点按转换为入队请求与提示结果.
@MainActor
final class PlayerDownloadsTests: XCTestCase {
    /// Records what was queued and answers with a scripted result.
    ///
    /// 记录入队内容, 并以预设结果应答.
    @MainActor
    private final class FakeQueue: EpisodeDownloadQueue {
        var shows: [DownloadShowInfo] = []
        var requests: [[DownloadEpisodeRequest]] = []
        var failure: Error?

        func enqueue(show: DownloadShowInfo, episodes: [DownloadEpisodeRequest]) throws -> Int {
            if let failure { throw failure }
            shows.append(show)
            requests.append(episodes)
            return episodes.count
        }
    }

    private func makeViewModel(withDetail: Bool = true) throws -> PlayerViewModel {
        let container = try ModelContainerFactory.makeInMemory()
        let vm = PlayerViewModel(
            apiClient: PlaybackAPIFake(), modelContext: container.mainContext, serverURL: "https://kmtv.example",
            sources: [SourceResult(sourceKey: "s1", sourceName: "Source One", videoId: "video-1", durationMs: 0,
                                   episodes: [])],
            sourceKey: "s1", videoId: "video-1", title: "Show", engine: FakePlaybackEngine()
        )
        if withDetail {
            vm.detail = VideoDetail(
                id: "video-1", title: "Show", type: "tv", year: "2026", cover: "/cover.jpg", desc: "", director: "",
                actor: "", area: "",
                episodes: [[Episode(name: "EP1", url: "https://cdn.example/1.m3u8"),
                            Episode(name: "EP2", url: "https://cdn.example/2.m3u8")]]
            )
        }
        return vm
    }

    func testRequestsDescribeTheCurrentSourceAndSkipUnknownIndexes() throws {
        let vm = try makeViewModel()

        let requests = vm.downloadRequests(for: [1, 5, -1])

        XCTAssertEqual(requests, [DownloadEpisodeRequest(
            sourceKey: "s1", sourceName: "Source One", videoId: "video-1", episodeIndex: 1, episodeName: "EP2",
            lineIndex: 0, episodeCount: 2, episodeURL: "https://cdn.example/2.m3u8"
        )])
    }

    func testEnqueueReportsTheAddedCountAndPassesTheShow() throws {
        let vm = try makeViewModel()
        let queue = FakeQueue()
        let cover = URL(string: "https://kmtv.example/cover.jpg")

        let outcome = vm.enqueueDownloads([0, 1], into: queue, coverURL: cover)

        XCTAssertEqual(outcome, .added(2))
        XCTAssertEqual(queue.shows, [DownloadShowInfo(title: "Show", cover: "/cover.jpg", type: "tv", year: "2026",
                                                      coverURL: cover)])
        XCTAssertEqual(queue.requests.first?.map(\.episodeIndex), [0, 1])
    }

    func testEnqueueMapsErrorsToOutcomes() throws {
        let vm = try makeViewModel()
        let queue = FakeQueue()

        queue.failure = DownloadEnqueueError.notEnoughSpace
        XCTAssertEqual(vm.enqueueDownloads([0], into: queue, coverURL: nil), .notEnoughSpace)

        queue.failure = DownloadEnqueueError.notSignedIn
        XCTAssertEqual(vm.enqueueDownloads([0], into: queue, coverURL: nil), .notSignedIn)

        // Any other failure reads as downloads being unavailable, as before.
        //
        // 其他任何失败都视为下载不可用, 与之前一致.
        queue.failure = URLError(.unknown)
        XCTAssertEqual(vm.enqueueDownloads([0], into: queue, coverURL: nil), .notSignedIn)
    }

    func testEnqueueWithoutDetailDoesNothing() throws {
        let vm = try makeViewModel(withDetail: false)
        let queue = FakeQueue()

        XCTAssertNil(vm.enqueueDownloads([0], into: queue, coverURL: nil))
        XCTAssertTrue(queue.shows.isEmpty)
    }

    func testOutcomeToasts() {
        XCTAssertEqual(PlayerDownloadOutcome.added(3).toast.style, .success)
        XCTAssertEqual(PlayerDownloadOutcome.notEnoughSpace.toast.style, .error)
        XCTAssertEqual(PlayerDownloadOutcome.notSignedIn.toast.style, .error)
    }

    func testPlaybackRatesAndLabels() {
        XCTAssertEqual(PlaybackRates.all, [1.0, 1.5, 2.0])
        XCTAssertEqual(PlaybackRates.all.map(PlaybackRates.label), ["1x", "1.5x", "2x"])
    }
}
