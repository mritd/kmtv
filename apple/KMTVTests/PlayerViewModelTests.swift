import XCTest
import AVFoundation
import Observation
@testable import KMTV

final class PlayerViewModelTests: XCTestCase {
    private final class FakePlayerAPI: PlaybackDetailAPIProtocol, @unchecked Sendable {
        var playbackRequests: [(url: String, source: String)] = []
        var playbackResponse = PlaybackURLResponse(
            mode: "proxy",
            url: "https://kmtv.example/api/v1/proxy/m3u8?mt=Base58MediaToken"
        )
        var detailResponse = VideoDetail(
            id: "video-1", title: "Video", type: "movie", year: "2026",
            cover: "", desc: "", director: "", actor: "", area: "",
            episodes: [[Episode(name: "EP1", url: "https://cdn.example/video.m3u8")]]
        )
		var savedHistoryRequests: [WatchHistoryRequest] = []
		var remoteHistory: WatchHistoryResponseItem?

        func detail(sourceKey: String, videoId: String) async throws -> VideoDetail {
            detailResponse
        }

        func playbackURL(url: String, source: String) async throws -> PlaybackURLResponse {
            playbackRequests.append((url: url, source: source))
            return playbackResponse
        }

        func listWatchHistory(limit: Int) async throws -> WatchHistoryResponse {
            WatchHistoryResponse(items: [])
        }

		func watchHistory(title: String) async throws -> WatchHistoryResponseItem {
			if let remoteHistory { return remoteHistory }
			throw APIError.serverError(404, 1204, "watch history not found")
        }

        func saveWatchHistory(_ request: WatchHistoryRequest) async throws -> WatchHistoryResponseItem {
            savedHistoryRequests.append(request)
            return WatchHistoryResponseItem(
                id: 1,
                sourceKey: request.sourceKey,
                videoId: request.videoId,
                title: request.title,
                cover: request.cover,
                episode: request.episode,
                groupIndex: request.groupIndex,
                episodeIndex: request.episodeIndex,
                progressSec: request.progressSec,
                durationSec: request.durationSec,
				completed: request.completed,
				eventTimeMS: request.eventTimeMS,
				createdAt: nil,
                updatedAt: nil
            )
        }

        func deleteWatchHistory(title: String) async throws {}

        func clearRemoteWatchHistory() async throws {}
	}

	@MainActor
	func testRemoteHistoryIsLoadedBeforePlaybackSelection() async throws {
		let container = try ModelContainerFactory.makeInMemory()
		let api = FakePlayerAPI()
		api.detailResponse.episodes = [[
			Episode(name: "EP1", url: "https://cdn.example/1.m3u8"),
			Episode(name: "EP2", url: "https://cdn.example/2.m3u8")
		]]
		api.remoteHistory = WatchHistoryResponseItem(
			id: 1,
			sourceKey: "s1",
			videoId: "video-1",
			title: "Video",
			cover: "",
			episode: "EP2",
			groupIndex: 0,
			episodeIndex: 1,
			progressSec: 45,
			durationSec: 120,
			completed: false,
			eventTimeMS: 1,
			createdAt: nil,
			updatedAt: nil
		)
		let vm = PlayerViewModel(
			apiClient: api,
			modelContext: container.mainContext,
			serverURL: "https://kmtv.example",
			userID: 1,
			sources: [SourceResult(
				sourceKey: "s1", sourceName: "S1", videoId: "video-1",
				durationMs: 0, episodes: []
			)],
			sourceKey: "s1",
			videoId: "video-1",
			title: "Video"
		)

		await vm.loadRemoteWatchHistory()
		_ = await vm.loadDetail(sourceKey: vm.currentSourceKey, videoId: vm.currentVideoID)

		XCTAssertEqual(vm.currentEpisodeIndex, 1)
		let cached = WatchHistoryItem.recent(
			in: container.mainContext,
			serverURL: "https://kmtv.example",
			userID: 1
		)
		XCTAssertEqual(cached.first?.progress, 45)
	}

