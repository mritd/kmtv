import Foundation
import SwiftData
import AVFoundation
import os

@Observable
@MainActor
final class PlayerViewModel {
    private let logger = Logger(subsystem: "com.mritd.kmtv", category: "playback")

    /// What the page can show: still loading, the loaded detail, or a failure once opening gave up.
    ///
    /// 页面可展示的状态: 仍在加载, 详情已加载, 或打开流程放弃后的失败.
    enum LoadState: Equatable {
        case loading
        case loaded
        case failed(String)
    }

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

    /// The page state both platforms render; a failure appears only after `open` finished without a
    /// detail, so a fallback still in progress shows as loading.
    ///
    /// 两个平台共同渲染的页面状态; 只有 `open` 结束且仍没有详情时才显示失败, 因此仍在进行的回退显示为加载中.
    var loadState: LoadState {
        if detail != nil { return .loaded }
        if openState == .opened { return .failed(error ?? PlayerError.allSourcesFailed.localizedDescription) }
        return .loading
    }

    // Playback UI state, kept in `transport` and published here under the same names. Each one is
    // observed on its own, through the forwarding accessors.
    //
    // 播放 UI 状态, 保存在 `transport` 中并以原名在此发布. 通过转发访问器, 每个属性仍单独被观察.
    private let transport = PlaybackTransportState()

    /// The time the UI shows: the playhead, or the scrub position while the user drags.
    ///
    /// UI 显示的时间: 播放头位置, 用户拖动时则为拖动位置.
    var currentTime: TimeInterval { transport.currentTime }
    var duration: TimeInterval {
        get { transport.duration }
        set { transport.duration = newValue }
    }
    var playbackRate: Float = 1.0
    /// See `PlaybackTransportState.bufferedFraction`.
    ///
    /// 见 `PlaybackTransportState.bufferedFraction`.
    var bufferedFraction: Double {
        get { transport.bufferedFraction }
        set { transport.bufferedFraction = newValue }
    }
    /// See `PlaybackTransportState.bufferedAheadSeconds`.
    ///
    /// 见 `PlaybackTransportState.bufferedAheadSeconds`.
    var bufferedAheadSeconds: TimeInterval {
        get { transport.bufferedAheadSeconds }
        set { transport.bufferedAheadSeconds = newValue }
    }
    var isPlaying: Bool {
        get { transport.isPlaying }
        set { transport.isPlaying = newValue }
    }
    /// Whether a seek or a scrub owns the time display; see `PlaybackTransportState.isSeeking`.
    ///
    /// seek 或拖动是否正占用时间显示; 见 `PlaybackTransportState.isSeeking`.
    var isSeeking: Bool { transport.isSeeking }
    var isBuffering: Bool {
        get { transport.isBuffering }
        set { transport.isBuffering = newValue }
    }

    /// Observable player handle used by SwiftUI to mount the video layer.
    ///
    /// SwiftUI 通过这个可观察播放器引用挂载视频图层.
    private(set) var player: AVPlayer?

    // Playback settings.
    //
    // 播放设置.
    var skipIntroSeconds: Int = 0
    var skipOutroSeconds: Int = 0

    // Checkpoint state of the attached item: cadence, dedupe, the finished record, the outro skip.
    //
    // 已挂载 item 的检查点状态: 保存节奏, 去重, 已看完记录与片尾跳过.
    private var progress = PlaybackProgressTracker()
    // Generation of the coordinator's current item, bumped for every item `startPlayer` attaches.
    // Every coordinator callback carries the generation it was registered for, so a callback queued
    // by an item that has since been replaced is recognized in the same turn it arrives. Readable
    // for tests.
    //
    // 协调器当前 item 的代号, `startPlayer` 每挂载一个 item 都会递增. 每个协调器回调都携带注册时的
    // 代号, 因此已被替换的 item 排队的回调在到达的同一轮次即可被识别. 只读公开, 供测试使用.
    private(set) var itemGeneration = 0
    // The generation whose reports may change the selection or write progress; nil from the moment
    // the selection starts to change until `startPlayer` attaches the next item, because the outgoing
    // item keeps reporting in that gap. Before any item exists, direct calls count as the live item.
    //
    // 其上报可以改变选择或写入进度的 item 代号; 从选择开始变化到 `startPlayer` 挂载下一个 item 之间为
    // nil, 因为旧 item 在这段时间仍在上报. 尚无任何 item 时, 直接调用视为来自当前 item.
    private var liveItem: Int? = 0
    // Bumped for every playback request; a URL reply that is not for the latest one is stale and
    // never attaches an item.
    //
    // 每次播放请求都会递增; 不属于最新请求的地址响应已过期, 不会挂载 item.
    private var playbackRequest = 0
    // The request whose URL reply has not arrived yet, if any.
    //
    // 尚未收到地址响应的播放请求 (如有).
    private var pendingPlaybackRequest: Int?
    private var playbackTask: Task<Void, Never>?
    // Bumped for every source switch; a detail reply for an older switch never commits.
    //
    // 每次切换视频源都会递增; 属于较早切换的详情响应永远不会提交.
    private var switchGeneration = 0
    private var switchTask: Task<Void, Never>?
    // Set by `prepareResume` when no record exists under the navigation title; the first
    // `loadDetail` then looks the record up under the detail title that checkpoints write under.
    //
    // 导航标题下没有记录时由 `prepareResume` 设置; 第一次 `loadDetail` 随后会用检查点写入时的
    // 详情标题查找记录.
    private var resumeByDetailTitle = false

