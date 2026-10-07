#if os(iOS)
import AVFoundation
import Foundation
import Observation
import SwiftData

/// Plays downloaded episodes through the loopback server, without the detail API, and saves
/// progress to the scope's sync store and the episode row.
///
/// 通过 loopback 服务播放已下载的剧集, 不依赖详情接口, 并把进度写入作用域的同步存储与剧集行.
@Observable
@MainActor
final class OfflinePlayerViewModel {
    let show: DownloadShow
    private(set) var episode: DownloadEpisode
    private(set) var player: AVPlayer?
    var error: String?
    /// Whether playback has stayed paused for `pauseDebounce`, and whether the playhead is within
    /// `PlaybackProgressPolicy.upNextLead` of the end (or of the outro skip); the next-episode
    /// button shows only then. Both change only on a flip; the debounce keeps a scrub (which pauses
    /// briefly) from flashing it.
    ///
    /// 播放是否已持续暂停 `pauseDebounce`, 以及播放头是否距结尾 (或片尾跳过点) 不足
    /// `PlaybackProgressPolicy.upNextLead`; 只有此时才显示下一集按钮. 两者只在状态翻转时才会改变;
    /// 防抖让拖动进度 (会短暂暂停) 不会使按钮闪现.
    private(set) var isPaused = false
    private(set) var isNearEnd = false
    /// The next completed episode of the same source and video; recomputed on every start, so the
    /// view never fetches rows while rendering.
    ///
    /// 同一来源与视频的下一个已完成剧集; 每次开始播放时重新计算, 因此视图渲染时不会读取数据行.
    private(set) var nextEpisode: DownloadEpisode?
    /// How long playback must stay paused before the next-episode button appears.
    ///
    /// 播放需持续暂停多久才显示下一集按钮.
    static let pauseDebounce: Duration = .milliseconds(750)

    @ObservationIgnored private let manager: DownloadManager
    @ObservationIgnored private let progressStore: PlaybackProgressStore
    @ObservationIgnored private let syncStore: SyncStore?
    @ObservationIgnored private let engine: any PlaybackEngine
    @ObservationIgnored private let skipIntroSeconds: Int
    @ObservationIgnored private let skipOutroSeconds: Int
    // The save cadence and the once-per-item outro skip, shared with the online player.
    //
    // 保存节奏与每个 item 只触发一次的片尾跳过, 与在线播放器共用.
    @ObservationIgnored private var progress = PlaybackProgressTracker()
    // Pending switch to paused; a resume before it fires cancels it.
    //
    // 待生效的暂停切换; 在其生效前恢复播放会取消它.
    @ObservationIgnored private var pauseDebounceTask: Task<Void, Never>?
    @ObservationIgnored private var lastDuration: TimeInterval = 0
    // One automatic rebuild per episode when playback fails with intact files (for example after
    // the loopback server moved to another port).
    //
    // 文件完好但播放失败时 (例如 loopback 服务换了端口), 每集自动重建一次.
    @ObservationIgnored private var rebuiltAfterFailure = false
    // True between `suspend()` and `resume()`; errors in that window come from the stopped server.
    //
    // 在 `suspend()` 与 `resume()` 之间为 true; 此期间的错误来自已停止的服务.
    @ObservationIgnored private var suspended = false
    // Set by `close()`; a start that was awaiting the loopback URL must not create a player after it.
    //
    // 由 `close()` 设置; 仍在等待 loopback URL 的 start 不得在此之后创建播放器.
    @ObservationIgnored private var closed = false
    // Bumped by every `start`, so an older start that finishes awaiting later is dropped.
    //
    // 每次 `start` 都会递增, 较早的 start 在稍后结束等待时会被丢弃.
    @ObservationIgnored private var startGeneration = 0
    // The position captured by the last checkpoint; rebuilds resume here instead of recomputing
    // the start, because a finished flag set near the end would otherwise restart the episode.
    //
    // 最近一次检查点捕获的位置; 重建时从这里继续而不是重新计算起播位置,
    // 否则临近结尾时设置的 finished 标记会让该集从头开始.
    @ObservationIgnored private(set) var resumePosition: TimeInterval?
    // Pending automatic restart (rebuild after failure, auto-advance); exposed for tests.
    //
    // 待执行的自动重启 (失败后重建, 自动下一集); 供测试使用.
    @ObservationIgnored private(set) var restartTask: Task<Void, Never>?
    // The pending outcome of the last failure, decided once the files were checked; exposed for tests.
    //
    // 最近一次失败待定的结果, 文件检查完成后才确定; 供测试使用.
    @ObservationIgnored private(set) var failureTask: Task<Void, Never>?
    @ObservationIgnored private let playbackURL: @MainActor (DownloadEpisode) async throws -> URL
    @ObservationIgnored private let now: @MainActor () -> ContinuousClock.Instant
    // How long an item may take to become ready before it counts as a failure.
    //
    // item 变为就绪前可等待的时长, 超时即视为失败.
    @ObservationIgnored private let loadTimeout: Duration

