#if os(iOS)
import AVFoundation
import AVKit
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
    /// Shortest wall-clock gap between two periodic progress saves. Scrubbing moves the position
    /// many times a second, so a position-based gap would save on almost every callback.
    ///
    /// 两次周期性进度保存之间的最短实际时间间隔. 拖动进度条时位置每秒变化多次, 若按位置差判断,
    /// 几乎每次回调都会保存.
    static let saveInterval: Duration = .seconds(5)
    /// How long before the end the next-episode button appears during playback.
    ///
    /// 播放时距离结尾多久显示下一集按钮.
    static let upNextLead: TimeInterval = 60

    let show: DownloadShow
    private(set) var episode: DownloadEpisode
    private(set) var player: AVPlayer?
    var error: String?
    /// Whether playback has stayed paused for `pauseDebounce`, and whether the playhead is within
    /// `upNextLead` of the end (or of the outro skip); the next-episode button shows only then. Both
    /// change only on a flip; the debounce keeps a scrub (which pauses briefly) from flashing it.
    ///
    /// 播放是否已持续暂停 `pauseDebounce`, 以及播放头是否距结尾 (或片尾跳过点) 不足 `upNextLead`;
    /// 只有此时才显示下一集按钮. 两者只在状态翻转时才会改变; 防抖让拖动进度 (会短暂暂停) 不会使按钮闪现.
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
    @ObservationIgnored private let coordinator = PlaybackCoordinator()
    @ObservationIgnored private let skipIntroSeconds: Int
    @ObservationIgnored private let skipOutroSeconds: Int
    // Wall-clock instant of the last periodic save; nil saves on the next callback.
    //
    // 上一次周期性保存的实际时间点; 为 nil 时下一次回调即保存.
    @ObservationIgnored private var lastSaveAt: ContinuousClock.Instant?
    @ObservationIgnored private var pauseObservation: NSKeyValueObservation?
    // Pending switch to paused; a resume before it fires cancels it.
    //
    // 待生效的暂停切换; 在其生效前恢复播放会取消它.
    @ObservationIgnored private var pauseDebounceTask: Task<Void, Never>?
    @ObservationIgnored private var lastDuration: TimeInterval = 0
    @ObservationIgnored private var outroHandled = false
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
         loadTimeout: Duration = PlaybackCoordinator.localLoadTimeout) {
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
        manager.episodes(in: episode.scopeKey, showKey: episode.showKey)
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
            fail()
            return
        }
        guard !closed, !Task.isCancelled, !suspended, generation == startGeneration else { return }
        let start = Self.resolveStart(explicit: position, record: syncStore?.watch(title: show.title),
                                      episode: episode, skipIntroSeconds: skipIntroSeconds)
        lastSaveAt = now()
        outroHandled = false
        isNearEnd = false
        coordinator.start(url: url, startTime: start, rate: 1, allowsExternalPlayback: false,
                          loadTimeout: loadTimeout,
                          onTime: { [weak self] current, total in self?.handleTime(current: current, total: total) },
                          onBuffer: { _ in },
                          onEnd: { [weak self] in self?.finishCurrent() },
                          onError: { [weak self] _ in self?.fail() })
        player = coordinator.player
        applyMetadata()
        observePause()
    }

    /// Whether the next-episode button shows: a next episode exists and playback is paused or near
    /// the end.
    ///
    /// 是否显示下一集按钮: 存在下一集, 且播放已暂停或接近结尾.
    var showsUpNext: Bool {
        (isPaused || isNearEnd) && nextEpisode != nil
    }

    /// Gives the item the show and episode names, which the system player shows as its title, so
    /// no overlay has to sit on the video.
    ///
    /// 为 item 设置剧名与集名, 系统播放器会将其显示为标题, 因此无需在视频上叠加视图.
    private func applyMetadata() {
        coordinator.player?.currentItem?.externalMetadata = [
            Self.metadataItem(.commonIdentifierTitle, value: show.title),
            Self.metadataItem(.iTunesMetadataTrackSubTitle, value: episode.episodeName),
        ]
    }

    private static func metadataItem(_ identifier: AVMetadataIdentifier, value: String) -> AVMetadataItem {
        let item = AVMutableMetadataItem()
        item.identifier = identifier
        item.value = value as NSString
        item.extendedLanguageTag = "und"
        return item
    }

    /// Tracks whether the player is paused; KVO delivers on the main thread, as in
    /// `PlaybackCoordinator`.
    ///
    /// 跟踪播放器是否暂停; 与 `PlaybackCoordinator` 一样, KVO 在主线程投递.
    private func observePause() {
        pauseObservation = coordinator.player?.observe(\.timeControlStatus, options: [.initial, .new]) { [weak self] player, _ in
            let paused = player.timeControlStatus == .paused
            MainActor.assumeIsolated { self?.pauseChanged(paused) }
        }
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
        guard !closed, let next = nextEpisode else { return }
        switchEpisode(to: next)
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
        checkpoint()
        player?.pause()
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
        pauseObservation = nil
        pauseDebounceTask?.cancel()
        coordinator.cleanup()
        player = nil
    }

    /// Writes a checkpoint. `completed` reaches the watch record only for the last episode of the
    /// line, because only a client that knows the episode list may finish a title (ADR-015).
    ///
    /// 写入检查点. 只有该线路的最后一集才会把 `completed` 写入观看记录, 因为只有知道剧集列表的客户端
    /// 才能将一部剧标记为看完 (ADR-015).
    func record(current: TimeInterval, duration: TimeInterval, finished: Bool) {
        guard current.isFinite, duration.isFinite, current > 0, duration > 0 else { return }
        let done = finished || duration - current <= 30 || current / duration >= 0.95
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
        let instant = now()
        if lastSaveAt.map({ instant - $0 >= Self.saveInterval }) ?? true {
            lastSaveAt = instant
            record(current: current, duration: total, finished: false)
        }
        let nearEnd = total > 0 && total - current <= Self.upNextLead + TimeInterval(skipOutroSeconds)
        if nearEnd != isNearEnd { isNearEnd = nearEnd }
        if !outroHandled, skipOutroSeconds > 0, total > 0, total - current > 0,
           total - current <= TimeInterval(skipOutroSeconds) {
            outroHandled = true
            finishCurrent()
        }
    }

    private func finishCurrent() {
        let total = lastDuration > 0 ? lastDuration : episode.durationSec
        record(current: total, duration: total, finished: true)
        guard !closed, let next = nextEpisode else { return }
        switchEpisode(to: next)
    }

    private func checkpoint() {
        guard let player, let item = player.currentItem else { return }
        let current = CMTimeGetSeconds(player.currentTime())
        let total = CMTimeGetSeconds(item.duration)
        if current.isFinite, total.isFinite, current > 0, total > 0 {
            resumePosition = current
            record(current: current, duration: total, finished: false)
        }
    }

    /// A failure deletes the download only when its files are gone. With intact files the item is
    /// rebuilt once at the checkpoint; a second failure shows an error and keeps the files.
    ///
    /// 只有文件确实缺失时, 失败才会删除下载. 文件完好时在检查点处重建一次 item; 再次失败则提示错误并保留文件.
    private func fail() {
        guard !suspended, !closed else { return }
        checkpoint()
        pauseObservation = nil
        pauseDebounceTask?.cancel()
        coordinator.cleanup()
        player = nil
        if !manager.filesIntact(episode) {
            error = String(localized: "File damaged, download again")
            manager.markDamaged(episode)
        } else if !rebuiltAfterFailure {
            rebuiltAfterFailure = true
            if !closed { restartTask = Task { await start(at: resumePosition) } }
        } else {
            error = String(localized: "Playback failed, try again later")
        }
    }
}
#endif