    private enum OpenState { case idle, opening, opened }
    private var openState = OpenState.idle

    // Lifecycle of the hosting page (iOS): while hidden no item attaches, and the flags say what to
    // do on the next `appear()`.
    //
    // 宿主页面的生命周期 (iOS): 隐藏期间不挂载任何 item, 这些标志决定下一次 `appear()` 要做什么.
    private var isHidden = false
    /// Whether playback was running when the page disappeared, so the next appear resumes it.
    ///
    /// 页面消失时是否正在播放, 下一次出现时据此恢复播放.
    private(set) var resumesOnAppear = false
    private var restartOnAppear = false

    private let apiClient: any PlaybackDetailAPIProtocol
    private let syncStore: SyncStore?
    private let syncEngine: SyncEngine?
    private let playerSyncWait: Duration
    private let videoTitle: String
    /// The video ID the page was opened with; `open` uses it when the source list has no entry for
    /// the opening source.
    ///
    /// 打开页面时传入的视频 ID; 来源列表中没有打开时的来源条目时, `open` 使用它.
    private let initialVideoID: String
    private let coverHint: String
    private let progressStore: PlaybackProgressStore
    private let now: @MainActor () -> ContinuousClock.Instant
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

    /// Drives the player while this view model owns user-visible state.
    ///
    /// 播放器由 engine 驱动, 当前视图模型只维护用户可见状态.
    private let engine: any PlaybackEngine

