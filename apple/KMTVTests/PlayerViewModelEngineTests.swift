import SwiftData
import XCTest
@testable import KMTV

/// Drives `PlayerViewModel` through `FakePlaybackEngine`, covering the transport paths a real
/// AVPlayer cannot be scripted for: seeking, skipping, checkpoints read from the player, the end
/// of the last episode, rate changes, play and pause, and callbacks from a replaced item.
///
/// 通过 `FakePlaybackEngine` 驱动 `PlayerViewModel`, 覆盖真实 AVPlayer 无法脚本化的播放传输路径:
/// seek, 快进快退, 从播放器读取的检查点, 最后一集的结束, 倍速变化, 播放与暂停, 以及已替换 item 的回调.
@MainActor
final class PlayerViewModelEngineTests: XCTestCase {
    private var container: ModelContainer!
    private var sync: SyncStore!
    private var engine: FakePlaybackEngine!

    override func setUp() async throws {
        container = try ModelContainerFactory.makeInMemory()
        sync = makeSyncStore(container)
        engine = FakePlaybackEngine()
    }

    /// A model with a loaded detail of `episodes` episodes whose first item already started.
    ///
    /// 已加载含 `episodes` 集详情且第一个 item 已启动的模型.
    private func startedViewModel(episodes: Int = 1) async throws -> PlayerViewModel {
        let api = PlaybackAPIFake()
        api.detailResponse.episodes = [(1...episodes).map { Episode(name: "EP\($0)", url: "https://cdn.example/\($0).m3u8") }]
        let vm = PlayerViewModel(
            apiClient: api, modelContext: container.mainContext, serverURL: "https://kmtv.example",
            syncStore: sync, syncEngine: nil,
            sources: [SourceResult(sourceKey: "s1", sourceName: "S1", videoId: "video-1", durationMs: 0, episodes: [])],
            sourceKey: "s1", videoId: "video-1", title: "Video", engine: engine
        )
        _ = await vm.loadDetail(sourceKey: "s1", videoId: "video-1")
        await vm.startPlaybackAsync()
        XCTAssertEqual(engine.starts.count, 1)
        XCTAssertNotNil(vm.player)
        return vm
    }

    func testALateSeekCompletionFromAReplacedOrClosedItemChangesNothing() async throws {
        let vm = try await startedViewModel(episodes: 2)
        engine.callbacks?.onTime(600, 1200)
        vm.seek(to: 120)

        // The next episode replaces the item while its seek is still pending.
        //
        // 下一集在 seek 尚未完成时替换了 item.
        vm.playNextEpisode()
        await waitUntil { self.engine.starts.count == 2 }
        XCTAssertFalse(vm.isSeeking, "a new item starts without a seek")
        engine.completeSeek(finished: true)
        XCTAssertFalse(vm.isSeeking)

        vm.seek(to: 30)
        XCTAssertTrue(vm.isSeeking)
        vm.close()
        engine.completeSeek(finished: true)
        XCTAssertEqual(engine.seeks, [120, 30])
        XCTAssertNil(vm.player)
    }

    func testSeekWaitsForTheSeekThatArrives() async throws {
        let vm = try await startedViewModel()
        engine.callbacks?.onTime(600, 1200)

        vm.seek(to: 120)
        vm.seek(to: 240)
        XCTAssertEqual(engine.seeks, [120, 240])
        XCTAssertTrue(vm.isSeeking)
        XCTAssertEqual(vm.currentTime, 240)

        engine.completeSeek(finished: false)
        XCTAssertTrue(vm.isSeeking, "the superseded seek does not end the seeking state")
        engine.completeSeek(finished: true)
        XCTAssertFalse(vm.isSeeking)
    }

    func testSkipSeeksFromThePlayheadAndNeverBeforeTheStart() async throws {
        let vm = try await startedViewModel()
        engine.playhead = 100

        vm.skip(by: 30)
        vm.skip(by: -500)

        XCTAssertEqual(engine.seeks, [130, 0])
    }

    func testScrubEndingWithAPlayerSeeksToTheDraggedPosition() async throws {
        let vm = try await startedViewModel()
        engine.callbacks?.onTime(100, 1000)

        vm.beginScrub()
        vm.updateScrub(toFraction: 0.25)
        vm.endScrub(atFraction: 0.25)

        XCTAssertEqual(engine.seeks, [250])
        XCTAssertTrue(vm.isSeeking)
        engine.completeSeek(finished: true)
        XCTAssertFalse(vm.isSeeking)
    }

    func testCheckpointWithoutArgumentsReadsThePlayer() async throws {
        let vm = try await startedViewModel()
        engine.playhead = 300

        // No duration yet: nothing to save.
        //
        // 尚无时长: 没有可保存的内容.
        engine.duration = nil
        vm.checkpoint()
        XCTAssertNil(sync.watch(title: "Video"))

        engine.duration = 1000
        vm.checkpoint()
        XCTAssertEqual(sync.watch(title: "Video")?.progressSec, 300)
        XCTAssertEqual(sync.watch(title: "Video")?.durationSec, 1000)
    }

    func testTheEndOfTheLastEpisodeUsesTheItemDuration() async throws {
        let vm = try await startedViewModel()
        engine.callbacks?.onTime(100, 1000)
        engine.duration = 1500

        engine.callbacks?.onEnd()

        XCTAssertEqual(sync.watch(title: "Video")?.progressSec, 1500)
        XCTAssertEqual(sync.watch(title: "Video")?.completed, true)
        XCTAssertEqual(vm.currentEpisodeIndex, 0)
    }

