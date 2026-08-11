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
    var isFavorited = false
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

    private let apiClient: any PlaybackDetailAPIProtocol
    private let modelContext: ModelContext
	private let serverURL: String
	private let userID: Int64
    private let videoTitle: String
    private let coverHint: String
    private let progressStore: PlaybackProgressStore

    /// Coordinates player side effects while this view model owns user-visible state.
    ///
    /// 播放器副作用交给 coordinator 管理, 当前视图模型只维护用户可见状态.
    private let coordinator = PlaybackCoordinator()

	init(apiClient: any PlaybackDetailAPIProtocol, modelContext: ModelContext, serverURL: String, userID: Int64 = 0,
         sources: [SourceResult], sourceKey: String, videoId: String, title: String,
         coverHint: String = "", initialEpisodeIndex: Int? = nil) {
        self.apiClient = apiClient
        self.modelContext = modelContext
		self.serverURL = serverURL
		self.userID = userID
        self.videoTitle = title
        self.coverHint = coverHint
		self.progressStore = PlaybackProgressStore(modelContext: modelContext, serverURL: serverURL, userID: userID, title: title)
        self.sources = sources
        self.currentSourceKey = sourceKey
        self.currentEpisodeIndex = max(0, initialEpisodeIndex ?? 0)

        self.isFavorited = FavoriteItem.exists(in: modelContext, serverURL: serverURL, sourceKey: sourceKey, videoId: videoId)

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

	func loadRemoteWatchHistory() async {
		guard userID > 0 else { return }
		do {
			let item = try await apiClient.watchHistory(title: videoTitle)
			guard !item.completed else {
				WatchHistoryItem.delete(
					in: modelContext,
					serverURL: serverURL,
					userID: userID,
					title: videoTitle
				)
				return
			}
			if sources.contains(where: { $0.sourceKey == item.sourceKey && $0.videoId == item.videoId }) {
				currentSourceKey = item.sourceKey
				currentLineIndex = max(0, item.groupIndex)
				currentEpisodeIndex = max(0, item.episodeIndex)
			}
			WatchHistoryItem.upsert(
				in: modelContext,
				serverURL: serverURL,
				userID: userID,
				sourceKey: item.sourceKey,
				videoId: item.videoId,
				title: item.title,
				cover: item.cover,
				episode: item.episode,
				groupIndex: item.groupIndex,
				episodeIndex: item.episodeIndex,
				progress: item.progressSec,
				duration: item.durationSec
			)
		} catch {
			// Missing or temporarily unavailable remote history leaves the user-scoped cache in place.
			//
			// 远端历史不存在或暂时不可用时, 保留当前用户范围内的本地缓存.
		}
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
            let url = try await preparePlaybackURL()
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
            "preparePlaybackURL response mode=\(response.mode, privacy: .public) resolvedURL=\(response.url, privacy: .public)"
        )
        guard let url = URL(string: response.url) else {
            logger.error("preparePlaybackURL invalid resolvedURL=\(response.url, privacy: .public)")
            throw PlayerError.invalidPlaybackURL(response.url)
        }
        return url
    }

    private func startPlayer(with url: URL) {
        skipOutroTriggered = false
        // Show loading feedback while AVPlayer resolves playlists and media segments.
        //
        // AVPlayer 解析播放列表和媒体片段期间先显示加载反馈.
        isPlaying = false
        isBuffering = true
        resetPlaybackUIState()
        let startTime = progressStore.startTime(
            sourceKey: currentSourceKey,
            videoId: selection.sourceVideoID(),
			groupIndex: currentLineIndex,
            episodeIndex: currentEpisodeIndex,
            skipIntroSeconds: skipIntroSeconds
        )
        logger.info(
            "startPlayer url=\(url.absoluteString, privacy: .public) startTime=\(startTime, privacy: .public) rate=\(self.playbackRate, privacy: .public) hadPlayer=\(self.player != nil, privacy: .public)"
        )
        coordinator.start(
            url: url,
            startTime: startTime,
            rate: playbackRate,
            onTime: { [weak self] current, total in
                self?.onTimeUpdate(current: current, total: total)
            },
            onBuffer: { [weak self] sample in
                self?.onBufferUpdate(sample)
            },
            onEnd: { [weak self] in
                self?.playNextEpisode()
            },
            onError: { [weak self] message in
                if let message {
                    self?.error = message
                }
                self?.isBuffering = false
                Task { await self?.handlePlaybackError() }
            }
        )
        player = coordinator.player
        logger.info(
            "startPlayer ready hasPlayer=\(self.player != nil, privacy: .public) hasCurrentItem=\(self.player?.currentItem != nil, privacy: .public) timeControlStatus=\(PlaybackCoordinator.describeTimeControlStatus(self.player?.timeControlStatus), privacy: .public)"
        )
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
        isPlaying = status == .playing
        isBuffering = status == .waitingToPlayAtSpecifiedRate
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

        if abs(current - lastSaveTime) >= 5 {
            lastSaveTime = current
            saveProgress(current: current, duration: total)
        }

        if !skipOutroTriggered && skipOutroSeconds > 0 && total > 0 {
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

    private func saveProgress(current: TimeInterval, duration: TimeInterval) {
        guard let detail else { return }
        guard let ep = currentEpisode else { return }
        let videoId = selection.sourceVideoID()
		let completed = currentEpisodeIndex == episodes.count - 1
			&& playbackCompleted(current: current, duration: duration)
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
		let request = WatchHistoryRequest(
            sourceKey: currentSourceKey,
            videoId: videoId,
            title: detail.title,
            cover: detail.cover,
            episode: ep.name,
            groupIndex: currentLineIndex,
            episodeIndex: currentEpisodeIndex,
            progressSec: current,
            durationSec: duration,
			completed: completed,
			eventTimeMS: Int64(Date().timeIntervalSince1970 * 1000)
        )
        Task {
            _ = try? await apiClient.saveWatchHistory(request)
        }
    }

    // MARK: - Switching

    func switchSource(_ sourceKey: String) async {
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
        currentLineIndex = index
        currentEpisodeIndex = 0
        startPlayback()
    }

    func switchEpisode(_ index: Int) {
        currentEpisodeIndex = index
        startPlayback()
    }

    func toggleFavorite() {
        let videoId = sources.first(where: { $0.sourceKey == currentSourceKey })?.videoId ?? ""
        isFavorited = FavoriteItem.toggle(
            in: modelContext, serverURL: serverURL, sourceKey: currentSourceKey,
            videoId: videoId, title: detail?.title ?? "",
            cover: detail?.cover ?? "", type: detail?.type ?? "", year: detail?.year ?? ""
        )
        try? modelContext.save()
    }

    // MARK: - Auto-fallback

    /// Handles failed playback by trying another CDN line first, then another source.
    ///
    /// 处理播放失败: 优先尝试下一条 CDN 线路, 再尝试下一个视频源.
    func handlePlaybackError() async {
        let nextLine = currentLineIndex + 1
        if nextLine < allLines.count {
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
        if let player, let item = player.currentItem {
            let current = CMTimeGetSeconds(player.currentTime())
            let total = CMTimeGetSeconds(item.duration)
            if current.isFinite && total.isFinite && current > 0 && total > 0 {
                saveProgress(current: current, duration: total)
            }
        }
        player?.pause()
    }

    func resume() {
        coordinator.resume(rate: playbackRate)
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
