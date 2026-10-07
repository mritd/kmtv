import Foundation
import Observation
import os

/// What the selection controller asks of the player that hosts it: the last reported position, and
/// the playback side of a selection change.
///
/// 选择控制器对宿主播放器的要求: 最近一次上报的位置, 以及选择变化在播放一侧的动作.
@MainActor
protocol PlaybackSelectionHost: AnyObject {
    /// The time the UI shows, which a fallback reads to tell a finished last episode.
    ///
    /// UI 显示的时间, 回退时据此判断最后一集是否已看完.
    var currentTime: TimeInterval { get }
    /// The current item's duration as last reported.
    ///
    /// 当前 item 最近一次上报的时长.
    var duration: TimeInterval { get }
    /// Saves the outgoing position and stops the outgoing item from writing progress until the next
    /// item attaches; drops a URL reply still in flight.
    ///
    /// 保存旧 item 的位置, 并在下一个 item 挂载前禁止其写入进度; 丢弃仍在途中的地址响应.
    func detachOutgoingItem()
    /// Starts playing the current selection.
    ///
    /// 开始播放当前选择.
    func startPlayback()
    /// The downloaded copy failed: reports it and streams the same selection instead.
    ///
    /// 下载副本失败: 上报失败并改为在线播放同一选择.
    func streamWithoutLocalCopy()
    /// Treats the current item as ended.
    ///
    /// 将当前 item 视为播放结束.
    func handlePlaybackEnded()
}

/// The open and source-switch flow of the online player: the loaded detail, the source list, the
/// selected source, line, and episode, and the page's load state. It loads details, applies the
/// resume record, switches sources and lines, and carries out `SourceFallbackPolicy` steps; the
/// playback side of each change goes through its `host`.
///
/// 在线播放器的打开与切换视频源流程: 已加载的详情, 视频源列表, 当前选中的视频源, 线路与分集, 以及页面的
/// 加载状态. 它负责加载详情, 应用续播记录, 切换视频源与线路, 并执行 `SourceFallbackPolicy` 的回退步骤;
/// 每次变化在播放一侧的动作交由 `host` 完成.
///
/// Every source switch bumps `switchGeneration`; a detail reply for an older switch never commits,
/// and an open that a user's switch overtook yields to that switch instead of reporting a failure.
///
/// 每次切换视频源都会递增 `switchGeneration`; 属于较早切换的详情响应永远不会提交, 被用户切换抢先的
/// 打开流程会让位于该切换, 而不是报告失败.
@Observable
@MainActor
final class PlaybackSelectionController {
    /// What the page can show: still loading, the loaded detail, or a failure once opening gave up.
    ///
    /// 页面可展示的状态: 仍在加载, 详情已加载, 或打开流程放弃后的失败.
    enum LoadState: Equatable {
        case loading
        case loaded
        case failed(String)
    }

    var detail: VideoDetail?
    var sources: [SourceResult]
    var currentSourceKey: String
    var currentLineIndex = 0
    var currentEpisodeIndex = 0
    var isLoadingDetail = false
    /// The error the page shows; the playback side sets it too, through the player.
    ///
    /// 页面显示的错误; 播放一侧也会通过播放器设置它.
    var error: String?

    private enum OpenState { case idle, opening, opened }
    private var openState = OpenState.idle

    // Bumped for every source switch; a detail reply for an older switch never commits.
    //
    // 每次切换视频源都会递增; 属于较早切换的详情响应永远不会提交.
    @ObservationIgnored private var switchGeneration = 0
    @ObservationIgnored private var switchTask: Task<Void, Never>?
    // Set by `prepareResume` when no record exists under the navigation title; the first
    // `loadDetail` then looks the record up under the detail title that checkpoints write under.
    //
    // 导航标题下没有记录时由 `prepareResume` 设置; 第一次 `loadDetail` 随后会用检查点写入时的
    // 详情标题查找记录.
    @ObservationIgnored private var resumeByDetailTitle = false

    /// The player that carries out the playback side of a selection change.
    ///
    /// 执行选择变化在播放一侧动作的播放器.
    @ObservationIgnored weak var host: (any PlaybackSelectionHost)?

