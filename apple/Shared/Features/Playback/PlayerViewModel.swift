import Foundation
import SwiftData
import AVFoundation
import os

enum PlayerError: LocalizedError {
    case missingEpisode
    case invalidPlaybackURL(String)

    var errorDescription: String? {
        switch self {
        case .missingEpisode:
            return String(localized: "No playable episode")
        case .invalidPlaybackURL:
            return String(localized: "Invalid playback URL")
        }
    }
}

@Observable
@MainActor
final class PlayerViewModel {
    private let logger = Logger(subsystem: "com.mritd.kmtv", category: "playback")

    // Data.
    //
    // 详情数据与当前选中线路.
    var detail: VideoDetail?
    var sources: [SourceResult]
    var currentSourceKey: String
    var currentLineIndex = 0
    var currentEpisodeIndex = 0
    /// Whether the title is a favorite in any source.
    ///
    /// 该标题是否已收藏, 与来源无关.
    var isFavorited: Bool { syncStore?.isFavorite(title: detail?.title ?? videoTitle) ?? false }
    var isLoadingDetail = false
    var error: String?

    // Playback UI state (updated by time observer).
    //
    // 播放 UI 状态, 由时间观察器持续更新.
    var currentTime: TimeInterval = 0
    var duration: TimeInterval = 0
    var playbackRate: Float = 1.0

    /// How much of the timeline is buffered, 0...1, for the progress bar's loaded track.
    ///
    /// 时间轴上已缓冲的比例, 取值 0...1, 用于进度条的已加载轨道.
    ///
    /// Fed by the coordinator's wall-clock sampler rather than by `onTimeUpdate`, which is
    /// driven by the playhead and therefore silent while paused or stalled — the moments
    /// the bar most needs to keep moving.
    ///
    /// 由协调器的墙钟采样器提供, 而非 `onTimeUpdate`: 后者由播放头驱动,
    /// 暂停或卡顿时便不再更新 — 而那正是最需要看到进度条继续前进的时刻.
    var bufferedFraction: Double = 0

    /// Seconds of playback covered from the playhead, for the fullscreen readout.
    ///
    /// 从播放头起已覆盖的播放秒数, 供全屏文字提示使用.
    ///
    /// Fullscreen hands the transport bar to `AVPlayerViewController`, whose scrubber draws
    /// no loaded range at all — measured on a real iPad, its track has exactly two levels.
    /// A number is the only way to see the buffer there without replacing Apple's controls.
    ///
    /// 全屏把控制条交给 `AVPlayerViewController`, 而它的进度条完全不绘制已加载区间 —
    /// 在真实 iPad 上实测, 其轨道恰好只有两级明暗.
    /// 因此在不替换 Apple 控件的前提下, 数字是唯一能看到缓冲的方式.
    var bufferedAheadSeconds: TimeInterval = 0

    var isPlaying: Bool = false
    var isSeeking: Bool = false
    var isBuffering: Bool = false

    /// Observable player handle used by SwiftUI to mount the video layer.
    ///
    /// SwiftUI 通过这个可观察播放器引用挂载视频图层.
    private(set) var player: AVPlayer?

    // Playback settings.
    //
    // 播放设置.
    var skipIntroSeconds: Int = 0
    var skipOutroSeconds: Int = 0

    // Progress tracking.
    //
    // 播放进度跟踪.
    private var lastSaveTime: TimeInterval = 0
    private var skipOutroTriggered = false
    // The last checkpoint written to the store. A paused player that reports the same position again
    // must not give old progress a newer event time.
    //
    // 最近一次写入存储的进度. 暂停的播放器重复报告同一位置时, 不能给旧进度新的事件时间.
    private var lastSavedCheckpoint = ""
    // Set once the last episode ended and its final checkpoint was written; later checkpoints from the
    // ended item must not overwrite it with an unfinished record. A seek or a new item clears it.
    //
    // 最后一集结束并写入最终检查点后置位; 已结束 item 之后的检查点不能用未看完的记录覆盖它.
    // seek 或开始新 item 时清除.
    private var endCheckpointWritten = false
    // Set from the moment the selection starts to change until `startPlayer` attaches the new item.
    // The outgoing AVPlayer item keeps reporting in that gap, and its time must not be saved under
    // the new source, line, or episode.
    //
    // 从选择开始变化到 `startPlayer` 挂载新 item 之间置位. 这段时间旧的 AVPlayer item 仍在上报,
    // 其时间不能被保存到新的来源, 线路或分集下.
    private var detachedFromItem = false
    // Bumped for every playback request; a URL reply that is not for the latest one is stale and
    // never attaches an item.
    //
    // 每次播放请求都会递增; 不属于最新请求的地址响应已过期, 不会挂载 item.
    private var playbackRequest = 0
    // Set by `prepareResume` when no record exists under the navigation title; the first
    // `loadDetail` then looks the record up under the detail title that checkpoints write under.
    //
    // 导航标题下没有记录时由 `prepareResume` 设置; 第一次 `loadDetail` 随后会用检查点写入时的
    // 详情标题查找记录.
    private var resumeByDetailTitle = false