    init(manager: DownloadManager, show: DownloadShow, episode: DownloadEpisode, modelContext: ModelContext,
         serverURL: String, syncStore: SyncStore?,
         playbackURL: (@MainActor (DownloadEpisode) async throws -> URL)? = nil,
         now: @escaping @MainActor () -> ContinuousClock.Instant = { ContinuousClock.now },
         loadTimeout: Duration = PlaybackCoordinator.localLoadTimeout,
         engine: any PlaybackEngine = PlaybackCoordinator()) {
        self.engine = engine
        self.manager = manager
        self.now = now
        self.loadTimeout = loadTimeout
        self.playbackURL = playbackURL ?? { [manager] in try await manager.localPlaybackURL(for: $0) }
        self.show = show
        self.episode = episode
        self.syncStore = syncStore
        progressStore = PlaybackProgressStore(modelContext: modelContext, serverURL: serverURL, syncStore: syncStore,
                                              title: show.title)
        let settings = progressStore.loadSettings()
        skipIntroSeconds = settings.skipIntroSeconds
        skipOutroSeconds = settings.skipOutroSeconds
        nextEpisode = findNextEpisode()
    }

    /// Start position: an unfinished watch record saved for exactly this source, video, line, and
    /// episode; otherwise the episode's own unfinished position; otherwise the intro skip.
    ///
    /// 起播位置: 若有为完全相同的来源, 视频, 线路与分集保存且未看完的观看记录, 则用它; 否则用该集自身
    /// 未看完的位置; 再否则使用跳过片头秒数.
    static func startTime(record: WatchPayload?, episode: DownloadEpisode, skipIntroSeconds: Int) -> TimeInterval {
        if let record, !record.completed, record.sourceKey == episode.sourceKey, record.videoId == episode.videoId,
           record.groupIndex == episode.lineIndex, record.episodeIndex == episode.episodeIndex, record.progressSec > 0 {
            return record.progressSec
        }
        if !episode.finished, episode.positionSec > 0 { return episode.positionSec }
        return skipIntroSeconds > 0 ? TimeInterval(skipIntroSeconds) : 0
    }

    /// The start position for a (re)start: the explicit checkpoint position when given, otherwise
    /// `startTime(record:episode:skipIntroSeconds:)`.
    ///
    /// (重新) 起播位置: 有明确的检查点位置时用它, 否则使用 `startTime(record:episode:skipIntroSeconds:)`.
    static func resolveStart(explicit: TimeInterval?, record: WatchPayload?, episode: DownloadEpisode,
                             skipIntroSeconds: Int) -> TimeInterval {
        explicit ?? startTime(record: record, episode: episode, skipIntroSeconds: skipIntroSeconds)
    }

    private func findNextEpisode() -> DownloadEpisode? {
        // From the whole library: the next episode may have been downloaded under another account.
        //
        // 从整个下载库中查找: 下一集可能是在另一个账号下下载的.
        manager.libraryEpisodes(showKey: episode.showKey)
            .filter { $0.sourceKey == episode.sourceKey && $0.videoId == episode.videoId
                && $0.state == .completed && $0.episodeIndex > episode.episodeIndex }
            .min { $0.episodeIndex < $1.episodeIndex }
    }