    @ObservationIgnored private let logger = Logger(subsystem: "com.mritd.kmtv", category: "playback")
    @ObservationIgnored private let apiClient: any PlaybackDetailAPIProtocol
    @ObservationIgnored private let syncStore: SyncStore?
    @ObservationIgnored private let syncEngine: SyncEngine?
    @ObservationIgnored private let playerSyncWait: Duration
    @ObservationIgnored private let videoTitle: String
    /// The video ID the page was opened with; `open` uses it when the source list has no entry for
    /// the opening source.
    ///
    /// 打开页面时传入的视频 ID; 来源列表中没有打开时的来源条目时, `open` 使用它.
    @ObservationIgnored private let initialVideoID: String
    @ObservationIgnored let coverHint: String

    init(apiClient: any PlaybackDetailAPIProtocol, syncStore: SyncStore?, syncEngine: SyncEngine?,
         playerSyncWait: Duration, sources: [SourceResult], sourceKey: String, videoId: String, title: String,
         coverHint: String, initialEpisodeIndex: Int?) {
        self.apiClient = apiClient
        self.syncStore = syncStore
        self.syncEngine = syncEngine
        self.playerSyncWait = playerSyncWait
        self.videoTitle = title
        self.initialVideoID = videoId
        self.coverHint = coverHint
        self.sources = sources
        self.currentSourceKey = sourceKey
        self.currentEpisodeIndex = max(0, initialEpisodeIndex ?? 0)
    }

    /// The page state both platforms render; a failure appears only after `open` finished without a
    /// detail, so a fallback still in progress shows as loading.
    ///
    /// 两个平台共同渲染的页面状态; 只有 `open` 结束且仍没有详情时才显示失败, 因此仍在进行的回退显示为加载中.
    var loadState: LoadState {
        if detail != nil { return .loaded }
        if openState == .opened { return .failed(error ?? PlayerError.allSourcesFailed.localizedDescription) }
        return .loading
    }

    /// The selection as a value, for the derived episode lists and indices.
    ///
    /// 以值类型表示的当前选择, 用于推导剧集列表与索引.
    var selection: EpisodeSelection {
        EpisodeSelection(
            detail: detail,
            sources: sources,
            currentSourceKey: currentSourceKey,
            currentLineIndex: currentLineIndex,
            currentEpisodeIndex: currentEpisodeIndex
        )
    }

    /// The show's title: the detail title once loaded, otherwise the navigation title. Favorites and
    /// downloads are keyed by it.
    ///
    /// 剧集标题: 详情加载后为详情标题, 否则为导航标题. 收藏与下载均以它为键.
    var showTitle: String { detail?.title ?? videoTitle }

    // MARK: - Open

    /// Opens the page: waits briefly for a sync and picks the resume episode, loads the detail, and
    /// falls back to another line or source when that fails. With `autoplay`, playback starts at the
    /// end. Runs once; a call while it runs or after it finished does nothing, and an open whose task
    /// was cancelled runs again on the next call.
    ///
    /// 打开页面: 短暂等待同步并选出续播分集, 加载详情, 失败时回退到其他线路或视频源. `autoplay` 为 true
    /// 时最后开始播放. 只执行一次; 执行中或完成后的调用不做任何事, 任务被取消的打开会在下次调用时重新执行.
    func open(autoplay: Bool) async {
        guard openState == .idle else { return }
        openState = .opening
        // A source the user picks while this runs owns the selection from then on.
        //
        // 执行期间用户选择的视频源从此接管当前选择.
        let generation = switchGeneration
        await prepareResume()
        guard !Task.isCancelled else {
            openState = .idle
            return
        }
        guard generation == switchGeneration else { return await yieldOpenToSwitch() }
        let videoID = selection.sourceVideoID().isEmpty ? initialVideoID : selection.sourceVideoID()
        let ok = await loadDetail(sourceKey: currentSourceKey, videoId: videoID, generation: generation)
        guard !Task.isCancelled else {
            openState = .idle
            return
        }
        guard generation == switchGeneration else { return await yieldOpenToSwitch() }
        if ok {
            if autoplay { host?.startPlayback() }
        } else {
            await recoverFromFailure(autoplay: autoplay)?.value
        }
        openState = .opened
    }