    private let apiClient: any PlaybackDetailAPIProtocol
    private let modelContext: ModelContext
	private let serverURL: String
    private let syncStore: SyncStore?
    private let syncEngine: SyncEngine?
    private let playerSyncWait: Duration
    private let videoTitle: String
    private let coverHint: String
    private let progressStore: PlaybackProgressStore
    /// Downloads the player may use instead of streaming.
    ///
    /// 播放器可以替代流媒体使用的下载内容.
    private let localEpisodes: (any LocalEpisodeProviding)?
    /// Whether the current item plays a downloaded copy.
    ///
    /// 当前 item 是否在播放下载的副本.
    private(set) var isPlayingLocalCopy = false
    // Set after a local copy failed, so the next start streams instead of trying it again.
    //
    // 本地副本失败后置位, 下一次启动直接走在线播放, 不再尝试本地副本.
    private var skipLocalCopy = false
    /// How long a downloaded copy may take to become ready before playback falls back to streaming.
    ///
    /// 下载副本变为就绪前可等待的时长, 超时后回退为在线播放.
    private let localLoadTimeout: Duration

    /// Coordinates player side effects while this view model owns user-visible state.
    ///
    /// 播放器副作用交给 coordinator 管理, 当前视图模型只维护用户可见状态.
    private let coordinator = PlaybackCoordinator()

    init(apiClient: any PlaybackDetailAPIProtocol, modelContext: ModelContext, serverURL: String,
         syncStore: SyncStore? = nil, syncEngine: SyncEngine? = nil,
         sources: [SourceResult], sourceKey: String, videoId: String, title: String,
         coverHint: String = "", initialEpisodeIndex: Int? = nil, playerSyncWait: Duration = .milliseconds(1500),
         localEpisodes: (any LocalEpisodeProviding)? = nil,
         localLoadTimeout: Duration = PlaybackCoordinator.localLoadTimeout) {
        self.localEpisodes = localEpisodes
        self.localLoadTimeout = localLoadTimeout
        self.apiClient = apiClient
        self.modelContext = modelContext
		self.serverURL = serverURL
        self.syncStore = syncStore
        self.syncEngine = syncEngine
        self.playerSyncWait = playerSyncWait
        self.videoTitle = title
        self.coverHint = coverHint
		self.progressStore = PlaybackProgressStore(modelContext: modelContext, serverURL: serverURL, syncStore: syncStore, title: title)
        self.sources = sources
        self.currentSourceKey = sourceKey
        self.currentEpisodeIndex = max(0, initialEpisodeIndex ?? 0)

        let settings = progressStore.loadSettings()
        self.skipIntroSeconds = settings.skipIntroSeconds
        self.skipOutroSeconds = settings.skipOutroSeconds
    }

    private var selection: EpisodeSelection {
        EpisodeSelection(
            detail: detail,
            sources: sources,
            currentSourceKey: currentSourceKey,
            currentLineIndex: currentLineIndex,
            currentEpisodeIndex: currentEpisodeIndex
        )
    }

    var allLines: [[Episode]] {
        selection.allLines
    }

    var episodes: [Episode] {
        selection.episodes
    }

    var currentEpisode: Episode? {
        selection.currentEpisode
    }

    var currentEpisodeName: String {
        currentEpisode?.name ?? ""
    }

	var currentSourceName: String {
        selection.sourceName()
	}

	var currentVideoID: String {
		selection.sourceVideoID()
	}

	// MARK: - Load

    /// Waits briefly for a sync, then lets an unfinished watch record pick the line and episode,
    /// whichever source it was saved from. The open source stays; `loadDetail` clamps the indices,
    /// and `startTime` reuses the saved position only when source, video, line, and episode match.
    /// When no record exists under the navigation title, `loadDetail` retries under the detail title.
    ///
    /// 短暂等待一次同步, 然后由未看完的观看记录决定线路和分集, 无论它保存自哪个来源. 当前来源
    /// 保持不变; `loadDetail` 会钳制索引, `startTime` 仅在来源, 视频, 线路和分集都一致时复用保存的进度.
    /// 导航标题下没有记录时, `loadDetail` 会改用详情标题再查一次.
    func prepareResume() async {
        if let syncEngine {
            await syncEngine.requestSync(.player, waitingAtMost: playerSyncWait)
        }
        let record = syncStore?.watch(title: videoTitle)
        resumeByDetailTitle = syncStore != nil && record == nil
        guard let item = record, !item.completed else { return }
        currentLineIndex = max(0, item.groupIndex)
        currentEpisodeIndex = max(0, item.episodeIndex)
    }

