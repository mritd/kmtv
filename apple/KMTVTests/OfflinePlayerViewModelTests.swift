import SwiftData
import XCTest
@testable import KMTV

/// Covers the offline player's start position, next-episode choice, and checkpoints.
///
/// 覆盖离线播放器的起播位置, 下一集选择与进度保存.
@MainActor
final class OfflinePlayerViewModelTests: XCTestCase {
    private let scope = syncScopeKey(serverURL: "https://kmtv.example", userID: 1)
    private var root: URL!
    private var container: ModelContainer!
    private var manager: DownloadManager!
    private var transport: FakeDownloadTransport!
    private var sync: SyncStore!

    override func setUp() async throws {
        root = FileManager.default.temporaryDirectory.appending(path: "opv-\(UUID().uuidString)")
        container = try ModelContainerFactory.makeInMemory()
        transport = FakeDownloadTransport()
        let layout = DownloadLayout(root: root)
        manager = DownloadManager(context: container.mainContext, layout: layout, transport: transport,
                                  defaults: UserDefaults(suiteName: "opv-\(UUID().uuidString)")!,
                                  freeSpace: { .max }, outstandingLimit: 100)
        await manager.activate(scopeKey: scope, preparer: FakePreparer())
        let requests = (0..<3).map {
            DownloadEpisodeRequest(sourceKey: "src", sourceName: "Source", videoId: "v1", episodeIndex: $0,
                                   episodeName: "EP\($0 + 1)", lineIndex: 0, episodeCount: 3,
                                   episodeURL: "https://cdn.example/ep\($0).m3u8")
        }
        _ = try manager.enqueue(show: DownloadShowInfo(title: "Show", cover: "c", type: "tv", year: "2026", coverURL: nil),
                                episodes: requests)
        await manager.waitForIdle()
        // Complete episodes 0 and 2; episode 1 stays downloading.
        //
        // 完成第 0 与第 2 集; 第 1 集保持下载中.
        for index in [0, 2] {
            let key = try XCTUnwrap(episode(index)).episodeKey
            for id in transport.live.keys.filter({ $0.episodeKey == key }) { await transport.finish(id, layout: layout) }
        }
        sync = makeSyncStore(container)
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: root)
    }

    private func episode(_ index: Int) -> DownloadEpisode? {
        manager.episode(scopeKey: scope, sourceKey: "src", videoId: "v1", episodeIndex: index)
    }

    private func viewModel(_ index: Int) throws -> OfflinePlayerViewModel {
        let ep = try XCTUnwrap(episode(index))
        let show = try XCTUnwrap(manager.show(scopeKey: scope, showKey: ep.showKey))
        return OfflinePlayerViewModel(manager: manager, show: show, episode: ep, modelContext: container.mainContext,
                                      serverURL: "https://kmtv.example", syncStore: sync)
    }

    func testStartTimePrefersExactWatchRecordThenLocalPosition() throws {
        let ep = try XCTUnwrap(episode(0))
        let exact = WatchPayload(title: "Show", sourceKey: "src", videoId: "v1", episode: "EP1", episodeIndex: 0,
                                 progressSec: 90, durationSec: 600)
        XCTAssertEqual(OfflinePlayerViewModel.startTime(record: exact, episode: ep, skipIntroSeconds: 10), 90)
        let other = WatchPayload(title: "Show", sourceKey: "other", videoId: "v1", episode: "EP1", episodeIndex: 0,
                                 progressSec: 90, durationSec: 600)
        ep.positionSec = 30
        XCTAssertEqual(OfflinePlayerViewModel.startTime(record: other, episode: ep, skipIntroSeconds: 10), 30)
        ep.finished = true
        XCTAssertEqual(OfflinePlayerViewModel.startTime(record: nil, episode: ep, skipIntroSeconds: 10), 10)
    }

    func testNextEpisodeSkipsUnfinishedDownloads() throws {
        XCTAssertEqual(try viewModel(0).nextEpisode?.episodeIndex, 2)
        XCTAssertNil(try viewModel(2).nextEpisode)
    }

    func testCachedNextEpisodeIsCheckedBeforeUse() throws {
        let vm = try viewModel(0)
        XCTAssertEqual(vm.nextEpisode?.episodeIndex, 2)
        // The next download is damaged while this one plays; next must not switch to it.
        //
        // 播放期间下一集的下载被标记为损坏; 下一集操作不能切换过去.
        manager.markDamaged(try XCTUnwrap(episode(2)))
        vm.playNext()
        XCTAssertEqual(vm.episode.episodeIndex, 0)
        XCTAssertNil(vm.nextEpisode)
        XCTAssertNil(vm.restartTask)
    }

    func testCheckpointsWriteWatchRecordAndLocalPosition() throws {
        let vm = try viewModel(0)
        vm.record(current: 100, duration: 1000, finished: false)
        let record = try XCTUnwrap(sync.watch(title: "Show"))
        XCTAssertEqual(record.progressSec, 100)
        XCTAssertEqual(record.episodeIndex, 0)
        XCTAssertFalse(record.completed)
        XCTAssertEqual(episode(0)?.positionSec, 100)
        XCTAssertEqual(episode(0)?.finished, false)
    }

    func testOnlyTheLastEpisodeCompletesTheTitle() throws {
        try viewModel(0).record(current: 1000, duration: 1000, finished: true)
        XCTAssertEqual(sync.watch(title: "Show")?.completed, false)
        XCTAssertEqual(episode(0)?.finished, true)
        try viewModel(2).record(current: 1000, duration: 1000, finished: true)
        XCTAssertEqual(sync.watch(title: "Show")?.completed, true)
    }

    private struct Boom: Error {}

    private func failingViewModel(_ index: Int) throws -> OfflinePlayerViewModel {
        let ep = try XCTUnwrap(episode(index))
        let show = try XCTUnwrap(manager.show(scopeKey: scope, showKey: ep.showKey))
        return OfflinePlayerViewModel(manager: manager, show: show, episode: ep, modelContext: container.mainContext,
                                      serverURL: "https://kmtv.example", syncStore: sync,
                                      playbackURL: { _ in throw Boom() })
    }

    func testIntactFilesRebuildOnceThenShowErrorAndKeepFiles() async throws {
        let vm = try failingViewModel(0)
        let ep = try XCTUnwrap(episode(0))
        XCTAssertTrue(manager.filesIntact(ep))
        await vm.start()
        XCTAssertNil(vm.error)
        XCTAssertEqual(ep.state, .completed)
        await vm.restartTask?.value
        XCTAssertNotNil(vm.error)
        XCTAssertEqual(ep.state, .completed)
        XCTAssertTrue(manager.filesIntact(ep))
    }

    func testMissingFilesMarkTheEpisodeDamaged() async throws {
        let vm = try failingViewModel(0)
        let ep = try XCTUnwrap(episode(0))
        let dir = DownloadLayout(root: root).episodeDir(scopeHash: ep.scopeHash, showDir: ep.showDir, episodeDir: ep.episodeDir)
        try FileManager.default.removeItem(at: DownloadLayout(root: root).playlistURL(episodeDir: dir))
        await vm.start()
        XCTAssertEqual(ep.state, .failed)
        XCTAssertEqual(ep.failure, .damaged)
        XCTAssertNotNil(vm.error)
    }

    func testClosedViewModelDoesNotCreateAPlayerFromAPendingStart() async throws {
        var gate: CheckedContinuation<Void, Never>?
        let ep = try XCTUnwrap(episode(0))
        let show = try XCTUnwrap(manager.show(scopeKey: scope, showKey: ep.showKey))
        let vm = OfflinePlayerViewModel(manager: manager, show: show, episode: ep, modelContext: container.mainContext,
                                        serverURL: "https://kmtv.example", syncStore: sync,
                                        playbackURL: { _ in
                                            await withCheckedContinuation { gate = $0 }
                                            return URL(string: "http://127.0.0.1:1/index.m3u8")!
                                        })
        let task = Task { await vm.start() }
        while gate == nil { await Task.yield() }
        vm.close()
        gate?.resume()
        await task.value
        XCTAssertNil(vm.player)
    }

    func testSuspendDuringFirstLoadDefersPlayerUntilResume() async throws {
        var gate: CheckedContinuation<Void, Never>?
        let ep = try XCTUnwrap(episode(0))
        let show = try XCTUnwrap(manager.show(scopeKey: scope, showKey: ep.showKey))
        let vm = OfflinePlayerViewModel(manager: manager, show: show, episode: ep, modelContext: container.mainContext,
                                        serverURL: "https://kmtv.example", syncStore: sync,
                                        playbackURL: { _ in
                                            await withCheckedContinuation { gate = $0 }
                                            return URL(string: "http://127.0.0.1:1/index.m3u8")!
                                        })
        let task = Task { await vm.start() }
        while gate == nil { await Task.yield() }
        vm.suspend()
        gate?.resume()
        await task.value
        XCTAssertNil(vm.player)
    }

    func testItemThatNeverLoadsFailsAfterTheLoadTimeout() async throws {
        let hanging = HangingServer()
        let url = try await hanging.start()
        defer { hanging.stop() }
        let ep = try XCTUnwrap(episode(0))
        let show = try XCTUnwrap(manager.show(scopeKey: scope, showKey: ep.showKey))
        let vm = OfflinePlayerViewModel(manager: manager, show: show, episode: ep, modelContext: container.mainContext,
                                        serverURL: "https://kmtv.example", syncStore: sync,
                                        playbackURL: { _ in url }, loadTimeout: .milliseconds(300))
        defer { vm.close() }
        await vm.start()
        XCTAssertNotNil(vm.player)
        // The first timeout rebuilds the item once (files are intact); the second shows the error.
        //
        // 第一次超时会重建一次 item (文件完好); 第二次超时显示错误.
        for _ in 0..<100 where vm.error == nil { try await Task.sleep(for: .milliseconds(50)) }
        XCTAssertNotNil(vm.error)
        XCTAssertEqual(ep.state, .completed)
    }

    func testProgressSavesAreThrottledByWallClockNotPosition() throws {
        let clock = InstantBox()
        let ep = try XCTUnwrap(episode(0))
        let show = try XCTUnwrap(manager.show(scopeKey: scope, showKey: ep.showKey))
        let vm = OfflinePlayerViewModel(manager: manager, show: show, episode: ep, modelContext: container.mainContext,
                                        serverURL: "https://kmtv.example", syncStore: sync, now: { clock.now })
        vm.handleTime(current: 10, total: 1000)
        XCTAssertEqual(episode(0)?.positionSec, 10)
        // Scrubbing jumps the position many times within a second; none of those callbacks save.
        //
        // 拖动进度条会在一秒内多次跳转位置; 这些回调都不会保存.
        for position in stride(from: 50.0, through: 600, by: 50) {
            vm.handleTime(current: position, total: 1000)
        }
        clock.advance(.seconds(4))
        vm.handleTime(current: 610, total: 1000)
        XCTAssertEqual(episode(0)?.positionSec, 10)
        XCTAssertEqual(sync.watch(title: "Show")?.progressSec, 10)
        clock.advance(.seconds(1))
        vm.handleTime(current: 611, total: 1000)
        XCTAssertEqual(episode(0)?.positionSec, 611)
        XCTAssertEqual(sync.watch(title: "Show")?.progressSec, 611)
    }

    func testRestartUsesTheCheckpointInsteadOfStartTime() throws {
        let ep = try XCTUnwrap(episode(2))
        ep.finished = true
        let record = WatchPayload(title: "Show", sourceKey: "src", videoId: "v1", episode: "EP3", episodeIndex: 2,
                                  progressSec: 990, durationSec: 1000, completed: true)
        XCTAssertEqual(OfflinePlayerViewModel.resolveStart(explicit: 990, record: record, episode: ep, skipIntroSeconds: 10), 990)
        XCTAssertEqual(OfflinePlayerViewModel.resolveStart(explicit: nil, record: record, episode: ep, skipIntroSeconds: 10), 10)
    }
}