    /// Ends an open that a user's source switch overtook: the switch already loads, commits, and plays
    /// its source, so the open only waits for it, which keeps a switch in flight from reading as a failure.
    ///
    /// 结束被用户切换视频源抢先的打开流程: 切换本身会加载, 提交并播放所选视频源, 因此打开流程只需等待它
    /// 完成, 避免切换进行中时页面显示为失败.
    private func yieldOpenToSwitch() async {
        await switchTask?.value
        openState = .opened
    }

    /// Waits briefly for a sync, then lets an unfinished watch record pick the line and episode,
    /// whichever source it was saved from. The open source stays; `loadDetail` clamps the indices,
    /// and the player's start time reuses the saved position only when source, video, line, and
    /// episode match. When no record exists under the navigation title, `loadDetail` retries under
    /// the detail title.
    ///
    /// 短暂等待一次同步, 然后由未看完的观看记录决定线路和分集, 无论它保存自哪个来源. 当前来源
    /// 保持不变; `loadDetail` 会钳制索引, 播放器的起播位置仅在来源, 视频, 线路和分集都一致时复用保存的
    /// 进度. 导航标题下没有记录时, `loadDetail` 会改用详情标题再查一次.
    func prepareResume() async {
        let generation = switchGeneration
        if let syncEngine {
            await syncEngine.requestSync(.player, waitingAtMost: playerSyncWait)
        }
        // A source picked during the wait chose its own line and episode.
        //
        // 等待期间选择的视频源已自行决定线路和分集.
        guard generation == switchGeneration else { return }
        let record = syncStore?.watch(title: videoTitle)
        resumeByDetailTitle = syncStore != nil && record == nil
        guard let item = record, !item.completed else { return }
        currentLineIndex = max(0, item.groupIndex)
        currentEpisodeIndex = max(0, item.episodeIndex)
    }

    /// Loads and commits the detail of `sourceKey`. With a `generation`, a reply that arrives after a
    /// newer source switch is dropped and reported as not loaded.
    ///
    /// 加载并提交 `sourceKey` 的详情. 传入 `generation` 时, 晚于更新的视频源切换到达的响应会被丢弃,
    /// 并视为未加载.
    func loadDetail(sourceKey: String, videoId: String, generation: Int? = nil) async -> Bool {
        isLoadingDetail = true
        defer { isLoadingDetail = false }
        do {
            let d = try await apiClient.detail(sourceKey: sourceKey, videoId: videoId)
            if let generation, generation != switchGeneration { return false }
            detail = detailApplyingCoverHint(d)
            currentSourceKey = sourceKey
            error = nil

            if !sources.contains(where: { $0.sourceKey == sourceKey }) {
                sources.insert(SourceResult(
                    sourceKey: sourceKey, sourceName: sourceKey, videoId: videoId,
                    durationMs: 0, episodes: d.episodes.first ?? []
                ), at: 0)
            }
            applyResumeByDetailTitle()
            clampCurrentEpisodeIndex()

            return SourceFallbackPolicy.isPlayable(d)
        } catch {
            if let generation, generation != switchGeneration { return false }
            self.error = error.localizedDescription
            return false
        }
    }

