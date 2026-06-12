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
    // 播放 UI 状态, 由时间观察器持续更新.
    var currentTime: TimeInterval = 0
    var duration: TimeInterval = 0
    var playbackRate: Float = 1.0

    var isPlaying: Bool = false
    var isSeeking: Bool = false
    var isBuffering: Bool = false

    /// Observable player handle used by SwiftUI to mount the video layer.
    /// SwiftUI 通过这个可观察播放器引用挂载视频图层.
    private(set) var player: AVPlayer?

    // Playback settings.
    // 播放设置.
    var skipIntroSeconds: Int = 0
    var skipOutroSeconds: Int = 0

    // Progress tracking.
    // 播放进度跟踪.
    private var lastSaveTime: TimeInterval = 0
    private var skipOutroTriggered = false

    private let apiClient: any PlaybackDetailAPIProtocol
    private let modelContext: ModelContext
    private let serverURL: String
    private let videoTitle: String
    private let coverHint: String
    private let progressStore: PlaybackProgressStore

    /// Coordinates player side effects while this view model owns user-visible state.
    /// 播放器副作用交给 coordinator 管理, 当前视图模型只维护用户可见状态.
    private let coordinator = PlaybackCoordinator()

    init(apiClient: any PlaybackDetailAPIProtocol, modelContext: ModelContext, serverURL: String,
         sources: [SourceResult], sourceKey: String, videoId: String, title: String,
         coverHint: String = "", initialEpisodeIndex: Int? = nil) {
        self.apiClient = apiClient
        self.modelContext = modelContext
        self.serverURL = serverURL
        self.videoTitle = title
        self.coverHint = coverHint
        self.progressStore = PlaybackProgressStore(modelContext: modelContext, serverURL: serverURL, title: title)
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

    // MARK: - Load

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
        // AVPlayer 解析播放列表和媒体片段期间先显示加载反馈.
        isPlaying = false
        isBuffering = true
        let startTime = progressStore.startTime(
            sourceKey: currentSourceKey,
            videoId: selection.sourceVideoID(),
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

    func onTimeUpdate(current: TimeInterval, total: TimeInterval) {
        // Don't overwrite currentTime while user is dragging the slider.
        // 用户拖动进度条时不覆盖 currentTime, 避免 UI 跳动.
        if !isSeeking {
            currentTime = current
        }
        duration = total
        isPlaying = player?.timeControlStatus == .playing
        isBuffering = player?.timeControlStatus == .waitingToPlayAtSpecifiedRate

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
        progressStore.saveProgress(
            detail: detail,
            sourceKey: currentSourceKey,
            videoId: selection.sourceVideoID(),
            episode: ep,
            episodeIndex: currentEpisodeIndex,
            current: current,
            duration: duration
        )
    }

    // MARK: - Switching

    func switchSource(_ sourceKey: String) async {
        let prevEpName = currentEpisode?.name ?? ""

        currentSourceKey = sourceKey
        currentLineIndex = 0

        guard let source = sources.first(where: { $0.sourceKey == sourceKey }) else { return }

        // Only fetch episodes for the new source, preserve existing detail info.
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
        guard !episodes.isEmpty else {
            currentEpisodeIndex = 0
            return
        }
        currentEpisodeIndex = min(max(0, currentEpisodeIndex), episodes.count - 1)
    }

    /// Applies detail refreshes without replacing stable movie metadata during source switching.
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
        currentTime = time
        isSeeking = true
        isBuffering = true
        player?.seek(to: CMTime(seconds: time, preferredTimescale: 600)) { [weak self] _ in
            Task { @MainActor in
                self?.isSeeking = false
                self?.isBuffering = self?.player?.timeControlStatus == .waitingToPlayAtSpecifiedRate
            }
        }
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