// MARK: - Transport through the playback engine

extension OfflinePlayerViewModelTests {
    /// A model for episode `index` that plays through `engine` from a fixed loopback URL.
    ///
    /// 剧集 `index` 的模型, 通过 `engine` 播放固定的 loopback URL.
    private func engineViewModel(_ index: Int, engine: FakePlaybackEngine) throws -> OfflinePlayerViewModel {
        let ep = try XCTUnwrap(episode(index))
        let show = try XCTUnwrap(manager.show(scopeKey: scope, showKey: ep.showKey))
        return OfflinePlayerViewModel(manager: manager, show: show, episode: ep, modelContext: container.mainContext,
                                      serverURL: "https://kmtv.example", syncStore: sync,
                                      playbackURL: { _ in URL(string: "http://127.0.0.1:1/index.m3u8")! },
                                      engine: engine)
    }

    func testStartPlaysTheLocalItemWithItsTitlesAndWatchesPauses() async throws {
        let engine = FakePlaybackEngine()
        let vm = try engineViewModel(0, engine: engine)

        await vm.start()

        let start = try XCTUnwrap(engine.starts.first)
        XCTAssertEqual(engine.starts.count, 1)
        XCTAssertFalse(start.allowsExternalPlayback, "AirPlay cannot reach the loopback server")
        XCTAssertEqual(start.rate, 1)
        XCTAssertEqual(start.loadTimeout, PlaybackCoordinator.localLoadTimeout)
        XCTAssertEqual(engine.metadata?.title, "Show")
        XCTAssertEqual(engine.metadata?.subtitle, "EP1")
        XCTAssertTrue(engine.observesPause)
        XCTAssertNotNil(vm.player)
    }