	func loadDetail(sourceKey: String, videoId: String) async -> Bool {
        isLoadingDetail = true
        defer { isLoadingDetail = false }
        do {
            let d = try await apiClient.detail(sourceKey: sourceKey, videoId: videoId)
            detail = detailApplyingCoverHint(d)
            currentSourceKey = sourceKey

            if !sources.contains(where: { $0.sourceKey == sourceKey }) {
                sources.insert(SourceResult(
                    sourceKey: sourceKey, sourceName: sourceKey, videoId: videoId,
                    durationMs: 0, episodes: d.episodes.first ?? []
                ), at: 0)
            }
            applyResumeByDetailTitle()
            clampCurrentEpisodeIndex()

            return !d.episodes.isEmpty && !(d.episodes.first?.isEmpty ?? true)
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    // MARK: - Playback

    func startPlayback() {
        Task {
            await startPlaybackAsync()
        }
    }

    func startPlaybackAsync() async {
        do {
            logger.info(
                "startPlaybackAsync source=\(self.currentSourceKey, privacy: .public) line=\(self.currentLineIndex, privacy: .public) episode=\(self.currentEpisodeIndex, privacy: .public)"
            )
            playbackRequest += 1
            let id = playbackRequest
            if !skipLocalCopy, let localEpisodes, let scopeKey = syncStore?.scopeKey,
               let local = await localEpisodes.localPlaybackURL(scopeKey: scopeKey, sourceKey: currentSourceKey,
                                                                videoId: currentVideoID,
                                                                episodeIndex: currentEpisodeIndex) {
                guard id == playbackRequest else { return }
                isPlayingLocalCopy = true
                startPlayer(with: local, allowsExternalPlayback: false, loadTimeout: localLoadTimeout)
                return
            }
            skipLocalCopy = false
            isPlayingLocalCopy = false
            let url = try await preparePlaybackURL()
            // A newer switch took over while this reply was in flight.
            //
            // 等待响应期间已有更新的切换接管.
            guard id == playbackRequest else { return }
            startPlayer(with: url)
        } catch {
            logger.error("startPlaybackAsync failed error=\(error.localizedDescription, privacy: .public)")
            self.error = error.localizedDescription
        }
    }

    /// Resolves the selected episode through `/playback/url` before AVPlayer sees it.
    ///
    /// 在交给 AVPlayer 前, 先通过 `/playback/url` 解析当前选中的剧集地址.
    func preparePlaybackURL() async throws -> URL {
        guard let ep = currentEpisode else {
            logger.error("preparePlaybackURL failed missing episode")
            throw PlayerError.missingEpisode
        }
        logger.info(
            "preparePlaybackURL request source=\(self.currentSourceKey, privacy: .public) originalURL=\(ep.url, privacy: .public)"
        )
        let response = try await apiClient.playbackURL(url: ep.url, source: currentSourceKey)
        logger.info(
            "preparePlaybackURL response mode=\(response.mode, privacy: .public) resolvedURL=\(response.url, privacy: .private)"
        )
        guard let url = URL(string: response.url) else {
            logger.error("preparePlaybackURL invalid resolvedURL=\(response.url, privacy: .private)")
            throw PlayerError.invalidPlaybackURL(response.url)
        }
        return url
    }

    private func startPlayer(with url: URL, allowsExternalPlayback: Bool = true, loadTimeout: Duration? = nil) {
        skipOutroTriggered = false
        endCheckpointWritten = false
        detachedFromItem = false
        // Show loading feedback while AVPlayer resolves playlists and media segments.
        //
        // AVPlayer 解析播放列表和媒体片段期间先显示加载反馈.
        isPlaying = false
        isBuffering = true
        resetPlaybackUIState()
        let startTime = startTimeForCurrentSelection()
        // The new item reports from its own start; the outgoing item's last save time must not make
        // its first tick write at once.
        //
        // 新 item 从自己的起点开始上报; 旧 item 的最近保存时间不能让它的第一次时间更新立刻写入.
        lastSaveTime = startTime
        logger.info(
            "startPlayer url=\(PlaybackCoordinator.loggableURL(url), privacy: .public) startTime=\(startTime, privacy: .public) rate=\(self.playbackRate, privacy: .public) hadPlayer=\(self.player != nil, privacy: .public)"
        )
        coordinator.start(
            url: url,
            startTime: startTime,
            rate: playbackRate,
            allowsExternalPlayback: allowsExternalPlayback,
            loadTimeout: loadTimeout,
            onTime: { [weak self] current, total in
                self?.onTimeUpdate(current: current, total: total)
            },
            onBuffer: { [weak self] sample in
                self?.onBufferUpdate(sample)
            },
            onEnd: { [weak self] in
                self?.handleItemEnded()
            },
            onError: { [weak self] message in
                Task { await self?.handleItemError(message) }
            }
        )
        player = coordinator.player
        logger.info(
            "startPlayer ready hasPlayer=\(self.player != nil, privacy: .public) hasCurrentItem=\(self.player?.currentItem != nil, privacy: .public) timeControlStatus=\(PlaybackCoordinator.describeTimeControlStatus(self.player?.timeControlStatus), privacy: .public)"
        )
    }

    /// Where the new item starts. The watch record is read by the detail title, like the write path
    /// and Web, once the detail has loaded; before that the navigation title stands in.
    ///
    /// 新 item 的起播位置. 详情加载后按详情标题读取观看记录, 与写入路径和 Web 一致; 在此之前使用导航标题.
    func startTimeForCurrentSelection() -> TimeInterval {
        progressStore.startTime(
            sourceKey: currentSourceKey,
            videoId: selection.sourceVideoID(),
            groupIndex: currentLineIndex,
            episodeIndex: currentEpisodeIndex,
            skipIntroSeconds: skipIntroSeconds,
            title: detail?.title
        )
    }

    /// The player item reported its end. An outgoing item that ends while the selection is changing
    /// must not move the new selection on.
    ///
    /// 播放器 item 报告结束. 选择正在变化时, 旧 item 的结束不能让新的选择继续往下走.
    func handleItemEnded() {
        guard !detachedFromItem else { return }
        handlePlaybackEnded()
    }

    /// The player item reported a failure. Ignored while the selection is changing, because the
    /// outgoing item's failure says nothing about the item that is about to attach.
    ///
    /// 播放器 item 报告失败. 选择正在变化时忽略, 因为旧 item 的失败与即将挂载的 item 无关.
    func handleItemError(_ message: String?) async {
        guard !detachedFromItem else { return }
        if isPlayingLocalCopy, let localEpisodes, let scopeKey = syncStore?.scopeKey {
            // A failed local copy falls back to streaming the same selection, not to the next line.
            // The manager deletes the copy only when its files are missing.
            //
            // 本地副本失败时回退为在线播放同一选择, 而不是切换到下一条线路. 只有文件缺失时管理器才会删除该副本.
            localEpisodes.reportPlaybackFailure(scopeKey: scopeKey, sourceKey: currentSourceKey,
                                                videoId: currentVideoID, episodeIndex: currentEpisodeIndex)
            isPlayingLocalCopy = false
            skipLocalCopy = true
            isBuffering = false
            startPlayback()
            return
        }
        if let message { error = message }
        isBuffering = false
        await handlePlaybackError()
    }

    // MARK: - Time Updates

    /// Clears the timeline state a new item has not reported yet.
    ///
    /// 清除新 item 尚未报告的时间轴状态.
    ///
    /// `duration` is the one that matters most: the buffer is sampled on wall-clock ticks
    /// while `onTimeUpdate` waits for a finite duration, so the first samples of a new
    /// episode would otherwise be scaled by the previous episode's length — a bar drawn at
    /// the wrong width against a running time that also belongs to the episode just left.
    ///
    /// 其中 `duration` 最为关键: 缓冲按墙钟节拍采样,
    /// 而 `onTimeUpdate` 要等到时长有限才更新, 否则新剧集的最初几次采样
    /// 会按上一集的时长换算 — 进度条宽度错误, 旁边的播放时间同样属于刚离开的那一集.
    func resetPlaybackUIState() {
        currentTime = 0
        duration = 0
        bufferedFraction = 0
        bufferedAheadSeconds = 0
        // A seek that never completed — the item was replaced under it — would otherwise
        // keep both the time display and the buffered bar frozen into the new episode.
        //
        // 未能完成的 seek — item 在其进行中被替换 —
        // 否则会让播放时间与缓冲进度条一并冻结, 一直延续到新剧集.
        isSeeking = false
    }

    /// Converts a buffered timeline position into the fraction the progress bar draws.
    ///
    /// 把缓冲到达的时间轴位置换算成进度条绘制所需的比例.
    ///
    /// `duration` is 0 until the first time update arrives, and a live stream reports an
    /// indefinite one, so both have to collapse to an empty bar rather than a NaN width.
    ///
    /// 首次时间更新到达前 `duration` 为 0, 直播流则报告不确定的时长,
    /// 两者都必须收敛为空进度条, 而不是一个 NaN 宽度.
    func onBufferUpdate(_ sample: BufferSample) {
        // A sample taken before a seek lands still describes the old playhead. Seeking
        // backwards would then draw the bar far to the right of the thumb across media that
        // is not in fact continuously playable from there.
        //
        // seek 落地之前取得的采样描述的仍是旧播放头. 向后 seek 时,
        // 这会把进度条画到滑块右侧很远的位置, 而那段内容实际上并不能从当前位置连续播放.
        guard !isSeeking else { return }
        // The spinner and the fullscreen readout both key off the transport state, and
        // `onTimeUpdate` cannot maintain it: that observer is driven by the playhead, so it
        // goes quiet at the very moment playback stalls. This sampler runs on wall clock and
        // is the only thing still reporting then.
        //
        // 加载转圈与全屏文字提示都依赖播放传输状态, 而 `onTimeUpdate` 无法维护它:
        // 该观察器由播放头驱动, 恰恰在播放卡住的那一刻静默.
        // 本采样器按墙钟运行, 是那时唯一还在上报的路径.
        refreshTransportState(player?.timeControlStatus)
        bufferedAheadSeconds = sample.ahead.isFinite ? max(0, sample.ahead) : 0
        guard duration > 0, sample.end.isFinite else {
            bufferedFraction = 0
            return
        }
        bufferedFraction = min(1, max(0, sample.end / duration))
    }

    /// Mirrors AVPlayer's transport state into the two flags the UI reads.
    ///
    /// 把 AVPlayer 的播放传输状态映射为 UI 读取的两个标志.
    ///
    /// Separated from its callers so the mapping can be tested against each status: a unit
    /// test cannot attach an AVPlayer to hand them a real one.
    ///
    /// 从调用方分离出来, 以便针对每种状态测试该映射:
    /// 单元测试无法为其挂载真实的 AVPlayer.
    func refreshTransportState(_ status: AVPlayer.TimeControlStatus?) {
        let wasPlaying = isPlaying
        isPlaying = status == .playing
        isBuffering = status == .waitingToPlayAtSpecifiedRate
        // A pause the app did not ask for (an interruption, headphones removed) is still a stopping
        // point that another device should be able to resume from.
        //
        // 不是应用发起的暂停 (被打断, 耳机拔出) 同样是停顿点, 其他设备应能从这里继续.
        if wasPlaying && status == .paused { checkpoint() }
    }

    /// Which 30-second band the forward buffer currently sits in.
    ///
    /// 当前前向缓冲所处的 30 秒区间.
    ///
    /// The fullscreen readout appears when this changes rather than on every sample: the
    /// buffer moves each second while filling, and a readout that re-appeared that often
    /// would never be off the screen. Crossing a band is the moment worth a glance, in
    /// either direction — filling up, or collapsing back on a stall.
    ///
    /// 全屏文字提示在该值变化时出现, 而非每次采样都出现:
    /// 缓冲填充期间每秒都在变, 每次都重新出现的提示将永远不会从画面上消失.
    /// 跨越一个区间才是值得看一眼的时刻, 两个方向都是 — 填满, 或卡顿时回落.
    static func bufferBadgeBand(_ secondsAhead: TimeInterval) -> Int {
        guard secondsAhead.isFinite, secondsAhead > 0 else { return 0 }
        return Int(secondsAhead / 30)
    }

    func onTimeUpdate(current: TimeInterval, total: TimeInterval) {
        // Don't overwrite currentTime while user is dragging the slider.
        //
        // 用户拖动进度条时不覆盖 currentTime, 避免 UI 跳动.
        if !isSeeking {
            currentTime = current
        }
        duration = total
        refreshTransportState(player?.timeControlStatus)

        // Scrubbing back out of the finished zone after the last episode ended is a rewatch; record it.
        // Late ticks near the end stay blocked so they cannot overwrite the finished record.
        //
        // 最后一集结束后拖回片尾区之外属于重看, 需要记录; 片尾附近迟到的时间更新仍被拦截,
        // 以免覆盖已看完的记录.
        if endCheckpointWritten && total.isFinite && !playbackCompleted(current: current, duration: total) {
            endCheckpointWritten = false
        }

        if abs(current - lastSaveTime) >= 5 {
            lastSaveTime = current
            saveProgress(current: current, duration: total)
        }

        if !skipOutroTriggered && !detachedFromItem && skipOutroSeconds > 0 && total > 0 {
            let remaining = total - current
            if remaining <= TimeInterval(skipOutroSeconds) && remaining > 0 {
                skipOutroTriggered = true
                playNextEpisode()
            }
        }
    }

    func playNextEpisode() {
        let nextIndex = currentEpisodeIndex + 1
        guard nextIndex < episodes.count else { return }
        switchEpisode(nextIndex)
    }

    /// Handles the end of the current item: it moves to the next episode, or, on the last one,
    /// writes a final finished checkpoint at the end position and pushes it, because the end can be
    /// reported several seconds after the last periodic checkpoint.
    ///
    /// 处理当前 item 播放结束: 还有下一集则切换; 已是最后一集则在片尾位置写入最终的已看完检查点
    /// 并推送, 因为结束通知可能比最近一次定期检查点晚数秒.
    func handlePlaybackEnded() {
        guard currentEpisodeIndex + 1 >= episodes.count else {
            playNextEpisode()
            return
        }
        var total = duration
        if let item = player?.currentItem {
            let itemDuration = CMTimeGetSeconds(item.duration)
            if itemDuration.isFinite && itemDuration > 0 { total = itemDuration }
        }
        if total.isFinite && total > 0 {
            lastSavedCheckpoint = ""
            saveProgress(current: total, duration: total, finished: true)
            endCheckpointWritten = true
        }
        flushSync()
    }

    private func saveProgress(current: TimeInterval, duration: TimeInterval, finished: Bool = false) {
        // A non-finite time or duration never becomes a checkpoint.
        //
        // 非有限的时间或时长不会成为检查点.
        guard current.isFinite, duration.isFinite, current > 0, !endCheckpointWritten, !detachedFromItem else { return }
        guard let detail else { return }
        guard let ep = currentEpisode else { return }
        let videoId = selection.sourceVideoID()
        let checkpoint = "\(currentSourceKey)|\(videoId)|\(currentLineIndex)|\(currentEpisodeIndex)|\(Int(current))"
        guard checkpoint != lastSavedCheckpoint else { return }
        lastSavedCheckpoint = checkpoint
        let completed = finished || (currentEpisodeIndex == episodes.count - 1
            && playbackCompleted(current: current, duration: duration))
        progressStore.saveProgress(
            detail: detail,
            sourceKey: currentSourceKey,
            videoId: videoId,
            episode: ep,
            groupIndex: currentLineIndex,
            episodeIndex: currentEpisodeIndex,
            current: current,
            duration: duration,
            completed: completed
        )
    }

    /// Saves the current position and pushes it, so another device can resume from here.
    ///
    /// 保存当前位置并推送, 让其他设备能从这里继续.
    func checkpoint(current: TimeInterval? = nil, duration: TimeInterval? = nil) {
        if let current, let duration {
            if current.isFinite && duration.isFinite && current > 0 && duration > 0 {
                saveProgress(current: current, duration: duration)
            }
        } else if let player, let item = player.currentItem {
            let current = CMTimeGetSeconds(player.currentTime())
            let total = CMTimeGetSeconds(item.duration)
            if current.isFinite && total.isFinite && current > 0 && total > 0 {
                saveProgress(current: current, duration: total)
            }
        }
        flushSync()
    }

    private func flushSync() {
        guard let syncEngine else { return }
        Task { await syncEngine.flushNow() }
    }

    // MARK: - Switching

    /// Saves and pushes the outgoing position, then stops the outgoing item from writing progress
    /// until the next item is attached.
    ///
    /// 保存并推送当前位置, 然后在下一个 item 挂载之前禁止旧 item 写入进度.
    private func detachOutgoingItem() {
        checkpoint()
        detachedFromItem = true
        isPlaying = false
    }

    func switchSource(_ sourceKey: String) async {
        // Save and push the outgoing position before the selection changes.
        //
        // 在切换之前保存并推送当前位置.
        detachOutgoingItem()
        let prevEpName = currentEpisode?.name ?? ""

        currentSourceKey = sourceKey
        currentLineIndex = 0

        guard let source = sources.first(where: { $0.sourceKey == sourceKey }) else { return }

        // Only fetch episodes for the new source, preserve existing detail info.
        //
        // 切源时只拉取新源剧集, 保留当前影片元数据.
        do {
            let d = try await apiClient.detail(sourceKey: sourceKey, videoId: source.videoId)
            applyDetail(d)
        } catch {
            await autoFallbackSource(failedKey: sourceKey)
            return
        }

        guard hasPlayableDetail() else {
            await autoFallbackSource(failedKey: sourceKey)
            return
        }

        matchEpisode(prevName: prevEpName)
    }

    func switchLine(_ index: Int) {
        detachOutgoingItem()
        currentLineIndex = index
        currentEpisodeIndex = 0
        startPlayback()
    }

    func switchEpisode(_ index: Int) {
        detachOutgoingItem()
        currentEpisodeIndex = index
        startPlayback()
    }

    func toggleFavorite() {
        guard let syncStore else { return }
        let title = detail?.title ?? videoTitle
        if syncStore.isFavorite(title: title) {
            syncStore.remove(.favorite, key: title)
            return
        }
        let videoId = sources.first(where: { $0.sourceKey == currentSourceKey })?.videoId ?? currentVideoID
        syncStore.upsert(.favorite(FavoritePayload(
            title: title, cover: detail?.cover ?? coverHint, type: detail?.type ?? "", year: detail?.year ?? "",
            desc: detail?.desc ?? "", sourceKey: currentSourceKey, videoId: videoId
        )))
    }

    // MARK: - Auto-fallback

    /// Handles failed playback by trying another CDN line first, then another source.
    ///
    /// 处理播放失败: 优先尝试下一条 CDN 线路, 再尝试下一个视频源.
    func handlePlaybackError() async {
        // An error on the last episode at or past the finished threshold counts as its end, so the
        // fallback does not restart it and overwrite the finished record.
        //
        // 最后一集在已看完阈值之后出错视为播放结束, 避免回退逻辑重新播放并覆盖已看完的记录.
        if currentEpisodeIndex == episodes.count - 1, playbackCompleted(current: currentTime, duration: duration) {
            handlePlaybackEnded()
            return
        }
        let nextLine = currentLineIndex + 1
        if nextLine < allLines.count {
            detachOutgoingItem()
            currentLineIndex = nextLine
            startPlayback()
        } else {
            removeSource(currentSourceKey)
            if let next = sources.first {
                await switchSource(next.sourceKey)
                startPlayback()
            } else {
                error = "All sources failed"
            }
        }
    }

    /// Drops failed sources and loads the next source that exposes playable episodes.
    ///
    /// 移除失败视频源, 并加载下一个能提供可播放剧集的视频源.
    private func autoFallbackSource(failedKey: String) async {
        removeSource(failedKey)
        let candidates = sources
        for source in candidates {
            let ok = await loadDetail(sourceKey: source.sourceKey, videoId: source.videoId)
            if ok {
                currentLineIndex = 0
                clampCurrentEpisodeIndex()
                return
            }
            removeSource(source.sourceKey)
        }
    }

    private func matchEpisode(prevName: String) {
        guard !prevName.isEmpty else {
            clampCurrentEpisodeIndex()
            return
        }
        let prevNum = prevName.firstMatch(of: /\d+/)?.output
        if let prevNum {
            if let idx = episodes.firstIndex(where: { ($0.name.firstMatch(of: /\d+/)?.output).map(String.init) == String(prevNum) }) {
                currentEpisodeIndex = idx
                return
            }
        }
        currentEpisodeIndex = 0
    }

    /// Once after `prepareResume` found nothing under the navigation title: when the detail title
    /// normalizes differently, an unfinished record under it picks the line and episode. The caller
    /// clamps the indices.
    ///
    /// 在 `prepareResume` 于导航标题下一无所获之后只执行一次: 详情标题归一化后不同时, 由其下未看完
    /// 的记录决定线路和分集. 索引由调用方钳制.
    private func applyResumeByDetailTitle() {
        guard resumeByDetailTitle else { return }
        resumeByDetailTitle = false
        guard let title = detail?.title, normalizeSyncKey(title) != normalizeSyncKey(videoTitle),
              let item = syncStore?.watch(title: title), !item.completed else { return }
        currentLineIndex = max(0, item.groupIndex)
        currentEpisodeIndex = max(0, item.episodeIndex)
    }

	private func clampCurrentEpisodeIndex() {
		if let lineCount = detail?.episodes.count, lineCount > 0 {
			currentLineIndex = min(max(0, currentLineIndex), lineCount - 1)
		} else {
			currentLineIndex = 0
		}
		guard !episodes.isEmpty else {
			currentEpisodeIndex = 0
			return
		}
		currentEpisodeIndex = min(max(0, currentEpisodeIndex), episodes.count - 1)
	}

	private func playbackCompleted(current: TimeInterval, duration: TimeInterval) -> Bool {
		guard duration > 0, current > 0 else { return false }
		return duration - current <= 30 || current / duration >= 0.95
	}

    /// Applies detail refreshes without replacing stable movie metadata during source switching.
    ///
    /// 切换视频源时只刷新剧集, 避免覆盖稳定的影片元数据.
    private func applyDetail(_ newDetail: VideoDetail) {
        if let existing = detail {
            var updated = existing
            updated.episodes = newDetail.episodes
            detail = updated
        } else {
            detail = detailApplyingCoverHint(newDetail)
        }
    }

    private func detailApplyingCoverHint(_ detail: VideoDetail) -> VideoDetail {
        guard detail.cover.isEmpty, !coverHint.isEmpty else { return detail }
        var updated = detail
        updated.cover = coverHint
        return updated
    }

    private func hasPlayableDetail() -> Bool {
        !(detail?.episodes.isEmpty ?? true) && !(detail?.episodes.first?.isEmpty ?? true)
    }

    private func removeSource(_ sourceKey: String) {
        sources.removeAll { $0.sourceKey == sourceKey }
    }

    // MARK: - Playback Controls (for custom UI)

    func togglePlayPause() {
        guard player != nil else { return }
        if isPlaying {
            checkpoint()
            coordinator.pause()
            isPlaying = false
        } else {
            coordinator.resume(rate: playbackRate)
            isPlaying = true
        }
    }

    func seek(to time: TimeInterval) {
        // Without a player there is nothing to seek and no completion to clear the flag,
        // which would leave the time display and the buffered bar frozen for good.
        //
        // 没有 player 时既无从 seek, 也不会有 completion 来清除标志,
        // 那会让播放时间与缓冲进度条永久停更.
        guard let player else { return }
        beginSeek(to: time)
        player.seek(to: CMTime(seconds: time, preferredTimescale: 600)) { [weak self] finished in
            Task { @MainActor in
                self?.endSeek(finished: finished)
            }
        }
    }

    /// Puts the UI into the seeking state. Internal so the transition can be tested without
    /// an AVPlayer, which a unit test cannot attach.
    ///
    /// 将 UI 置为 seek 中的状态. 使用 internal 以便在没有 AVPlayer 的情况下测试该状态迁移,
    /// 而单元测试无法挂载 AVPlayer.
    func beginSeek(to time: TimeInterval) {
        currentTime = time
        // Nothing is known to be buffered at the target yet, so the bar goes back to the
        // thumb and grows again from the first sample taken after the seek lands.
        //
        // 目标位置尚不知有多少缓冲, 因此进度条先收回滑块处,
        // 待 seek 落地后的首次采样再重新增长.
        bufferedFraction = duration > 0 ? min(1, max(0, time / duration)) : 0
        // The readout has to fall back with the bar. Leaving it alone would pin the old
        // playhead's figure on screen — and visibly so, because the seek also raises the
        // waiting flag the readout stays visible for.
        //
        // 文字提示必须与进度条一同回落. 若不清除, 旧播放头的数字会被钉在画面上,
        // 而且必然可见: seek 同时会置起等待标志, 而该提示正是在等待期间持续显示.
        bufferedAheadSeconds = 0
        isSeeking = true
        isBuffering = true
        endCheckpointWritten = false
    }

    /// Leaves the seeking state, but only for the seek that actually arrived.
    ///
    /// 退出 seek 中的状态, 但仅针对真正到达目标的那一次 seek.
    ///
    /// A seek superseded by a newer one — two taps on skip, or a drag ending mid-seek —
    /// completes with `finished == false` while the newer seek is still in flight. Clearing
    /// the flag there would hand the buffered bar samples that still describe the old
    /// playhead.
    ///
    /// 被更新的 seek 顶替的那一次 — 连点两下快进, 或在 seek 途中结束拖动 —
    /// 会在新 seek 仍在进行时以 `finished == false` 完成.
    /// 若在此处清除标志, 缓冲进度条就会收到仍然描述旧播放头的采样.
    func endSeek(finished: Bool) {
        guard finished else { return }
        isSeeking = false
        refreshTransportState(player?.timeControlStatus)
    }

    func skip(by seconds: TimeInterval) {
        guard let player else { return }
        let current = CMTimeGetSeconds(player.currentTime())
        let target = max(0, current + seconds)
        seek(to: target)
    }

    func setRate(_ rate: Float) {
        playbackRate = rate
        if player?.timeControlStatus == .playing {
            player?.rate = rate
        }
    }

    // MARK: - Skip Settings

    func updateSkipIntro(_ value: Int) {
        skipIntroSeconds = value
        let settings = PlaybackSettings.get(in: modelContext, serverURL: serverURL, title: videoTitle)
        settings.skipIntroSeconds = value
        try? modelContext.save()
    }

    func updateSkipOutro(_ value: Int) {
        skipOutroSeconds = value
        let settings = PlaybackSettings.get(in: modelContext, serverURL: serverURL, title: videoTitle)
        settings.skipOutroSeconds = value
        try? modelContext.save()
    }

    deinit {
        // Safety net: primary cleanup is via cleanup() called from view lifecycle.
        // This class is @MainActor and owned by SwiftUI views, so deallocation
        // happens on the main thread. assumeIsolated is safe here.
        //
        // 兜底清理: 主要清理由视图生命周期调用 cleanup 完成.
        // 该类由 SwiftUI 在 MainActor 上持有, 因此这里使用 assumeIsolated 是安全的.
        MainActor.assumeIsolated {
            cleanup()
        }
    }

    // MARK: - Lifecycle

    func pause() {
        checkpoint()
        player?.pause()
    }

    func resume() {
        coordinator.resume(rate: playbackRate)
    }

    /// Stops the local copy's load watchdog while the app is in the background, where the loopback
    /// server is stopped.
    ///
    /// App 在后台时 loopback 服务已停止, 因此暂停本地副本的加载看门狗.
    func suspendLoadWatchdog() {
        coordinator.suspendLoadWatchdog()
    }

    /// Re-arms the load watchdog on return, when the item is still loading.
    ///
    /// 返回前台时, 若 item 仍在加载, 则重新启用加载看门狗.
    func resumeLoadWatchdog() {
        coordinator.resumeLoadWatchdog()
    }

    func cleanup() {
        logger.info("cleanup playback hasPlayer=\(self.player != nil, privacy: .public)")
        pause()
        coordinator.cleanup()
        player = nil
        isPlaying = false
        isBuffering = false
    }
}