	@MainActor
    func testInitialPlaybackState() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let vm = PlayerViewModel(
            apiClient: APIClient(baseURL: "http://localhost"),
            modelContext: container.mainContext,
            serverURL: "http://localhost",
            sources: [], sourceKey: "test", videoId: "1", title: "Test"
        )
        XCTAssertEqual(vm.currentTime, 0)
        XCTAssertEqual(vm.duration, 0)
        XCTAssertEqual(vm.playbackRate, 1.0)
        XCTAssertFalse(vm.isPlaying)
        XCTAssertNil(vm.player)
    }

    @MainActor
    func testOnTimeUpdateSetsProperties() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let vm = PlayerViewModel(
            apiClient: APIClient(baseURL: "http://localhost"),
            modelContext: container.mainContext,
            serverURL: "http://localhost",
            sources: [], sourceKey: "test", videoId: "1", title: "Test"
        )
        vm.onTimeUpdate(current: 45.0, total: 120.0)
        XCTAssertEqual(vm.currentTime, 45.0)
        XCTAssertEqual(vm.duration, 120.0)
    }

    // Every case here draws a wrong bar rather than crashing, which is why they need
    // asserting: a duration of 0 before the first time update would make the width NaN, and
    // a buffer that runs past the end would push the bar outside its track.
    //
    // 下列每种情况都不会崩溃, 只会把进度条画错, 因此才需要断言:
    // 首次时间更新之前时长为 0 会让宽度变成 NaN,
    // 而缓冲超过片尾则会把进度条推出轨道之外.
    @MainActor
    func testOnBufferUpdateProducesADrawableFraction() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let vm = PlayerViewModel(
            apiClient: APIClient(baseURL: "http://localhost"),
            modelContext: container.mainContext,
            serverURL: "http://localhost",
            sources: [], sourceKey: "test", videoId: "1", title: "Test"
        )

        vm.onBufferUpdate(BufferSample(end: 60, ahead: 0))
        XCTAssertEqual(vm.bufferedFraction, 0, "no duration yet means nothing to draw")

        vm.onTimeUpdate(current: 10, total: 120)

        vm.onBufferUpdate(BufferSample(end: 30, ahead: 0))
        XCTAssertEqual(vm.bufferedFraction, 0.25, accuracy: 0.001)

        vm.onBufferUpdate(BufferSample(end: 130, ahead: 0))
        XCTAssertEqual(vm.bufferedFraction, 1, "a buffer past the end still stops at the track")

        vm.onBufferUpdate(BufferSample(end: -5, ahead: 0))
        XCTAssertEqual(vm.bufferedFraction, 0)

        vm.onBufferUpdate(BufferSample(end: .infinity, ahead: 0))
        XCTAssertEqual(vm.bufferedFraction, 0, "an indefinite position cannot be drawn")
    }

    // Switching episode restarts the wall-clock buffer sampler immediately, while the time
    // observer stays quiet until the new item reports a finite duration. In that window the
    // only duration available is the previous episode's, so the reset is what stops the new
    // episode's buffer from being drawn against the old episode's length.
    //
    // 切换剧集会立即重启墙钟缓冲采样器, 而时间观察器要等到新 item 报告有限时长后才恢复.
    // 在这段窗口内唯一可用的时长来自上一集,
    // 因此正是这次重置阻止了新剧集的缓冲按上一集的时长绘制.
    @MainActor
    func testNewItemDoesNotInheritThePreviousEpisodesTimeline() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let vm = PlayerViewModel(
            apiClient: APIClient(baseURL: "http://localhost"),
            modelContext: container.mainContext,
            serverURL: "http://localhost",
            sources: [], sourceKey: "test", videoId: "1", title: "Test"
        )

        vm.onTimeUpdate(current: 600, total: 1200)
        vm.onBufferUpdate(BufferSample(end: 900, ahead: 0))
        XCTAssertEqual(vm.bufferedFraction, 0.75, accuracy: 0.001)

        vm.resetPlaybackUIState()

        XCTAssertEqual(vm.currentTime, 0)
        XCTAssertEqual(vm.duration, 0)
        XCTAssertEqual(vm.bufferedFraction, 0)

        vm.onBufferUpdate(BufferSample(end: 900, ahead: 0))
        XCTAssertEqual(vm.bufferedFraction, 0, "a sample before the new duration arrives draws nothing")
    }

    // Seeking backwards is the case that shows: the media between the new position and the
    // old buffered end is not continuously playable from where the playhead now sits, so a
    // sample taken before the seek lands must not be drawn.
    //
    // 向后 seek 是能暴露问题的情形: 新位置与旧缓冲终点之间的内容
    // 无法从播放头当前所在处连续播放, 因此 seek 落地前取得的采样不能被绘制.
    @MainActor
    func testSeekCollapsesTheBufferedBarUntilTheNewPositionReports() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let vm = PlayerViewModel(
            apiClient: APIClient(baseURL: "http://localhost"),
            modelContext: container.mainContext,
            serverURL: "http://localhost",
            sources: [], sourceKey: "test", videoId: "1", title: "Test"
        )

        vm.onTimeUpdate(current: 600, total: 1200)
        vm.onBufferUpdate(BufferSample(end: 900, ahead: 0))
        XCTAssertEqual(vm.bufferedFraction, 0.75, accuracy: 0.001)

        vm.beginSeek(to: 120)
        XCTAssertEqual(vm.bufferedFraction, 0.1, accuracy: 0.001, "the bar falls back to the seek target")

        vm.onBufferUpdate(BufferSample(end: 900, ahead: 0))
        XCTAssertEqual(vm.bufferedFraction, 0.1, accuracy: 0.001, "a sample from before the seek landed is ignored")

        vm.endSeek(finished: true)
        vm.onBufferUpdate(BufferSample(end: 900, ahead: 0))
        XCTAssertEqual(vm.bufferedFraction, 0.75, accuracy: 0.001, "samples resume once the seek lands")
    }

    // Two taps on skip leave the first seek superseded, and AVPlayer completes it with
    // finished == false while the second is still in flight. Clearing the flag there would
    // reopen the very window the guard exists to close.
    //
    // 连点两下快进会让第一次 seek 被顶替, AVPlayer 会在第二次仍在进行时
    // 以 finished == false 完成它. 在那里清除标志, 等于重新打开了该守卫本要关闭的窗口.
    @MainActor
    func testSupersededSeekDoesNotEndTheSeekingState() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let vm = PlayerViewModel(
            apiClient: APIClient(baseURL: "http://localhost"),
            modelContext: container.mainContext,
            serverURL: "http://localhost",
            sources: [], sourceKey: "test", videoId: "1", title: "Test"
        )
        vm.onTimeUpdate(current: 600, total: 1200)

        vm.beginSeek(to: 120)
        vm.beginSeek(to: 240)
        vm.endSeek(finished: false)

        XCTAssertTrue(vm.isSeeking, "the second seek still owns the flag")
        vm.onBufferUpdate(BufferSample(end: 900, ahead: 0))
        XCTAssertEqual(vm.bufferedFraction, 0.2, accuracy: 0.001, "still the second seek's target, not a stale sample")

        vm.endSeek(finished: true)
        XCTAssertFalse(vm.isSeeking)
    }

    // seek(to:) with no player registers no completion, so nothing would ever clear the
    // flag; starting a new item has to clear it too, or the next episode inherits a frozen
    // time display and buffered bar.
    //
    // 没有 player 时 seek(to:) 不会注册 completion, 因此没有任何路径能清除该标志;
    // 启动新 item 时也必须清除它, 否则下一集会继承一个冻结的播放时间与缓冲进度条.
    @MainActor
    func testSeekingStateCannotOutliveTheItem() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let vm = PlayerViewModel(
            apiClient: APIClient(baseURL: "http://localhost"),
            modelContext: container.mainContext,
            serverURL: "http://localhost",
            sources: [], sourceKey: "test", videoId: "1", title: "Test"
        )

        vm.seek(to: 60)
        XCTAssertFalse(vm.isSeeking, "without a player there is no seek to wait for")

        vm.beginSeek(to: 60)
        vm.resetPlaybackUIState()
        XCTAssertFalse(vm.isSeeking, "a new item starts with the seeking state cleared")

        vm.onTimeUpdate(current: 30, total: 1200)
        vm.onBufferUpdate(BufferSample(end: 120, ahead: 0))
        XCTAssertEqual(vm.bufferedFraction, 0.1, accuracy: 0.001, "updates flow again")
    }

    // The fullscreen readout is the only place the buffer is visible there, so the seconds
    // it shows have to survive the same guards the bar does, and the band rule has to fire
    // on a collapse as readily as on a fill.
    //
    // 全屏文字提示是那里唯一能看到缓冲的地方,
    // 因此它显示的秒数必须与进度条经受同样的守卫,
    // 而区间规则在缓冲塌陷时也要像填充时一样触发.
    @MainActor
    func testFullscreenReadoutTracksTheForwardBuffer() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let vm = PlayerViewModel(
            apiClient: APIClient(baseURL: "http://localhost"),
            modelContext: container.mainContext,
            serverURL: "http://localhost",
            sources: [], sourceKey: "test", videoId: "1", title: "Test"
        )
        vm.onTimeUpdate(current: 10, total: 1200)

        vm.onBufferUpdate(BufferSample(end: 132, ahead: 122))
        XCTAssertEqual(vm.bufferedAheadSeconds, 122, accuracy: 0.001)

        // No duration yet still has to produce a number, since the readout is all fullscreen shows.
        //
        // 尚无时长时也必须给出数字, 因为全屏能显示的只有这个提示.
        vm.resetPlaybackUIState()
        XCTAssertEqual(vm.bufferedAheadSeconds, 0)
        vm.onBufferUpdate(BufferSample(end: 132, ahead: 122))
        XCTAssertEqual(vm.bufferedAheadSeconds, 122, accuracy: 0.001)
        XCTAssertEqual(vm.bufferedFraction, 0, "no duration, so nothing to draw on the bar")

        vm.onBufferUpdate(BufferSample(end: 132, ahead: .infinity))
        XCTAssertEqual(vm.bufferedAheadSeconds, 0, "an indefinite reading shows nothing")

        vm.beginSeek(to: 60)
        vm.onBufferUpdate(BufferSample(end: 900, ahead: 800))
        XCTAssertEqual(vm.bufferedAheadSeconds, 0, "a sample from before the seek landed is ignored")
    }

    // A stall stops the playhead, which silences the time observer that used to be the only
    // thing maintaining these flags — so the spinner never appeared and the fullscreen
    // readout never pinned, exactly when both were needed. The wall-clock buffer sampler is
    // what still runs, so it has to carry the refresh.
    //
    // 卡顿会让播放头停止, 从而使时间观察器静默,
    // 而它曾是维护这两个标志的唯一来源 — 于是加载转圈不会出现,
    // 全屏文字提示也不会常驻, 偏偏那正是最需要它们的时刻.
    // 墙钟缓冲采样器是那时仍在运行的路径, 因此刷新必须由它承担.
    @MainActor
    func testTransportStateSurvivesAStalledPlayhead() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let vm = PlayerViewModel(
            apiClient: APIClient(baseURL: "http://localhost"),
            modelContext: container.mainContext,
            serverURL: "http://localhost",
            sources: [], sourceKey: "test", videoId: "1", title: "Test"
        )

        vm.refreshTransportState(.playing)
        XCTAssertTrue(vm.isPlaying)
        XCTAssertFalse(vm.isBuffering)

        vm.refreshTransportState(.waitingToPlayAtSpecifiedRate)
        XCTAssertFalse(vm.isPlaying)
        XCTAssertTrue(vm.isBuffering, "a stall has to raise the spinner and pin the readout")

        vm.refreshTransportState(.paused)
        XCTAssertFalse(vm.isPlaying)
        XCTAssertFalse(vm.isBuffering)

        vm.refreshTransportState(nil)
        XCTAssertFalse(vm.isPlaying)
        XCTAssertFalse(vm.isBuffering)

        // A buffer sample must carry the refresh; without it nothing does while stalled.
        //
        // 缓冲采样必须承载这次刷新; 否则卡顿期间无人承担.
        vm.isBuffering = true
        vm.onBufferUpdate(BufferSample(end: 100, ahead: 50))
        XCTAssertFalse(vm.isBuffering, "the sample refreshed the state from the player")
    }

    // Seeking collapses the bar back to the thumb, and the readout has to fall back with it
    // — the seek raises the waiting flag, so a stale figure would be pinned on screen.
    //
    // seek 会把进度条收回滑块处, 文字提示必须一同回落 —
    // seek 会置起等待标志, 因此陈旧的数字会被钉在画面上.
    @MainActor
    func testSeekClearsTheFullscreenReadout() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let vm = PlayerViewModel(
            apiClient: APIClient(baseURL: "http://localhost"),
            modelContext: container.mainContext,
            serverURL: "http://localhost",
            sources: [], sourceKey: "test", videoId: "1", title: "Test"
        )
        vm.onTimeUpdate(current: 600, total: 1200)
        vm.onBufferUpdate(BufferSample(end: 720, ahead: 120))
        XCTAssertEqual(vm.bufferedAheadSeconds, 120, accuracy: 0.001)

        vm.beginSeek(to: 60)

        XCTAssertEqual(vm.bufferedAheadSeconds, 0, "nothing is known to be buffered at the target")
        XCTAssertTrue(vm.isBuffering, "the seek pins the readout, which makes a stale figure visible")
    }

    @MainActor
    func testBufferBadgeBandChangesOnlyAcrossThirtySecondSteps() {
        let band = PlayerViewModel.bufferBadgeBand

        XCTAssertEqual(band(0), band(29), "inside one band the readout stays put")
        XCTAssertNotEqual(band(29), band(30), "crossing 30s is worth a glance")
        XCTAssertNotEqual(band(59), band(60))
        XCTAssertEqual(band(120), band(149))

        // A stall collapses the buffer, and that has to surface as readily as filling does.
        //
        // 卡顿会让缓冲塌陷, 这同样需要像填充时一样被呈现出来.
        XCTAssertNotEqual(band(120), band(0))

        XCTAssertEqual(band(-5), 0, "a negative reading cannot select a band")
        XCTAssertEqual(band(.infinity), 0)
        XCTAssertEqual(band(.nan), 0)
    }

    @MainActor
    func testSkipCalculation() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let vm = PlayerViewModel(
            apiClient: APIClient(baseURL: "http://localhost"),
            modelContext: container.mainContext,
            serverURL: "http://localhost",
            sources: [], sourceKey: "test", videoId: "1", title: "Test"
        )
        // Without a player, skip should not crash
        vm.skip(by: 30)
        vm.skip(by: -30)
    }

    @MainActor
    func testTogglePlayPauseWithoutPlayer() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let vm = PlayerViewModel(
            apiClient: APIClient(baseURL: "http://localhost"),
            modelContext: container.mainContext,
            serverURL: "http://localhost",
            sources: [], sourceKey: "test", videoId: "1", title: "Test"
        )
        // Should not crash when player is nil
        vm.togglePlayPause()
    }

    @MainActor
    func testSetRate() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let vm = PlayerViewModel(
            apiClient: APIClient(baseURL: "http://localhost"),
            modelContext: container.mainContext,
            serverURL: "http://localhost",
            sources: [], sourceKey: "test", videoId: "1", title: "Test"
        )
        vm.setRate(2.0)
        XCTAssertEqual(vm.playbackRate, 2.0)
    }

    @MainActor
    func testSeekWithoutPlayer() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let vm = PlayerViewModel(
            apiClient: APIClient(baseURL: "http://localhost"),
            modelContext: container.mainContext,
            serverURL: "http://localhost",
            sources: [], sourceKey: "test", videoId: "1", title: "Test"
        )
        // Should not crash
        vm.seek(to: 60.0)
    }

    @MainActor
    func testPreparePlaybackURLUsesServerPlaybackEndpoint() async throws {
        let container = try ModelContainerFactory.makeInMemory()
        let api = FakePlayerAPI()
        let vm = PlayerViewModel(
            apiClient: api,
            modelContext: container.mainContext,
            serverURL: "https://kmtv.example",
            sources: [SourceResult(
                sourceKey: "source-a",
                sourceName: "Source A",
                videoId: "video-1",
                durationMs: 0,
                episodes: [Episode(name: "EP1", url: "https://cdn.example/video.m3u8")]
            )],
            sourceKey: "source-a",
            videoId: "video-1",
            title: "Video"
        )
        vm.detail = api.detailResponse

        let url = try await vm.preparePlaybackURL()

        XCTAssertEqual(url.absoluteString, "https://kmtv.example/api/v1/proxy/m3u8?mt=Base58MediaToken")
        XCTAssertEqual(api.playbackRequests.count, 1)
        XCTAssertEqual(api.playbackRequests.first?.url, "https://cdn.example/video.m3u8")
        XCTAssertEqual(api.playbackRequests.first?.source, "source-a")
    }

    @MainActor
    func testPreparePlaybackURLThrowsWithoutEpisode() async throws {
        let container = try ModelContainerFactory.makeInMemory()
        let vm = PlayerViewModel(
            apiClient: FakePlayerAPI(),
            modelContext: container.mainContext,
            serverURL: "https://kmtv.example",
            sources: [],
            sourceKey: "source-a",
            videoId: "video-1",
            title: "Video"
        )

        do {
            _ = try await vm.preparePlaybackURL()
            XCTFail("expected missing episode error")
        } catch PlayerError.missingEpisode {
            // expected
        }
    }

    @MainActor
    func testStartPlaybackNotifiesPlayerAvailability() async throws {
        let container = try ModelContainerFactory.makeInMemory()
        let api = FakePlayerAPI()
        api.playbackResponse = PlaybackURLResponse(mode: "direct", url: "file:///tmp/kmtv-test.m3u8")
        let vm = PlayerViewModel(
            apiClient: api,
            modelContext: container.mainContext,
            serverURL: "https://kmtv.example",
            sources: [SourceResult(
                sourceKey: "source-a",
                sourceName: "Source A",
                videoId: "video-1",
                durationMs: 0,
                episodes: [Episode(name: "EP1", url: "https://cdn.example/video.m3u8")]
            )],
            sourceKey: "source-a",
            videoId: "video-1",
            title: "Video"
        )
        vm.detail = api.detailResponse

        let playerAvailable = expectation(description: "player availability change is observed")
        withObservationTracking {
            _ = vm.player
        } onChange: {
            playerAvailable.fulfill()
        }

        await vm.startPlaybackAsync()

        XCTAssertNotNil(vm.player)
        await fulfillment(of: [playerAvailable], timeout: 1.0)
    }

    @MainActor
    func testStartPlaybackShowsInitialBufferingState() async throws {
        let container = try ModelContainerFactory.makeInMemory()
        let api = FakePlayerAPI()
        api.playbackResponse = PlaybackURLResponse(mode: "direct", url: "file:///tmp/kmtv-test.m3u8")
        let vm = PlayerViewModel(
            apiClient: api,
            modelContext: container.mainContext,
            serverURL: "https://kmtv.example",
            sources: [SourceResult(
                sourceKey: "source-a",
                sourceName: "Source A",
                videoId: "video-1",
                durationMs: 0,
                episodes: [Episode(name: "EP1", url: "https://cdn.example/video.m3u8")]
            )],
            sourceKey: "source-a",
            videoId: "video-1",
            title: "Video"
        )
        vm.detail = api.detailResponse

        await vm.startPlaybackAsync()

        XCTAssertTrue(vm.isBuffering)
        XCTAssertFalse(vm.isPlaying)
    }

    @MainActor
    func testSwitchSourcePreservesMetadataAndRefreshesEpisodes() async throws {
        let container = try ModelContainerFactory.makeInMemory()
        let api = FakePlayerAPI()
        let initialDetail = VideoDetail(
            id: "video-1", title: "Video", type: "movie", year: "2026",
            cover: "cover-a", desc: "description", director: "director", actor: "actor", area: "area",
            episodes: [[Episode(name: "EP1", url: "https://cdn.example/a1.m3u8")]]
        )
        api.detailResponse = VideoDetail(
            id: "video-1", title: "Replacement", type: "movie", year: "2026",
            cover: "cover-b", desc: "new description", director: "", actor: "", area: "",
            episodes: [[Episode(name: "EP2", url: "https://cdn.example/b2.m3u8")]]
        )
        let vm = PlayerViewModel(
            apiClient: api,
            modelContext: container.mainContext,
            serverURL: "https://kmtv.example",
            sources: [
                SourceResult(
                    sourceKey: "source-a",
                    sourceName: "Source A",
                    videoId: "video-1",
                    durationMs: 0,
                    episodes: initialDetail.episodes.first ?? []
                ),
                SourceResult(
                    sourceKey: "source-b",
                    sourceName: "Source B",
                    videoId: "video-1",
                    durationMs: 0,
                    episodes: []
                )
            ],
            sourceKey: "source-a",
            videoId: "video-1",
            title: "Video"
        )
        vm.detail = initialDetail

        await vm.switchSource("source-b")

        XCTAssertEqual(vm.currentSourceKey, "source-b")
        XCTAssertEqual(vm.detail?.title, "Video")
        XCTAssertEqual(vm.detail?.cover, "cover-a")
        XCTAssertEqual(vm.episodes.map(\.name), ["EP2"])
        XCTAssertEqual(vm.currentEpisodeIndex, 0)
    }

    @MainActor
    func testLoadDetailAppliesInitialEpisodeIndex() async throws {
        let container = try ModelContainerFactory.makeInMemory()
        let api = FakePlayerAPI()
        api.detailResponse = VideoDetail(
            id: "video-1", title: "Video", type: "show", year: "2026",
            cover: "", desc: "", director: "", actor: "", area: "",
            episodes: [[
                Episode(name: "EP1", url: "https://cdn.example/ep1.m3u8"),
                Episode(name: "EP2", url: "https://cdn.example/ep2.m3u8"),
                Episode(name: "EP3", url: "https://cdn.example/ep3.m3u8")
            ]]
        )
        let vm = PlayerViewModel(
            apiClient: api,
            modelContext: container.mainContext,
            serverURL: "https://kmtv.example",
            sources: [SourceResult(
                sourceKey: "source-a",
                sourceName: "Source A",
                videoId: "video-1",
                durationMs: 0,
                episodes: []
            )],
            sourceKey: "source-a",
            videoId: "video-1",
            title: "Video",
            initialEpisodeIndex: 2
        )

        let ok = await vm.loadDetail(sourceKey: "source-a", videoId: "video-1")

        XCTAssertTrue(ok)
        XCTAssertEqual(vm.currentEpisodeIndex, 2)
        XCTAssertEqual(vm.currentEpisodeName, "EP3")
    }

    @MainActor
    func testLoadDetailClampsInitialEpisodeIndexToAvailableEpisodes() async throws {
        let container = try ModelContainerFactory.makeInMemory()
        let api = FakePlayerAPI()
        api.detailResponse = VideoDetail(
            id: "video-1", title: "Video", type: "show", year: "2026",
            cover: "", desc: "", director: "", actor: "", area: "",
            episodes: [[
                Episode(name: "EP1", url: "https://cdn.example/ep1.m3u8"),
                Episode(name: "EP2", url: "https://cdn.example/ep2.m3u8"),
                Episode(name: "EP3", url: "https://cdn.example/ep3.m3u8")
            ]]
        )
        let vm = PlayerViewModel(
            apiClient: api,
            modelContext: container.mainContext,
            serverURL: "https://kmtv.example",
            sources: [SourceResult(
                sourceKey: "source-a",
                sourceName: "Source A",
                videoId: "video-1",
                durationMs: 0,
                episodes: []
            )],
            sourceKey: "source-a",
            videoId: "video-1",
            title: "Video",
            initialEpisodeIndex: 9
        )

        let ok = await vm.loadDetail(sourceKey: "source-a", videoId: "video-1")

        XCTAssertTrue(ok)
        XCTAssertEqual(vm.currentEpisodeIndex, 2)
        XCTAssertEqual(vm.currentEpisodeName, "EP3")
    }

    @MainActor
    func testCoverHintFillsMissingDetailCoverForWatchHistory() async throws {
        let container = try ModelContainerFactory.makeInMemory()
        let api = FakePlayerAPI()
        api.detailResponse = VideoDetail(
            id: "video-1", title: "Video", type: "show", year: "2026",
            cover: "", desc: "", director: "", actor: "", area: "",
            episodes: [[Episode(name: "EP1", url: "https://cdn.example/ep1.m3u8")]]
        )
        let vm = PlayerViewModel(
            apiClient: api,
            modelContext: container.mainContext,
            serverURL: "https://kmtv.example",
            sources: [SourceResult(
                sourceKey: "source-a",
                sourceName: "Source A",
                videoId: "video-1",
                durationMs: 0,
                episodes: []
            )],
            sourceKey: "source-a",
            videoId: "video-1",
            title: "Video",
            coverHint: "https://img.example/cover.jpg"
        )

        let ok = await vm.loadDetail(sourceKey: "source-a", videoId: "video-1")
        vm.onTimeUpdate(current: 10, total: 120)

        let history = WatchHistoryItem.recent(in: container.mainContext, serverURL: "https://kmtv.example")
        XCTAssertTrue(ok)
        XCTAssertEqual(vm.detail?.cover, "https://img.example/cover.jpg")
        XCTAssertEqual(history.first?.cover, "https://img.example/cover.jpg")
    }
}