    func testSuspendCheckpointsAndPausesAndResumeRebuildsAtTheCheckpoint() async throws {
        let engine = FakePlaybackEngine()
        let vm = try engineViewModel(0, engine: engine)
        await vm.start()
        engine.playhead = 120
        engine.duration = 600

        vm.suspend()

        XCTAssertEqual(engine.watchdogSuspensions, 1)
        XCTAssertEqual(engine.pauses, 1)
        XCTAssertEqual(episode(0)?.positionSec, 120)
        XCTAssertEqual(vm.resumePosition, 120)

        await vm.resume()

        XCTAssertEqual(engine.starts.count, 2)
        XCTAssertEqual(engine.starts.last?.startTime, 120)
    }

    func testCloseCheckpointsAndReleasesTheEngine() async throws {
        let engine = FakePlaybackEngine()
        let vm = try engineViewModel(0, engine: engine)
        await vm.start()
        engine.playhead = 200
        engine.duration = 600

        vm.close()

        XCTAssertEqual(engine.cleanups, 1)
        XCTAssertEqual(engine.pauseObservationsCleared, 1, "close removes the pause observation itself")
        XCTAssertFalse(engine.observesPause)
        XCTAssertNil(vm.player)
        XCTAssertEqual(episode(0)?.positionSec, 200)
        XCTAssertEqual(sync.watch(title: "Show")?.progressSec, 200)
    }