    /// Starts the current episode.
    ///
    /// 开始播放当前剧集.
    ///
    /// `position` overrides the computed start, for resuming at a checkpoint.
    ///
    /// `position` 覆盖计算出的起播位置, 用于从检查点继续.
    func start(at position: TimeInterval? = nil) async {
        guard !closed else { return }
        error = nil
        manager.offlinePlaybackActive = true
        let next = findNextEpisode()
        if next !== nextEpisode { nextEpisode = next }
        startGeneration += 1
        let generation = startGeneration
        let url: URL
        do {
            url = try await playbackURL(episode)
        } catch {
            guard !closed, generation == startGeneration else { return }
            await fail()?.value
            return
        }
        guard !closed, !Task.isCancelled, !suspended, generation == startGeneration else { return }
        let start = Self.resolveStart(explicit: position, record: syncStore?.watch(title: show.title),
                                      episode: episode, skipIntroSeconds: skipIntroSeconds)
        progress.beginItem(at: now())
        isNearEnd = false
        engine.start(url: url, startTime: start, rate: 1, allowsExternalPlayback: false, loadTimeout: loadTimeout,
                     callbacks: PlaybackCallbacks(
                         onTime: { [weak self] current, total in self?.handleTime(current: current, total: total) },
                         onBuffer: { _ in },
                         onEnd: { [weak self] in self?.finishCurrent() },
                         onError: { [weak self] _ in self?.fail() }
                     ))
        player = engine.player
        // The system player shows the show and episode names as its title, so no overlay has to sit
        // on the video.
        //
        // 系统播放器会将剧名与集名显示为标题, 因此无需在视频上叠加视图.
        engine.setTitleMetadata(title: show.title, subtitle: episode.episodeName)
        engine.observePause { [weak self] paused in self?.pauseChanged(paused) }
    }

    /// Whether the next-episode button shows: a next episode exists and playback is paused or near
    /// the end.
    ///
    /// 是否显示下一集按钮: 存在下一集, 且播放已暂停或接近结尾.
    var showsUpNext: Bool {
        (isPaused || isNearEnd) && nextEpisode != nil
    }

    /// Shows the paused state only after `pauseDebounce`; playing again clears it at once.
    ///
    /// 只在 `pauseDebounce` 之后才显示暂停状态; 恢复播放会立即清除.
    private func pauseChanged(_ paused: Bool) {
        pauseDebounceTask?.cancel()
        pauseDebounceTask = nil
        guard paused else {
            if isPaused { isPaused = false }
            return
        }
        guard !isPaused else { return }
        pauseDebounceTask = Task { [weak self] in
            try? await Task.sleep(for: Self.pauseDebounce)
            guard !Task.isCancelled, let self, !self.isPaused else { return }
            self.isPaused = true
        }
    }

    /// Plays the next completed episode, if any.
    ///
    /// 播放下一个已完成的剧集 (如有).
    func playNext() {
        checkpoint()
        guard !closed, let next = validNextEpisode() else { return }
        switchEpisode(to: next)
    }

    /// The cached next episode when it is still stored and completed; otherwise looks again, so a
    /// download deleted or damaged meanwhile is never played.
    ///
    /// 若缓存的下一集仍在存储中且已完成则返回它; 否则重新查找, 因此期间被删除或损坏的下载不会被播放.
    private func validNextEpisode() -> DownloadEpisode? {
        if let next = nextEpisode, !next.isDeleted, next.modelContext != nil, next.state == .completed { return next }
        let next = findNextEpisode()
        if next !== nextEpisode { nextEpisode = next }
        return next
    }

    private func switchEpisode(to next: DownloadEpisode) {
        episode = next
        rebuiltAfterFailure = false
        resumePosition = nil
        restartTask = Task { await start() }
    }

    /// Checkpoints and pauses when the app leaves the foreground. The player stays, so the screen
    /// keeps its state; the loopback server stops listening until `resume()`.
    ///
    /// App 离开前台时写入检查点并暂停. 播放器保留, 界面状态不变; loopback 服务在 `resume()` 之前停止监听.
    func suspend() {
        guard !suspended else { return }
        suspended = true
        // Without a player the first load is still pending; `start` drops itself while suspended
        // and `resume()` starts it again.
        //
        // 没有播放器时首次加载仍在进行; `start` 在挂起期间会自行放弃, 由 `resume()` 重新开始.
        guard player != nil else { return }
        // The loopback server stops in the background; a load that has not finished must not time
        // out there. `resume()` builds a new item with a fresh watchdog.
        //
        // loopback 服务在后台会停止; 尚未完成的加载不能在后台超时. `resume()` 会构建新的 item 并启用新的
        // 看门狗.
        engine.suspendLoadWatchdog()
        checkpoint()
        engine.pause()
    }

    /// Rebuilds the item at the checkpoint when the app returns, because the connections of the
    /// old item died with the server's listener.
    ///
    /// App 返回时在检查点处重建 item, 因为旧 item 的连接已随服务的 listener 一起失效.
    func resume() async {
        guard suspended, !closed else { return }
        suspended = false
        await start(at: resumePosition)
    }