    init(apiClient: any PlaybackDetailAPIProtocol, modelContext: ModelContext, serverURL: String,
         syncStore: SyncStore? = nil, syncEngine: SyncEngine? = nil,
         sources: [SourceResult], sourceKey: String, videoId: String, title: String,
         coverHint: String = "", initialEpisodeIndex: Int? = nil, playerSyncWait: Duration = .milliseconds(1500),
         localEpisodes: (any LocalEpisodeProviding)? = nil,
         localLoadTimeout: Duration = PlaybackCoordinator.localLoadTimeout,
         now: @escaping @MainActor () -> ContinuousClock.Instant = { ContinuousClock.now },
         engine: any PlaybackEngine = PlaybackCoordinator()) {
        self.engine = engine
        self.localEpisodes = localEpisodes
        self.localLoadTimeout = localLoadTimeout
        self.apiClient = apiClient
        self.syncStore = syncStore
        self.syncEngine = syncEngine
        self.playerSyncWait = playerSyncWait
        self.videoTitle = title
        self.initialVideoID = videoId
        self.coverHint = coverHint
        self.now = now
        self.progressStore = PlaybackProgressStore(modelContext: modelContext, serverURL: serverURL,
                                                   syncStore: syncStore, title: title)
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
        let videoID = currentVideoID.isEmpty ? initialVideoID : currentVideoID
        let ok = await loadDetail(sourceKey: currentSourceKey, videoId: videoID, generation: generation)
        guard !Task.isCancelled else {
            openState = .idle
            return
        }
        guard generation == switchGeneration else { return await yieldOpenToSwitch() }
        if ok {
            if autoplay { startPlayback() }
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
    /// and `startTime` reuses the saved position only when source, video, line, and episode match.
    /// When no record exists under the navigation title, `loadDetail` retries under the detail title.
    ///
    /// 短暂等待一次同步, 然后由未看完的观看记录决定线路和分集, 无论它保存自哪个来源. 当前来源
    /// 保持不变; `loadDetail` 会钳制索引, `startTime` 仅在来源, 视频, 线路和分集都一致时复用保存的进度.
    /// 导航标题下没有记录时, `loadDetail` 会改用详情标题再查一次.
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

    // MARK: - Playback

    /// Starts playing the current selection in a stored task; a newer request or `close()` cancels
    /// it. While the page is hidden nothing attaches: the request waits for the next `appear()`.
    ///
    /// 在保存的任务中开始播放当前选择; 更新的请求或 `close()` 会取消它. 页面隐藏期间不会挂载任何 item:
    /// 请求等到下一次 `appear()` 再执行.
    func startPlayback() {
        guard !isHidden else {
            restartOnAppear = true
            return
        }
        playbackTask?.cancel()
        let id = beginPlaybackRequest()
        playbackTask = Task { await self.play(request: id) }
    }

    /// The show key downloads are filed under: the detail title, as when enqueueing.
    ///
    /// 下载归档所用的剧集键: 详情标题, 与加入下载时一致.
    private var localShowKey: String { normalizeSyncKey(detail?.title ?? videoTitle) }

    func startPlaybackAsync() async {
        await play(request: beginPlaybackRequest())
    }

    private func beginPlaybackRequest() -> Int {
        playbackRequest += 1
        pendingPlaybackRequest = playbackRequest
        return playbackRequest
    }

    /// Whether `id` is still the latest playback request and its task was not cancelled.
    ///
    /// `id` 是否仍是最新的播放请求, 且其任务未被取消.
    private func isCurrentRequest(_ id: Int) -> Bool {
        id == playbackRequest && !Task.isCancelled
    }

    private func play(request id: Int) async {
        do {
            logger.info(
                "startPlaybackAsync source=\(self.currentSourceKey, privacy: .public) line=\(self.currentLineIndex, privacy: .public) episode=\(self.currentEpisodeIndex, privacy: .public)"
            )
            if !skipLocalCopy, let localEpisodes,
               let local = await localEpisodes.localPlaybackURL(showKey: localShowKey, sourceKey: currentSourceKey,
                                                                videoId: currentVideoID,
                                                                episodeIndex: currentEpisodeIndex) {
                guard isCurrentRequest(id) else { return }
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
            guard isCurrentRequest(id) else { return }
            startPlayer(with: url)
        } catch {
            guard isCurrentRequest(id) else { return }
            pendingPlaybackRequest = nil
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
        pendingPlaybackRequest = nil
        itemGeneration += 1
        let generation = itemGeneration
        liveItem = generation
        // A new item is a recovery; an error from an earlier attempt no longer applies.
        //
        // 新 item 意味着已恢复; 之前尝试留下的错误不再适用.
        error = nil
        // Show loading feedback while AVPlayer resolves playlists and media segments.
        //
        // AVPlayer 解析播放列表和媒体片段期间先显示加载反馈.
        isPlaying = false
        isBuffering = true
        resetPlaybackUIState()
        let startTime = startTimeForCurrentSelection()
        progress.beginItem(at: now())
        logger.info(
            "startPlayer url=\(PlaybackCoordinator.loggableURL(url), privacy: .public) startTime=\(startTime, privacy: .public) rate=\(self.playbackRate, privacy: .public) hadPlayer=\(self.player != nil, privacy: .public)"
        )
        engine.start(
            url: url,
            startTime: startTime,
            rate: playbackRate,
            allowsExternalPlayback: allowsExternalPlayback,
            loadTimeout: loadTimeout,
            callbacks: PlaybackCallbacks(
                onTime: { [weak self] current, total in
                    self?.onTimeUpdate(current: current, total: total, item: generation)
                },
                onBuffer: { [weak self] sample in
                    self?.onBufferUpdate(sample, item: generation)
                },
                onEnd: { [weak self] in
                    self?.handleItemEnded(item: generation)
                },
                onError: { [weak self] message in
                    self?.handleItemError(message, item: generation)
                }
            )
        )
        player = engine.player
        logger.info(
            "startPlayer ready hasPlayer=\(self.player != nil, privacy: .public) hasCurrentItem=\(self.engine.itemDuration != nil, privacy: .public) timeControlStatus=\(PlaybackCoordinator.describeTimeControlStatus(self.engine.timeControlStatus), privacy: .public)"
        )
    }

    /// Whether a report tagged with `item` may change the selection or write progress. Untagged
    /// reports (direct calls) speak for the live item.
    ///
    /// 带有 `item` 标记的上报是否可以改变选择或写入进度. 未标记的上报 (直接调用) 代表当前 item.
    private func isLive(_ item: Int?) -> Bool {
        guard let liveItem else { return false }
        return item.map { $0 == liveItem } ?? true
    }

    /// Whether a report tagged with `item` still describes the coordinator's current item, live or
    /// outgoing.
    ///
    /// 带有 `item` 标记的上报是否仍描述协调器的当前 item, 无论它是当前 item 还是正在离开的 item.
    private func isCurrentItem(_ item: Int?) -> Bool {
        item.map { $0 == itemGeneration } ?? true
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

    /// The player item reported its end. An outgoing or replaced item's end must not move the
    /// selection on.
    ///
    /// 播放器 item 报告结束. 正在离开或已被替换的 item 的结束不能让选择继续往下走.
    func handleItemEnded(item: Int? = nil) {
        guard isLive(item) else { return }
        handlePlaybackEnded()
    }

    /// The player item reported a failure. Decided in the turn the report arrives in: a report
    /// from an outgoing or replaced item says nothing about the item that is about to attach or
    /// already attached, so it is ignored.
    ///
    /// 播放器 item 报告失败. 在上报到达的同一轮次内做出决定: 来自正在离开或已被替换的 item 的上报
    /// 与即将挂载或已挂载的 item 无关, 因此忽略.
    func handleItemError(_ message: String?, item: Int? = nil) {
        guard isLive(item) else { return }
        let step = SourceFallbackPolicy.afterItemFailure(
            playingLocalCopy: isPlayingLocalCopy && localEpisodes != nil, selection: selection,
            current: currentTime, duration: duration
        )
        // A failed local copy is not an error the page shows; streaming takes over.
        //
        // 本地副本失败不是页面要显示的错误; 改由在线播放接管.
        if step != .streamSameSelection, let message { error = message }
        isBuffering = false
        follow(step, autoplay: true)
    }

    // MARK: - Time Updates

    /// Clears the timeline state a new item has not reported yet; see `PlaybackTransportState.reset()`.
    ///
    /// 清除新 item 尚未报告的时间轴状态; 见 `PlaybackTransportState.reset()`.
    func resetPlaybackUIState() {
        transport.reset()
    }

    /// Takes a wall-clock buffer sample from the current item.
    ///
    /// 接收当前 item 的墙钟缓冲采样.
    func onBufferUpdate(_ sample: BufferSample, item: Int? = nil) {
        guard isCurrentItem(item) else { return }
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
        refreshTransportState(engine.timeControlStatus)
        transport.applyBuffer(sample)
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
        let stopped = transport.applyTransport(status)
        // A pause the app did not ask for (an interruption, headphones removed) is still a stopping
        // point that another device should be able to resume from.
        //
        // 不是应用发起的暂停 (被打断, 耳机拔出) 同样是停顿点, 其他设备应能从这里继续.
        if stopped { checkpoint() }
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

    func onTimeUpdate(current: TimeInterval, total: TimeInterval, item: Int? = nil) {
        // A tick queued by an item that has since been replaced describes nothing on screen.
        //
        // 已被替换的 item 排队的时间更新与屏幕上的内容无关.
        guard isCurrentItem(item) else { return }
        transport.report(current: current, duration: total)
        refreshTransportState(engine.timeControlStatus)

        let tick = progress.tick(current: current, duration: total, isLive: isLive(item),
                                 skipOutroSeconds: skipOutroSeconds, now: now())
        if tick.save { saveProgress(current: current, duration: total) }
        if tick.skipOutro { playNextEpisode() }
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
        if let itemDuration = engine.itemDuration, itemDuration.isFinite, itemDuration > 0 { total = itemDuration }
        if total.isFinite && total > 0 {
            progress.forgetLastCheckpoint()
            saveProgress(current: total, duration: total, finished: true)
            progress.markEndWritten()
        }
        flushSync()
    }

    private func saveProgress(current: TimeInterval, duration: TimeInterval, finished: Bool = false) {
        // A non-finite time or duration never becomes a checkpoint.
        //
        // 非有限的时间或时长不会成为检查点.
        guard current.isFinite, duration.isFinite, current > 0, liveItem != nil else { return }
        guard let detail else { return }
        guard let ep = currentEpisode else { return }
        let videoId = selection.sourceVideoID()
        let checkpoint = "\(currentSourceKey)|\(videoId)|\(currentLineIndex)|\(currentEpisodeIndex)|\(Int(current))"
        guard progress.admit(checkpoint) else { return }
        let completed = finished || (currentEpisodeIndex == episodes.count - 1
            && PlaybackProgressPolicy.isCompleted(current: current, duration: duration))
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
        } else if let current = engine.currentTime, let total = engine.itemDuration {
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
    /// until the next item is attached. A URL reply still in flight belongs to the old selection, so
    /// it is dropped.
    ///
    /// 保存并推送当前位置, 然后在下一个 item 挂载之前禁止旧 item 写入进度. 仍在途中的地址响应属于旧的
    /// 选择, 因此被丢弃.
    private func detachOutgoingItem() {
        checkpoint()
        liveItem = nil
        isPlaying = false
        cancelPendingPlayback()
    }

    private func cancelPendingPlayback() {
        playbackRequest += 1
        pendingPlaybackRequest = nil
        playbackTask?.cancel()
        playbackTask = nil
    }

    /// Switches to another source in a stored task and returns it. A newer switch or `close()`
    /// supersedes it. The new detail is fetched first; the source, line, episodes, and episode then
    /// change together in one step, so nothing ever pairs the old source's episodes with the new
    /// source. With `autoplay`, playback starts once the switch committed.
    ///
    /// 在保存的任务中切换到另一个视频源并返回该任务. 更新的切换或 `close()` 会使其失效. 先拉取新的详情,
    /// 然后在同一步内一起修改视频源, 线路, 剧集列表与当前分集, 因此旧视频源的剧集永远不会与新视频源
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

    /// `selectSource(_:autoplay:)`, awaiting the switch.
    ///
    /// 等待切换完成的 `selectSource(_:autoplay:)`.
    func switchSource(_ sourceKey: String, autoplay: Bool) async {
        await selectSource(sourceKey, autoplay: autoplay).value
    }

    private func performSourceSwitch(to sourceKey: String, autoplay: Bool, generation: Int) async {
        guard let source = sources.first(where: { $0.sourceKey == sourceKey }) else { return }
        let fetched = await fetchPlayableDetail(sourceKey: sourceKey, videoId: source.videoId)
        // A newer switch, or `close()`, took over while this reply was in flight.
        //
        // 等待响应期间已有更新的切换或 `close()` 接管.
        guard generation == switchGeneration else { return }
        if let fetched {
            // Only the episodes come from the new source; the movie metadata stays.
            //
            // 只有剧集来自新视频源; 影片元数据保持不变.
            let prevEpName = currentEpisode?.name ?? ""
            detachOutgoingItem()
            currentSourceKey = sourceKey
            currentLineIndex = 0
            applyDetail(fetched)
            matchEpisode(prevName: prevEpName)
            error = nil
        } else {
            removeSource(sourceKey)
            guard await fallBackToAnotherSource(generation: generation) else { return }
        }
        if autoplay { startPlayback() }
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

    /// Handles failed playback by trying another CDN line first, then another source, and waits
    /// for a source switch it starts.
    ///
    /// 处理播放失败: 优先尝试下一条 CDN 线路, 再尝试下一个视频源, 并等待其发起的视频源切换完成.
    func handlePlaybackError() async {
        await recoverFromFailure(autoplay: true)?.value
    }

    /// Decides the fallback synchronously: finished if the last episode was past the finished
    /// threshold, else the next line, else the next source (whose switch task it returns), else the
    /// all-sources-failed error. With `autoplay`, the recovered selection starts playing.
    ///
    /// 同步决定回退方式: 最后一集已越过看完阈值则视为结束, 否则下一条线路, 否则下一个视频源 (返回其切换
    /// 任务), 否则报告所有视频源均失败. `autoplay` 为 true 时, 恢复后的选择会开始播放.
    @discardableResult
    private func recoverFromFailure(autoplay: Bool) -> Task<Void, Never>? {
        follow(SourceFallbackPolicy.afterFailure(selection: selection, current: currentTime, duration: duration),
               autoplay: autoplay)
    }

    /// Carries out a fallback step and returns the source switch it started, if any.
    ///
    /// 执行一个回退步骤, 并返回其发起的视频源切换任务 (如有).
    @discardableResult
    private func follow(_ step: SourceFallbackPolicy.Step, autoplay: Bool) -> Task<Void, Never>? {
        switch step {
        case .streamSameSelection:
            // The manager deletes the copy only when its files are missing.
            //
            // 只有文件缺失时管理器才会删除该副本.
            localEpisodes?.reportPlaybackFailure(showKey: localShowKey, sourceKey: currentSourceKey,
                                                 videoId: currentVideoID, episodeIndex: currentEpisodeIndex)
            isPlayingLocalCopy = false
            skipLocalCopy = true
            startPlayback()
        case .finish:
            handlePlaybackEnded()
        case .nextLine(let line):
            detachOutgoingItem()
            currentLineIndex = line
            if autoplay { startPlayback() }
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
            detachOutgoingItem()
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

    // MARK: - Playback Controls (for custom UI)

    func togglePlayPause() {
        guard player != nil else { return }
        if isPlaying {
            checkpoint()
            engine.pause()
            isPlaying = false
            isBuffering = false
        } else {
            engine.resume(rate: playbackRate)
            isPlaying = true
        }
    }

    func seek(to time: TimeInterval) {
        // Without a player there is nothing to seek and no completion to clear the flag,
        // which would leave the time display and the buffered bar frozen for good.
        //
        // 没有 player 时既无从 seek, 也不会有 completion 来清除标志,
        // 那会让播放时间与缓冲进度条永久停更.
        guard player != nil else { return }
        beginSeek(to: time)
        engine.seek(to: time) { [weak self] finished in
            self?.endSeek(finished: finished)
        }
    }

    /// Puts the UI into the seeking state. Internal so the transition can be tested without
    /// an AVPlayer, which a unit test cannot attach.
    ///
    /// 将 UI 置为 seek 中的状态. 使用 internal 以便在没有 AVPlayer 的情况下测试该状态迁移,
    /// 而单元测试无法挂载 AVPlayer.
    func beginSeek(to time: TimeInterval) {
        transport.beginSeek(to: time)
        progress.seekStarted()
    }

    /// Leaves the seeking state, but only for the seek that actually arrived; see
    /// `PlaybackTransportState.endSeek(finished:)`.
    ///
    /// 退出 seek 中的状态, 但仅针对真正到达目标的那一次 seek; 见 `PlaybackTransportState.endSeek(finished:)`.
    func endSeek(finished: Bool) {
        guard transport.endSeek(finished: finished) else { return }
        refreshTransportState(engine.timeControlStatus)
    }

    // MARK: - Scrubbing

    /// A drag on the progress bar started: the time label follows the drag, not the playhead.
    ///
    /// 进度条拖动开始: 时间显示跟随拖动位置, 而不是播放头.
    func beginScrub() {
        transport.beginScrub()
    }

    /// Moves the time label to `fraction` of the timeline while dragging.
    ///
    /// 拖动期间把时间显示移到时间轴的 `fraction` 处.
    func updateScrub(toFraction fraction: Double) {
        transport.updateScrub(toFraction: fraction)
    }

    /// The drag ended at `fraction`: seeks there. Without a player there is nothing to seek, so the
    /// label goes back to the playhead.
    ///
    /// 拖动在 `fraction` 处结束: seek 到该位置. 没有播放器时无从 seek, 时间显示回到播放头.
    func endScrub(atFraction fraction: Double) {
        guard let target = transport.endScrub(atFraction: fraction, canSeek: player != nil) else { return }
        seek(to: target)
    }

    /// The drag was cancelled (the system took the touch, or the bar went away): no seek, and the
    /// label goes back to the playhead.
    ///
    /// 拖动被取消 (系统接管了触摸, 或进度条消失): 不 seek, 时间显示回到播放头.
    func cancelScrub() {
        transport.cancelScrub()
    }

    func skip(by seconds: TimeInterval) {
        guard player != nil, let current = engine.currentTime else { return }
        let target = max(0, current + seconds)
        seek(to: target)
    }

    func setRate(_ rate: Float) {
        playbackRate = rate
        engine.setRate(rate)
    }

    /// Adopts a rate picked in the system fullscreen controls, so the inline menu shows it and the
    /// next episode keeps it.
    ///
    /// 采用在系统全屏控件中选择的倍速, 使内嵌菜单显示该倍速, 下一集也沿用它.
    func syncRateFromPlayer() {
        guard let rate = engine.chosenRate, rate > 0, rate != playbackRate else { return }
        playbackRate = rate
    }

    // MARK: - Skip Settings

    func updateSkipIntro(_ value: Int) {
        skipIntroSeconds = value
        progressStore.saveSettings(skipIntroSeconds: value)
    }

    func updateSkipOutro(_ value: Int) {
        skipOutroSeconds = value
        progressStore.saveSettings(skipOutroSeconds: value)
    }

    deinit {
        // Pages call `close()` or `disappear()`, which save the position; this only makes sure the
        // coordinator's observers and sampler timer go away with the model. It hops to the main actor
        // instead of asserting isolation, and does no SwiftData work.
        //
        // 页面会调用 `close()` 或 `disappear()`, 它们负责保存位置; 这里只确保协调器的观察者与采样定时器
        // 随模型一起释放. 通过跳转到主 actor 而不是断言隔离来完成, 且不做任何 SwiftData 操作.
        Task { @MainActor [engine] in
            engine.cleanup()
        }
    }

    // MARK: - Lifecycle

    func pause() {
        checkpoint()
        engine.pause()
        isPlaying = false
        isBuffering = false
    }

    func resume() {
        engine.resume(rate: playbackRate)
    }

    /// The page left the screen, by a pop or another tab. Saves and pauses, and remembers whether
    /// playback was running. A URL request still in flight is dropped and nothing attaches while the
    /// page is hidden, so a popped page never starts playing.
    ///
    /// 页面离开屏幕 (返回上一页或切换到其他标签页). 保存位置并暂停, 并记住此前是否正在播放.
    /// 仍在途中的地址请求被丢弃, 页面隐藏期间不会挂载任何 item, 因此已返回的页面永远不会开始播放.
    func disappear() {
        guard !isHidden else { return }
        resumesOnAppear = isPlaying || isBuffering
        if pendingPlaybackRequest != nil {
            restartOnAppear = true
            cancelPendingPlayback()
        }
        isHidden = true
        pause()
    }

    /// The page is back on screen: playback resumes only if it was running when the page left, and
    /// a request dropped while hidden starts again.
    ///
    /// 页面回到屏幕: 只有离开时正在播放才恢复播放, 隐藏期间被丢弃的请求会重新开始.
    func appear() {
        guard isHidden else { return }
        isHidden = false
        let restart = restartOnAppear
        let resumePlayback = resumesOnAppear
        restartOnAppear = false
        resumesOnAppear = false
        if restart {
            startPlayback()
        } else if resumePlayback {
            resume()
        }
    }

    /// Stops the local copy's load watchdog while the app is in the background, where the loopback
    /// server is stopped.
    ///
    /// App 在后台时 loopback 服务已停止, 因此暂停本地副本的加载看门狗.
    func suspendLoadWatchdog() {
        engine.suspendLoadWatchdog()
    }

    /// Re-arms the load watchdog on return, when the item is still loading.
    ///
    /// 返回前台时, 若 item 仍在加载, 则重新启用加载看门狗.
    func resumeLoadWatchdog() {
        engine.resumeLoadWatchdog()
    }

    /// Tears playback down: drops pending URL replies and source switches, saves the position, and
    /// releases the player. Playback can start again later, which the tvOS detail page relies on
    /// after a tab switch.
    ///
    /// 拆除播放: 丢弃待处理的地址响应与视频源切换, 保存位置并释放播放器. 之后仍可重新开始播放,
    /// tvOS 详情页在切换标签页后依赖这一点.
    func close() {
        logger.info("close playback hasPlayer=\(self.player != nil, privacy: .public)")
        cancelPendingPlayback()
        switchGeneration += 1
        switchTask?.cancel()
        switchTask = nil
        pause()
        engine.cleanup()
        // Reports queued by the torn-down item must not reach the next one.
        //
        // 已拆除的 item 排队的上报不能影响下一个 item.
        itemGeneration += 1
        liveItem = nil
        player = nil
    }
}