    func testAnItemFailureWithIntactFilesRebuildsOnceAtTheCheckpoint() async throws {
        let engine = FakePlaybackEngine()
        let vm = try engineViewModel(0, engine: engine)
        await vm.start()
        engine.playhead = 90
        engine.duration = 600

        engine.callbacks?.onError(nil)
        XCTAssertNil(vm.player)
        XCTAssertEqual(engine.cleanups, 1)
        // The files are checked off the main actor before the outcome is decided.
        //
        // 先在主 actor 之外检查文件, 再决定结果.
        await vm.failureTask?.value
        await vm.restartTask?.value

        XCTAssertEqual(engine.starts.count, 2)
        XCTAssertEqual(engine.starts.last?.startTime, 90)
        XCTAssertNil(vm.error)

        engine.callbacks?.onError("failed again")
        await vm.failureTask?.value
        XCTAssertNotNil(vm.error)
        XCTAssertEqual(try XCTUnwrap(episode(0)).state, .completed)
    }

    func testAnItemFailureWithMissingFilesMarksTheEpisodeDamaged() async throws {
        let engine = FakePlaybackEngine()
        let vm = try engineViewModel(0, engine: engine)
        await vm.start()
        let ep = try XCTUnwrap(episode(0))
        let layout = DownloadLayout(root: root)
        let dir = layout.episodeDir(scopeHash: ep.scopeHash, showDir: ep.showDir, episodeDir: ep.episodeDir)
        try FileManager.default.removeItem(at: layout.playlistURL(episodeDir: dir))

        engine.callbacks?.onError(nil)
        XCTAssertNil(vm.player, "the player goes away before the files are checked")
        await vm.failureTask?.value

        XCTAssertEqual(ep.failure, .damaged)
        XCTAssertNotNil(vm.error)
        XCTAssertNil(vm.restartTask)
    }