    /// Saves the position and stops playback.
    ///
    /// 保存位置并停止播放.
    func close() {
        closed = true
        manager.offlinePlaybackActive = false
        restartTask?.cancel()
        checkpoint()
        engine.observePause(nil)
        pauseDebounceTask?.cancel()
        engine.cleanup()
        player = nil
    }

    /// Writes a checkpoint. `completed` reaches the watch record only for the last episode of the
    /// line, because only a client that knows the episode list may finish a title (ADR-015).
    ///
    /// 写入检查点. 只有该线路的最后一集才会把 `completed` 写入观看记录, 因为只有知道剧集列表的客户端
    /// 才能将一部剧标记为看完 (ADR-015).
    func record(current: TimeInterval, duration: TimeInterval, finished: Bool) {
        guard current.isFinite, duration.isFinite, current > 0, duration > 0 else { return }
        let done = finished || PlaybackProgressPolicy.isCompleted(current: current, duration: duration)
        let isLast = episode.episodeIndex >= episode.episodeCount - 1
        progressStore.saveProgress(title: show.title, cover: show.cover, sourceKey: episode.sourceKey,
                                   videoId: episode.videoId, episodeName: episode.episodeName,
                                   groupIndex: episode.lineIndex, episodeIndex: episode.episodeIndex,
                                   current: current, duration: duration, completed: done && isLast)
        manager.recordWatch(episode, positionSec: current, finished: done)
    }

    /// Handles a periodic time callback: saves progress and skips the outro.
    ///
    /// 处理周期性时间回调: 保存进度并跳过片尾.
    func handleTime(current: TimeInterval, total: TimeInterval) {
        lastDuration = total
        let tick = progress.tick(current: current, duration: total, isLive: true, skipOutroSeconds: skipOutroSeconds,
                                 now: now())
        if tick.save { record(current: current, duration: total, finished: false) }
        let nearEnd = PlaybackProgressPolicy.isNearEnd(current: current, duration: total,
                                                       skipOutroSeconds: skipOutroSeconds)
        if nearEnd != isNearEnd { isNearEnd = nearEnd }
        if tick.skipOutro { finishCurrent() }
    }

    private func finishCurrent() {
        let total = lastDuration > 0 ? lastDuration : episode.durationSec
        record(current: total, duration: total, finished: true)
        guard !closed, let next = validNextEpisode() else { return }
        switchEpisode(to: next)
    }

    private func checkpoint() {
        guard let current = engine.currentTime, let total = engine.itemDuration else { return }
        if current.isFinite, total.isFinite, current > 0, total > 0 {
            resumePosition = current
            record(current: current, duration: total, finished: false)
        }
    }

    /// A failure deletes the download only when its files are gone. With intact files the item is
    /// rebuilt once at the checkpoint; a second failure shows an error and keeps the files. The
    /// player goes away at once; the files are checked off the main actor, and the returned task
    /// settles the outcome.
    ///
    /// 只有文件确实缺失时, 失败才会删除下载. 文件完好时在检查点处重建一次 item; 再次失败则提示错误并保留文件.
    /// 播放器立即移除; 文件检查在主 actor 之外进行, 返回的任务负责得出结果.
    @discardableResult
    private func fail() -> Task<Void, Never>? {
        guard !suspended, !closed else { return nil }
        checkpoint()
        engine.observePause(nil)
        pauseDebounceTask?.cancel()
        engine.cleanup()
        player = nil
        let failed = episode
        let generation = startGeneration
        let task = Task { await self.settleFailure(of: failed, generation: generation) }
        failureTask = task
        return task
    }

    private func settleFailure(of failed: DownloadEpisode, generation: Int) async {
        let intact = await manager.checkFilesIntact(failed)
        // A start or an episode switch while the files were checked owns the screen now; a failure
        // of what it plays settles itself.
        //
        // 检查文件期间发生的 start 或换集此时接管了画面; 它所播放内容的失败会自行处理.
        guard failed === episode, generation == startGeneration else { return }
        if !intact {
            error = String(localized: "File damaged, download again")
            manager.markDamaged(failed)
        } else if !rebuiltAfterFailure {
            rebuiltAfterFailure = true
            if !closed { restartTask = Task { await start(at: resumePosition) } }
        } else {
            error = String(localized: "Playback failed, try again later")
        }
    }
}
#endif
