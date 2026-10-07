import Foundation
import SwiftData
import AVFoundation
import os

@Observable
@MainActor
final class PlayerViewModel {
    private let logger = Logger(subsystem: "com.mritd.kmtv", category: "playback")

    /// See `PlaybackSelectionController.LoadState`.
    ///
    /// 见 `PlaybackSelectionController.LoadState`.
    typealias LoadState = PlaybackSelectionController.LoadState

    // The open and source-switch flow with the selection it owns, published here under the same
    // names through the forwarding accessors, each still observed on its own.
    //
    // 打开与切换视频源流程及其持有的选择状态, 通过转发访问器以原名在此发布, 每个属性仍单独被观察.
    private let selector: PlaybackSelectionController

    var detail: VideoDetail? {
        get { selector.detail }
        set { selector.detail = newValue }
    }
    var sources: [SourceResult] { selector.sources }
    var currentSourceKey: String { selector.currentSourceKey }
    var currentLineIndex: Int { selector.currentLineIndex }
    var currentEpisodeIndex: Int { selector.currentEpisodeIndex }
    /// Whether the title is a favorite in any source.
    ///
    /// 该标题是否已收藏, 与来源无关.
    var isFavorited: Bool { selector.isFavorited }
    var isLoadingDetail: Bool { selector.isLoadingDetail }
    var error: String? {
        get { selector.error }
        set { selector.error = newValue }
    }
    /// See `PlaybackSelectionController.loadState`.
    ///
    /// 见 `PlaybackSelectionController.loadState`.
    var loadState: LoadState { selector.loadState }

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

    private let syncEngine: SyncEngine?
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
        self.syncEngine = syncEngine
        self.now = now
        self.progressStore = PlaybackProgressStore(modelContext: modelContext, serverURL: serverURL,
                                                   syncStore: syncStore, title: title)
        self.selector = PlaybackSelectionController(
            apiClient: apiClient, syncStore: syncStore, syncEngine: syncEngine, playerSyncWait: playerSyncWait,
            sources: sources, sourceKey: sourceKey, videoId: videoId, title: title, coverHint: coverHint,
            initialEpisodeIndex: initialEpisodeIndex
        )

        let settings = progressStore.loadSettings()
        self.skipIntroSeconds = settings.skipIntroSeconds
        self.skipOutroSeconds = settings.skipOutroSeconds
        selector.host = self
    }

    private var selection: EpisodeSelection { selector.selection }

    var allLines: [[Episode]] { selection.allLines }
    var episodes: [Episode] { selection.episodes }
    var currentEpisode: Episode? { selection.currentEpisode }
    var currentEpisodeName: String { currentEpisode?.name ?? "" }
    var currentSourceName: String { selection.sourceName() }
    var currentVideoID: String { selection.sourceVideoID() }

    // MARK: - Load

    /// Opens the page; see `PlaybackSelectionController.open(autoplay:)`.
    ///
    /// 打开页面; 见 `PlaybackSelectionController.open(autoplay:)`.
    func open(autoplay: Bool) async {
        await selector.open(autoplay: autoplay)
    }

    /// See `PlaybackSelectionController.prepareResume()`.
    ///
    /// 见 `PlaybackSelectionController.prepareResume()`.
    func prepareResume() async {
        await selector.prepareResume()
    }

    /// See `PlaybackSelectionController.loadDetail(sourceKey:videoId:generation:)`.
    ///
    /// 见 `PlaybackSelectionController.loadDetail(sourceKey:videoId:generation:)`.
    func loadDetail(sourceKey: String, videoId: String, generation: Int? = nil) async -> Bool {
        await selector.loadDetail(sourceKey: sourceKey, videoId: videoId, generation: generation)
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
    private var localShowKey: String { normalizeSyncKey(selector.showTitle) }

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

    /// See `PlaybackSelectionController.preparePlaybackURL()`.
    ///
    /// 见 `PlaybackSelectionController.preparePlaybackURL()`.
    func preparePlaybackURL() async throws -> URL {
        try await selector.preparePlaybackURL()
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
        selector.follow(step, autoplay: true)
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
    func detachOutgoingItem() {
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

    /// Switches to another source; see `PlaybackSelectionController.selectSource(_:autoplay:)`.
    ///
    /// 切换到另一个视频源; 见 `PlaybackSelectionController.selectSource(_:autoplay:)`.
    @discardableResult
    func selectSource(_ sourceKey: String, autoplay: Bool) -> Task<Void, Never> {
        selector.selectSource(sourceKey, autoplay: autoplay)
    }

    /// `selectSource(_:autoplay:)`, awaiting the switch.
    ///
    /// 等待切换完成的 `selectSource(_:autoplay:)`.
    func switchSource(_ sourceKey: String, autoplay: Bool) async {
        await selectSource(sourceKey, autoplay: autoplay).value
    }

    func switchLine(_ index: Int) {
        selector.switchLine(index)
    }

    func switchEpisode(_ index: Int) {
        selector.switchEpisode(index)
    }

    func toggleFavorite() {
        selector.toggleFavorite()
    }

    // MARK: - Auto-fallback

    /// Handles failed playback by trying another CDN line first, then another source, and waits
    /// for a source switch it starts.
    ///
    /// 处理播放失败: 优先尝试下一条 CDN 线路, 再尝试下一个视频源, 并等待其发起的视频源切换完成.
    func handlePlaybackError() async {
        await selector.recoverFromFailure(autoplay: true)?.value
    }

    /// The downloaded copy failed: the manager deletes it only when its files are missing, and the
    /// same selection streams instead.
    ///
    /// 下载副本失败: 只有文件缺失时管理器才会删除该副本, 同一选择改为在线播放.
    func streamWithoutLocalCopy() {
        localEpisodes?.reportPlaybackFailure(showKey: localShowKey, sourceKey: currentSourceKey,
                                             videoId: currentVideoID, episodeIndex: currentEpisodeIndex)
        isPlayingLocalCopy = false
        skipLocalCopy = true
        startPlayback()
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
        selector.cancelSwitch()
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

extension PlayerViewModel: PlaybackSelectionHost {}