    func testAFailureOvertakenByAStartLeavesTheNewItemAlone() async throws {
        let engine = FakePlaybackEngine()
        let vm = try engineViewModel(0, engine: engine)
        await vm.start()
        let ep = try XCTUnwrap(episode(0))
        let layout = DownloadLayout(root: root)
        let dir = layout.episodeDir(scopeHash: ep.scopeHash, showDir: ep.showDir, episodeDir: ep.episodeDir)
        try FileManager.default.removeItem(at: layout.playlistURL(episodeDir: dir))

        engine.callbacks?.onError(nil)
        // A start lands while the files are being checked; the stale check decides nothing.
        //
        // 文件检查期间有新的 start 落地; 过期的检查不做任何决定.
        await vm.start()
        await vm.failureTask?.value

        XCTAssertNotNil(vm.player)
        XCTAssertNil(vm.error)
        XCTAssertNil(ep.failure)
        XCTAssertEqual(engine.starts.count, 2)
    }

    func testTheEndOfAnEpisodeFinishesItAndPlaysTheNextCompletedOne() async throws {
        let engine = FakePlaybackEngine()
        let vm = try engineViewModel(0, engine: engine)
        await vm.start()
        engine.callbacks?.onTime(500, 600)

        engine.callbacks?.onEnd()
        await vm.restartTask?.value

        XCTAssertEqual(episode(0)?.finished, true)
        XCTAssertEqual(episode(0)?.positionSec, 600)
        XCTAssertEqual(vm.episode.episodeIndex, 2)
        XCTAssertEqual(engine.starts.count, 2)
        XCTAssertEqual(engine.metadata?.subtitle, "EP3")
    }

    func testThePausedStateShowsOnlyAfterTheDebounce() async throws {
        let engine = FakePlaybackEngine()
        let vm = try engineViewModel(0, engine: engine)
        await vm.start()

        engine.reportPaused(true)
        XCTAssertFalse(vm.isPaused)
        await waitUntil { vm.isPaused }
        XCTAssertTrue(vm.isPaused)
        XCTAssertTrue(vm.showsUpNext)

        engine.reportPaused(false)
        XCTAssertFalse(vm.isPaused)
    }
}

/// Settable instant for the view model's injected clock.
///
/// 供视图模型注入时钟使用的可设置时间点.
@MainActor
private final class InstantBox {
    private(set) var now = ContinuousClock.now

    /// Moves the clock forward.
    ///
    /// 将时钟向前推进.
    func advance(_ duration: Duration) { now = now.advanced(by: duration) }
}