    func testTheEndFallsBackToTheReportedDurationWithoutAnItemDuration() async throws {
        // Held for the whole test: the callbacks capture the model weakly.
        //
        // 整个测试期间持有模型: 回调对模型是弱引用.
        let vm = try await startedViewModel()
        engine.callbacks?.onTime(100, 1000)
        engine.duration = .nan

        engine.callbacks?.onEnd()

        XCTAssertEqual(sync.watch(title: "Video")?.progressSec, 1000)
        XCTAssertEqual(sync.watch(title: "Video")?.completed, true)
        withExtendedLifetime(vm) {}
    }

    func testTheEndOfAnEarlierEpisodeMovesToTheNext() async throws {
        let vm = try await startedViewModel(episodes: 2)

        engine.callbacks?.onEnd()
        XCTAssertEqual(vm.currentEpisodeIndex, 1)
        await waitUntil { self.engine.starts.count == 2 }

        XCTAssertEqual(engine.starts.count, 2)
        XCTAssertNil(sync.watch(title: "Video")?.completed, "an earlier episode's end finishes nothing")
    }

    func testSetRateReachesTheEngineAndTheNextItem() async throws {
        let vm = try await startedViewModel(episodes: 2)

        vm.setRate(1.5)
        XCTAssertEqual(engine.rates, [1.5])
        XCTAssertEqual(vm.playbackRate, 1.5)

        vm.switchEpisode(1)
        await waitUntil { self.engine.starts.count == 2 }
        XCTAssertEqual(engine.starts.last?.rate, 1.5)
    }

    func testARateChosenInTheSystemControlsIsAdopted() async throws {
        let vm = try await startedViewModel()

        engine.chosenRate = 2
        vm.syncRateFromPlayer()
        XCTAssertEqual(vm.playbackRate, 2)

        engine.chosenRate = 0
        vm.syncRateFromPlayer()
        XCTAssertEqual(vm.playbackRate, 2, "a stopped player's zero rate is not a choice")
    }

    func testTogglePlayPauseCheckpointsOnPauseAndResumesAtTheRate() async throws {
        let vm = try await startedViewModel()
        vm.refreshTransportState(.playing)
        engine.playhead = 50
        engine.duration = 1000

        vm.togglePlayPause()
        XCTAssertEqual(engine.pauses, 1)
        XCTAssertFalse(vm.isPlaying)
        XCTAssertFalse(vm.isBuffering)
        XCTAssertEqual(sync.watch(title: "Video")?.progressSec, 50)

        vm.setRate(2)
        vm.togglePlayPause()
        XCTAssertEqual(engine.resumes, [2])
        XCTAssertTrue(vm.isPlaying)
    }

    func testTransportControlsWithoutAPlayerDoNothing() throws {
        let vm = PlayerViewModel(
            apiClient: PlaybackAPIFake(), modelContext: container.mainContext, serverURL: "https://kmtv.example",
            sources: [], sourceKey: "s1", videoId: "video-1", title: "Video", engine: engine
        )

        vm.togglePlayPause()
        vm.seek(to: 60)
        vm.skip(by: 30)

        XCTAssertEqual(engine.pauses, 0)
        XCTAssertTrue(engine.resumes.isEmpty)
        XCTAssertTrue(engine.seeks.isEmpty)
        XCTAssertFalse(vm.isSeeking)
    }

    func testCallbacksFromAReplacedItemAreIgnored() async throws {
        let vm = try await startedViewModel(episodes: 2)
        let first = try XCTUnwrap(engine.callbacks)

        vm.switchEpisode(1)
        await waitUntil { self.engine.starts.count == 2 }
        engine.callbacks?.onTime(10, 2700)

        first.onTime(2000, 2700)
        first.onBuffer(BufferSample(end: 2600, ahead: 600))
        first.onError("late failure")
        first.onEnd()

        XCTAssertEqual(vm.currentTime, 10)
        XCTAssertEqual(vm.bufferedAheadSeconds, 0)
        XCTAssertNil(vm.error)
        XCTAssertEqual(vm.currentEpisodeIndex, 1)
        XCTAssertEqual(vm.sources.map(\.sourceKey), ["s1"])
    }

    func testAnItemErrorFallsBackAndNothingIsLeft() async throws {
        let vm = try await startedViewModel()

        engine.callbacks?.onError("load failed")

        XCTAssertEqual(vm.error, String(localized: "All sources failed"))
        XCTAssertTrue(vm.sources.isEmpty)
    }

    func testDisappearPausesAndAppearResumesThroughTheEngine() async throws {
        let vm = try await startedViewModel()
        vm.refreshTransportState(.playing)

        vm.disappear()
        XCTAssertEqual(engine.pauses, 1)
        vm.appear()
        XCTAssertEqual(engine.resumes, [1])
    }

    func testWatchdogAndCloseReachTheEngine() async throws {
        let vm = try await startedViewModel()

        vm.suspendLoadWatchdog()
        vm.resumeLoadWatchdog()
        XCTAssertEqual(engine.watchdogSuspensions, 1)
        XCTAssertEqual(engine.watchdogResumptions, 1)

        vm.close()
        XCTAssertEqual(engine.cleanups, 1)
        XCTAssertNil(vm.player)
    }
}