    /// Resolves the selected episode through `/playback/url` before AVPlayer sees it.
    ///
    /// 在交给 AVPlayer 前, 先通过 `/playback/url` 解析当前选中的剧集地址.
    func preparePlaybackURL() async throws -> URL {
        guard let ep = selection.currentEpisode else {
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

    // MARK: - Switching

    /// Switches to another source in a stored task and returns it. A newer switch or `cancelSwitch()`
    /// supersedes it. The new detail is fetched first; the source, line, episodes, and episode then
    /// change together in one step, so nothing ever pairs the old source's episodes with the new
    /// source. With `autoplay`, playback starts once the switch committed.
    ///
    /// 在保存的任务中切换到另一个视频源并返回该任务. 更新的切换或 `cancelSwitch()` 会使其失效. 先拉取新的
    /// 详情, 然后在同一步内一起修改视频源, 线路, 剧集列表与当前分集, 因此旧视频源的剧集永远不会与新视频源
    /// 配对. `autoplay` 为 true 时, 切换提交后开始播放.
    @discardableResult
    func selectSource(_ sourceKey: String, autoplay: Bool) -> Task<Void, Never> {
        switchTask?.cancel()
        switchGeneration += 1
        let generation = switchGeneration
        let task = Task { await self.performSourceSwitch(to: sourceKey, autoplay: autoplay, generation: generation) }
        switchTask = task
        return task
    }

    /// Drops a source switch in flight: its reply never commits and its task is cancelled.
    ///
    /// 丢弃进行中的视频源切换: 其响应永远不会提交, 其任务被取消.
    func cancelSwitch() {
        switchGeneration += 1
        switchTask?.cancel()
        switchTask = nil
    }

    private func performSourceSwitch(to sourceKey: String, autoplay: Bool, generation: Int) async {
        guard let source = sources.first(where: { $0.sourceKey == sourceKey }) else { return }
        let fetched = await fetchPlayableDetail(sourceKey: sourceKey, videoId: source.videoId)
        // A newer switch, or a close, took over while this reply was in flight.
        //
        // 等待响应期间已有更新的切换或关闭接管.
        guard generation == switchGeneration else { return }
        if let fetched {
            // Only the episodes come from the new source; the movie metadata stays.
            //
            // 只有剧集来自新视频源; 影片元数据保持不变.
            let prevEpName = selection.currentEpisode?.name ?? ""
            host?.detachOutgoingItem()
            currentSourceKey = sourceKey
            currentLineIndex = 0
            applyDetail(fetched)
            matchEpisode(prevName: prevEpName)
            error = nil
        } else {
            removeSource(sourceKey)
            guard await fallBackToAnotherSource(generation: generation) else { return }
        }
        if autoplay { host?.startPlayback() }
    }

    /// Switches to line `index`, starting at its first episode, and plays it.
    ///
    /// 切换到第 `index` 条线路, 从其第一集开始播放.
    func switchLine(_ index: Int) {
        host?.detachOutgoingItem()
        currentLineIndex = index
        currentEpisodeIndex = 0
        host?.startPlayback()
    }

    /// Switches to episode `index` of the current line and plays it.
    ///
    /// 切换到当前线路的第 `index` 集并播放.
    func switchEpisode(_ index: Int) {
        host?.detachOutgoingItem()
        currentEpisodeIndex = index
        host?.startPlayback()
    }

    // MARK: - Favorites

    /// Whether the title is a favorite in any source.
    ///
    /// 该标题是否已收藏, 与来源无关.
    var isFavorited: Bool { syncStore?.isFavorite(title: showTitle) ?? false }

    /// Adds the title to the favorites under the current source, or removes it.
    ///
    /// 以当前视频源把该标题加入收藏, 或取消收藏.
    func toggleFavorite() {
        guard let syncStore else { return }
        let title = showTitle
        if syncStore.isFavorite(title: title) {
            syncStore.remove(.favorite, key: title)
            return
        }
        let videoId = sources.first(where: { $0.sourceKey == currentSourceKey })?.videoId ?? selection.sourceVideoID()
        syncStore.upsert(.favorite(FavoritePayload(
            title: title, cover: detail?.cover ?? coverHint, type: detail?.type ?? "", year: detail?.year ?? "",
            desc: detail?.desc ?? "", sourceKey: currentSourceKey, videoId: videoId
        )))
    }

    // MARK: - Fallback

    /// Decides the fallback synchronously: finished if the last episode was past the finished
    /// threshold, else the next line, else the next source (whose switch task it returns), else the
    /// all-sources-failed error. With `autoplay`, the recovered selection starts playing.
    ///
    /// 同步决定回退方式: 最后一集已越过看完阈值则视为结束, 否则下一条线路, 否则下一个视频源 (返回其切换
    /// 任务), 否则报告所有视频源均失败. `autoplay` 为 true 时, 恢复后的选择会开始播放.
    @discardableResult
    func recoverFromFailure(autoplay: Bool) -> Task<Void, Never>? {
        follow(SourceFallbackPolicy.afterFailure(selection: selection, current: host?.currentTime ?? 0,
                                                 duration: host?.duration ?? 0),
               autoplay: autoplay)
    }

    /// Carries out a fallback step and returns the source switch it started, if any.
    ///
    /// 执行一个回退步骤, 并返回其发起的视频源切换任务 (如有).
    @discardableResult
    func follow(_ step: SourceFallbackPolicy.Step, autoplay: Bool) -> Task<Void, Never>? {
        switch step {
        case .streamSameSelection:
            host?.streamWithoutLocalCopy()
        case .finish:
            host?.handlePlaybackEnded()
        case .nextLine(let line):
            host?.detachOutgoingItem()
            currentLineIndex = line
            if autoplay { host?.startPlayback() }
        case .nextSource(let key):
            removeSource(currentSourceKey)
            return selectSource(key, autoplay: autoplay)
        case .allSourcesFailed:
            removeSource(currentSourceKey)
            error = PlayerError.allSourcesFailed.localizedDescription
        }
        return nil
    }

    /// Commits the first remaining source, in list order, that exposes playable episodes, dropping
    /// each one that fails. Returns false when a newer switch took over or no source is left.
    ///
    /// 按列表顺序提交第一个能提供可播放剧集的剩余视频源, 并移除每个失败的视频源. 有更新的切换接管或
    /// 没有剩余视频源时返回 false.
    private func fallBackToAnotherSource(generation: Int) async -> Bool {
        for source in sources {
            let fetched = await fetchPlayableDetail(sourceKey: source.sourceKey, videoId: source.videoId)
            guard generation == switchGeneration else { return false }
            guard let fetched else {
                removeSource(source.sourceKey)
                continue
            }
            host?.detachOutgoingItem()
            detail = detailApplyingCoverHint(fetched)
            currentSourceKey = source.sourceKey
            applyResumeByDetailTitle()
            currentLineIndex = 0
            clampCurrentEpisodeIndex()
            error = nil
            return true
        }
        error = PlayerError.allSourcesFailed.localizedDescription
        return false
    }

    /// The source's detail when it loads and has a playable first line; nil otherwise.
    ///
    /// 视频源详情加载成功且第一条线路可播放时返回该详情; 否则返回 nil.
    private func fetchPlayableDetail(sourceKey: String, videoId: String) async -> VideoDetail? {
        do {
            let fetched = try await apiClient.detail(sourceKey: sourceKey, videoId: videoId)
            return SourceFallbackPolicy.isPlayable(fetched) ? fetched : nil
        } catch {
            logger.error("fetchPlayableDetail failed source=\(sourceKey, privacy: .public) error=\(error.localizedDescription, privacy: .public)")
            return nil
        }
    }

    // MARK: - Selection Helpers

    private func matchEpisode(prevName: String) {
        guard !prevName.isEmpty else {
            clampCurrentEpisodeIndex()
            return
        }
        currentEpisodeIndex = selection.episodeIndex(matchingNumberIn: prevName) ?? 0
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
        let clamped = selection.clampedIndices()
        currentLineIndex = clamped.line
        currentEpisodeIndex = clamped.episode
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

    /// The detail with the hint's cover. The hint is the cover the user tapped (see
    /// `SearchView.bestCover`) or a saved record's cover, so it wins over the source's own, which
    /// some sources block.
    ///
    /// 换用提示封面的详情. 提示封面是用户点按的封面 (见 `SearchView.bestCover`) 或已保存记录中的封面,
    /// 因此优先于源站自己的封面, 后者可能被部分源站拦截.
    private func detailApplyingCoverHint(_ detail: VideoDetail) -> VideoDetail {
        guard !coverHint.isEmpty, detail.cover != coverHint else { return detail }
        var updated = detail
        updated.cover = coverHint
        return updated
    }

    private func removeSource(_ sourceKey: String) {
        sources.removeAll { $0.sourceKey == sourceKey }
    }
}
