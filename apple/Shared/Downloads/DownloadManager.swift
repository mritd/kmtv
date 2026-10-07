#if os(iOS)
import Foundation
import Observation
import os
import SwiftData
import SwiftUI

/// Owns downloads: the queue, background tasks, manifests, and the rows the UI reads. One instance
/// lives for the whole process, created before any view, so background relaunches deliver their
/// events to it. It is the observable façade over focused units: `DownloadLibrary` (row queries
/// and library merge rules), `DownloadTaskLedger` (which tasks it owns), `EpisodeRuntime` (per
/// episode cache), `DownloadCoverStore` (posters), and `LocalPlaybackHost` (the loopback server).
///
/// 管理下载: 队列, 后台任务, manifest 以及 UI 读取的数据行. 整个进程只有一个实例, 在任何视图之前创建,
/// 因此后台唤醒时的事件都会投递给它. 它是若干专注单元之上的可观察外观: `DownloadLibrary` (数据行查询与
/// 下载库合并规则), `DownloadTaskLedger` (持有哪些任务), `EpisodeRuntime` (每集缓存),
/// `DownloadCoverStore` (海报) 与 `LocalPlaybackHost` (loopback 服务).
@Observable
@MainActor
final class DownloadManager {
    /// UserDefaults key of the cellular setting, the free-space floor for queueing, retry delays per
    /// attempt, refreshes allowed without progress, and finished entries between manifest saves.
    ///
    /// 蜂窝数据设置的 UserDefaults 键, 加入队列所需的剩余空间下限, 每次重试的延迟, 无进展时允许的刷新
    /// 次数, 以及两次保存 manifest 之间完成的条目数.
    static let cellularKey = "kmtv.downloads.allowsCellular"
    static let freeSpaceFloor: Int64 = 1_000_000_000
    static let retryDelays: [TimeInterval] = [30, 120, 600]
    static let refreshLimit = 2
    static let saveEvery = 20
    /// Time a background wake may spend before it persists and completes; iOS allows about 30 s for
    /// background session events.
    ///
    /// 后台唤醒在持久化并结束之前可用的时间; iOS 为后台 session 事件提供约 30 秒.
    static let backgroundWakeBudget: Duration = .seconds(20)
    /// Shortest gap between two progress notifications; finished entries in between coalesce into
    /// one.
    ///
    /// 两次进度通知之间的最短间隔; 期间完成的条目会合并为一次通知.
    static let progressInterval: Duration = .milliseconds(500)

    /// On-disk layout of the downloads root.
    ///
    /// 下载根目录的磁盘布局.
    let layout: DownloadLayout
    /// Scope whose downloads the UI shows and the engine runs.
    ///
    /// UI 展示且引擎正在处理其下载的作用域.
    private(set) var activeScopeKey: String?
    /// Bumped on structural changes (rows added or removed, state transitions, scope, cover), so
    /// views re-read rows. A finished entry does not bump it; see `progressTick`.
    ///
    /// 在结构变化 (增删数据行, 状态切换, 作用域, 封面) 时递增, 视图据此重新读取数据行. 完成单个条目不会
    /// 使其递增; 参见 `progressTick`.
    private(set) var changeCount = 0
    /// Bumped at most once per `progressInterval` while entries finish, for views that show
    /// aggregate progress without observing every row.
    ///
    /// 条目完成期间, 每个 `progressInterval` 至多递增一次, 供展示汇总进度但不逐行观察的视图使用.
    private(set) var progressTick = 0
    /// Episodes downloading or queued in the active scope (the tab badge); recomputed on
    /// structural changes only.
    ///
    /// 当前作用域中正在下载或排队的集数 (tab 角标); 只在结构变化时重新计算.
    private(set) var activeEpisodeCount = 0
    /// Bytes of every download on the device, whatever its scope, cached so views never fetch rows
    /// while rendering. It changes with the rows (never by a full fetch per tick).
    ///
    /// 本机所有下载占用的字节数 (不分作用域); 缓存起来, 视图渲染时无需读取数据行. 它随数据行变化
    /// (不会每次进度通知都完整读取).
    private(set) var usedBytes: Int64 = 0
    /// The volume's free space, read off the main actor by `refreshFreeSpace()` and at enqueue;
    /// apart from `usedBytes` so its readers do not change with every progress tick.
    ///
    /// 磁盘卷的剩余空间, 由 `refreshFreeSpace()` 在主 actor 之外读取, 入队时也会读取; 与 `usedBytes`
    /// 分开, 读取它的视图因此不会随每次进度通知变化.
    private(set) var freeBytes: Int64 = 0
    /// The progress tick at which each show (by `showDir`) last had entries reach its rows, so
    /// readers of one show skip ticks that only moved other shows.
    ///
    /// 每部剧 (以 `showDir` 标识) 最近一次有条目写入数据行时的进度通知序号, 只关心某部剧的读取方
    /// 因此可以跳过只影响其他剧的通知.
    @ObservationIgnored private(set) var showProgressTicks: [String: Int] = [:]
    /// Episodes currently being prepared, by `episodeKey`.
    ///
    /// 正在准备的剧集, 以 `episodeKey` 标识.
    private(set) var preparingKeys: Set<String> = []
    /// Whether the scene is active or inactive; preparation runs only then or during a background wake.
    ///
    /// 场景是否处于 active 或 inactive; 只有此时或后台唤醒期间才会做准备.
    private(set) var isForeground = true
    /// Whether a preparer is set, mirrored from the unobserved preparer so `canDownload` updates
    /// views.
    ///
    /// 是否设置了准备器; 由不被观察的准备器同步而来, 使 `canDownload` 能够刷新视图.
    private(set) var hasPreparer = false
    /// Whether new tasks may use cellular data.
    ///
    /// 新任务是否可以使用蜂窝数据.
    private(set) var allowsCellular: Bool
    /// Network path monitor; nil means the path is assumed usable.
    ///
    /// 网络路径监视器; 为 nil 时视为网络可用.
    let network: DownloadNetworkMonitor?

    /// Dependencies and the units the façade delegates to.
    ///
    /// 依赖项, 以及外观所委托的各个单元.
    @ObservationIgnored private let context: ModelContext
    @ObservationIgnored private let transport: any DownloadTransport
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let freeSpace: @Sendable () -> Int64
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private let library: DownloadLibrary
    @ObservationIgnored private let covers: DownloadCoverStore
    @ObservationIgnored private let playback: LocalPlaybackHost
    @ObservationIgnored private var preparer: (any DownloadPreparing)? {
        didSet {
            let has = preparer != nil
            if hasPreparer != has { hasPreparer = has }
        }
    }
    /// Per-episode engine state by `episodeKey`; see `EpisodeRuntime`.
    ///
    /// 以 `episodeKey` 为键的每集引擎状态; 参见 `EpisodeRuntime`.
    @ObservationIgnored private var runtime: [String: EpisodeRuntime] = [:]
    /// Which transport tasks the engine owns; see `DownloadTaskLedger`.
    ///
    /// 引擎持有哪些传输任务; 参见 `DownloadTaskLedger`.
    @ObservationIgnored private var ledger: DownloadTaskLedger
    /// Writes manifests off the main actor; see `DownloadManifestWriter`.
    ///
    /// 在主 actor 之外写入 manifest; 参见 `DownloadManifestWriter`.
    @ObservationIgnored private let manifestWriter: DownloadManifestWriter
    @ObservationIgnored private var pumpTask: Task<Void, Never>?
    @ObservationIgnored private var pumpRequested = false
    @ObservationIgnored private var backgroundWake = false
    @ObservationIgnored private var wakeDeadline: ContinuousClock.Instant?
    @ObservationIgnored private let wakeBudget: Duration
    /// Removes deleted downloads off the main actor. Exposed for tests.
    ///
    /// 在主 actor 之外移除已删除的下载. 供测试使用.
    @ObservationIgnored let trash: DownloadTrash
    /// The latest scope transition (`activate`, `deactivate`, `openOffline`, `deleteScope`). Each
    /// new one waits for it, so transitions run one at a time in call order and an earlier one's
    /// tail never overwrites a later one.
    ///
    /// 最近一次作用域切换 (`activate`, `deactivate`, `openOffline`, `deleteScope`). 每次新的切换都会
    /// 等待它, 因此切换按调用顺序逐个执行, 较早切换的收尾不会覆盖较晚的切换.
    @ObservationIgnored private var lastTransition: Task<Void, Never>?
    /// Transitions queued or running; `openOffline` applies at once when there are none.
    ///
    /// 已排队或正在执行的切换数; 没有时 `openOffline` 立即生效.
    @ObservationIgnored private var pendingTransitions = 0
    @ObservationIgnored private let progressInterval: Duration
    /// Waits out one progress interval; tests replace it to fire ticks on demand.
    ///
    /// 等待一个进度间隔; 测试会替换它, 以便按需触发进度通知.
    @ObservationIgnored private let progressWait: @Sendable (Duration) async -> Void
    /// The pending progress notification; nil when none is scheduled, so nothing runs while no
    /// entry finishes. Exposed for tests.
    ///
    /// 待发出的进度通知; 未安排时为 nil, 因此没有条目完成时不会运行任何任务. 供测试使用.
    @ObservationIgnored private(set) var progressTask: Task<Void, Never>?
    @ObservationIgnored private let logger = Logger(subsystem: "com.mritd.kmtv", category: "downloads")

    /// Creates the manager and subscribes to transport events before any task can be enqueued.
    ///
    /// 创建管理器, 并在任何任务入队之前订阅传输事件.
    init(context: ModelContext, layout: DownloadLayout, transport: any DownloadTransport,
         defaults: UserDefaults = .standard,
         freeSpace: @escaping @Sendable () -> Int64 = DownloadManager.deviceFreeSpace,
         now: @escaping () -> Date = Date.init, outstandingLimit: Int = 3000,
         network: DownloadNetworkMonitor? = nil,
         coverFetcher: @escaping @Sendable (URL) async -> Data? = DownloadManager.fetchCoverData,
         backgroundWakeBudget: Duration = DownloadManager.backgroundWakeBudget,
         progressInterval: Duration = DownloadManager.progressInterval,
         progressWait: @escaping @Sendable (Duration) async -> Void = { try? await Task.sleep(for: $0) },
         manifestWriter: DownloadManifestWriter = DownloadManager.makeManifestWriter()) {
        self.context = context
        self.layout = layout
        self.transport = transport
        self.defaults = defaults
        self.freeSpace = freeSpace
        self.now = now
        self.allowsCellular = defaults.bool(forKey: Self.cellularKey)
        self.network = network
        let library = DownloadLibrary(context: context)
        self.library = library
        covers = DownloadCoverStore(layout: layout, library: library, fetcher: coverFetcher)
        playback = LocalPlaybackHost(root: layout.root)
        ledger = DownloadTaskLedger(limit: outstandingLimit)
        self.wakeBudget = backgroundWakeBudget
        self.progressInterval = progressInterval
        self.progressWait = progressWait
        self.manifestWriter = manifestWriter
        trash = DownloadTrash(layout: layout)
        trash.sweep()
        covers.onSaved = { [weak self] in
            self?.saveContext()
            self?.bump()
        }
        transport.onEvent = { [weak self] event in await self?.process(event) }
        network?.onRestore = { [weak self] in self?.schedulePump() }
        recomputeBytes()
    }

    /// The production manifest writer, which logs failed writes.
    ///
    /// 正式使用的 manifest 写入器, 会记录写入失败.
    nonisolated static func makeManifestWriter() -> DownloadManifestWriter {
        DownloadManifestWriter(onError: { error in
            Logger(subsystem: "com.mritd.kmtv", category: "downloads")
                .error("download manifest save failed: \(error.localizedDescription, privacy: .public)")
        })
    }

    /// Downloads cover image bytes; nil on any failure or non-200 response.
    ///
    /// 下载封面图片数据; 失败或响应非 200 时返回 nil.
    nonisolated static func fetchCoverData(from url: URL) async -> Data? {
        guard let (data, response) = try? await URLSession.shared.data(from: url),
              (response as? HTTPURLResponse)?.statusCode == 200, !data.isEmpty else { return nil }
        return data
    }

    /// Free space for important data on the app's volume.
    ///
    /// App 所在卷上可用于重要数据的剩余空间.
    nonisolated static func deviceFreeSpace() -> Int64 {
        let values = try? URL(fileURLWithPath: NSHomeDirectory())
            .resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        return values?.volumeAvailableCapacityForImportantUsage ?? .max
    }

    /// Whether downloads can be queued now (a signed-in scope with a preparer).
    ///
    /// 当前是否可以加入下载 (存在已登录的作用域与准备器).
    var canDownload: Bool { activeScopeKey != nil && hasPreparer }

    /// Whether an offline player is on screen; an automatic reconnect waits until it closes.
    ///
    /// 离线播放器是否正在显示; 自动重连会等到它关闭之后.
    var offlinePlaybackActive: Bool {
        get { playback.offlinePlaybackActive }
        set { playback.offlinePlaybackActive = newValue }
    }

    /// Tasks the engine created and has not seen an event for or cancelled. Exposed for tests.
    ///
    /// 引擎已创建, 尚未收到其事件也未取消的任务. 供测试使用.
    var inFlight: Set<DownloadTaskID> { ledger.inFlight }

    // MARK: - Library

    /// One show per show key across scopes, newest first; see `DownloadLibrary`.
    ///
    /// 跨作用域按剧集键每部剧一行, 最新的在前; 参见 `DownloadLibrary`.
    func libraryShows() -> [DownloadShow] {
        library.libraryShows(activeScopeKey: activeScopeKey)
    }

    /// The library row of one show.
    ///
    /// 某部剧在下载库中的数据行.
    func libraryShow(showKey: String) -> DownloadShow? {
        library.libraryShow(showKey: showKey, activeScopeKey: activeScopeKey)
    }

    /// One episode per (show, source, video, index) across scopes, optionally of one show; a
    /// completed copy wins, then the active scope's, then the newest.
    ///
    /// 跨作用域按 (剧集, 来源, 视频, 序号) 每集一行, 可限定某部剧; 已完成的副本优先, 其次是当前作用域的,
    /// 再次是最新的.
    func libraryEpisodes(showKey: String? = nil) -> [DownloadEpisode] {
        library.libraryEpisodes(showKey: showKey, activeScopeKey: activeScopeKey)
    }

    /// Whether any scope has a completed episode.
    ///
    /// 是否有任一作用域存在已完成的剧集.
    var hasCompletedDownloads: Bool { library.hasCompletedDownloads }

    /// Whether this device can pause, resume, or retry the episode: it belongs to the signed-in
    /// account.
    ///
    /// 本机能否暂停, 继续或重试该集: 它属于当前登录的账号.
    func canManage(_ ep: DownloadEpisode) -> Bool {
        ep.scopeKey == activeScopeKey && hasPreparer
    }

    /// Deletes every copy of an episode across scopes.
    ///
    /// 删除某一集在所有作用域中的副本.
    func deleteFromLibrary(_ ep: DownloadEpisode) async {
        for copy in library.copies(of: ep) { await delete(copy) }
    }

    /// Deletes every copy of a show across scopes.
    ///
    /// 删除某部剧在所有作用域中的副本.
    func deleteShowFromLibrary(showKey: String) async {
        for show in library.shows(showKey: showKey) { await deleteShow(show) }
    }

    /// Deletes every download on the device.
    ///
    /// 删除本机上的全部下载.
    func deleteAllDownloads() async {
        for scope in library.scopeKeys() { await deleteScope(scope) }
    }

    /// Deletes a scope's unfinished episodes that another account already downloaded, for example
    /// a copy paused at sign-out that a second account then finished. The library shows the
    /// completed copy, so the unfinished one would download unseen.
    ///
    /// 删除某个作用域中已被其他账号下载完成的未完成剧集, 例如登出时暂停, 随后被另一个账号下载完成的
    /// 副本. 下载库显示已完成的那份, 未完成的副本会在看不见的情况下继续下载.
    private func dropRedundantCopies(in scopeKey: String) async {
        let redundant = episodes(in: scopeKey).filter { ep in
            ep.state != .completed && completedCopy(showKey: ep.showKey, sourceKey: ep.sourceKey,
                                                    videoId: ep.videoId, episodeIndex: ep.episodeIndex) != nil
        }
        for ep in redundant { await delete(ep) }
    }

    // MARK: - Queries

    /// Shows of a scope, newest first.
    ///
    /// 某个作用域的剧集, 最新的在前.
    func shows(in scopeKey: String) -> [DownloadShow] { library.shows(in: scopeKey) }

    /// One show.
    ///
    /// 单部剧集.
    func show(scopeKey: String, showKey: String) -> DownloadShow? {
        library.show(scopeKey: scopeKey, showKey: showKey)
    }

    /// Episodes of a scope, optionally of one show, ordered by source then index.
    ///
    /// 某个作用域的剧集分集, 可限定某部剧, 按来源再按序号排序.
    func episodes(in scopeKey: String, showKey: String? = nil) -> [DownloadEpisode] {
        library.episodes(in: scopeKey, showKey: showKey)
    }

    /// One episode by identity.
    ///
    /// 按身份查找一集.
    func episode(scopeKey: String, sourceKey: String, videoId: String, episodeIndex: Int) -> DownloadEpisode? {
        library.episode(scopeKey: scopeKey, sourceKey: sourceKey, videoId: videoId, episodeIndex: episodeIndex)
    }

    /// A completed copy of the episode in any scope, the active scope's first; see
    /// `DownloadLibrary.completedCopy`.
    ///
    /// 任一作用域中该集的已完成副本, 优先当前作用域; 参见 `DownloadLibrary.completedCopy`.
    func completedCopy(showKey: String, sourceKey: String, videoId: String, episodeIndex: Int) -> DownloadEpisode? {
        library.completedCopy(showKey: showKey, sourceKey: sourceKey, videoId: videoId, episodeIndex: episodeIndex,
                              activeScopeKey: activeScopeKey)
    }

    /// Local poster file of a show, if downloaded.
    ///
    /// 剧集的本地海报文件 (如已下载).
    func coverFileURL(for show: DownloadShow) -> URL? { covers.coverFileURL(for: show) }

    /// Display state of an episode under the current network path.
    ///
    /// 当前网络路径下一集的展示状态.
    func displayState(of ep: DownloadEpisode) -> DownloadDisplayState {
        Self.displayState(state: ep.state, pauseReason: ep.pauseReason, failure: ep.failure, done: ep.doneEntries,
                          total: ep.totalEntries, preparing: preparingKeys.contains(ep.episodeKey),
                          satisfied: network?.isSatisfied ?? true, expensive: network?.isExpensive ?? false,
                          constrained: network?.isConstrained ?? false, allowsCellular: allowsCellular)
    }

    /// The current `DownloadDisplayRevision`; reading it observes structure, throttled progress,
    /// the network path, and the cellular setting, but no row.
    ///
    /// 当前的 `DownloadDisplayRevision`; 读取它会观察结构, 节流后的进度, 网络路径与蜂窝数据设置,
    /// 但不观察任何数据行.
    var displayRevision: DownloadDisplayRevision {
        DownloadDisplayRevision(structure: changeCount, progress: progressTick, satisfied: network?.isSatisfied ?? true,
                                expensive: network?.isExpensive ?? false, constrained: network?.isConstrained ?? false,
                                allowsCellular: allowsCellular, preparing: preparingKeys)
    }

    // MARK: - Scope

    /// Makes `scopeKey` the signed-in scope: pauses the previous one, resumes this scope's episodes
    /// paused by sign-out, reconciles tasks, and pumps.
    ///
    /// 将 `scopeKey` 设为已登录的作用域: 暂停前一个作用域, 恢复本作用域中因登出而暂停的剧集, 对账任务
    /// 并推进队列.
    func activate(scopeKey: String, preparer: any DownloadPreparing) async {
        await enqueueTransition { await self.applyActivate(scopeKey: scopeKey, preparer: preparer) }.value
    }

    private func applyActivate(scopeKey: String, preparer: any DownloadPreparing) async {
        if let previous = activeScopeKey, previous != scopeKey {
            await pauseScope(previous, reason: .signedOut)
        }
        if activeScopeKey != scopeKey { activeScopeKey = scopeKey }
        self.preparer = preparer
        for ep in episodes(in: scopeKey) where ep.state == .paused && ep.pauseReason == .signedOut {
            ep.state = .queued
            ep.pauseReason = nil
        }
        saveContext()
        bump()
        await dropRedundantCopies(in: scopeKey)
        await reconcile()
        schedulePump()
        covers.retryMissingCovers(scopeKey: scopeKey, isActive: { [weak self] in self?.activeScopeKey == $0 })
    }

    /// Shows a scope offline: rows and playback only, no preparation. Applies at once unless
    /// another transition is queued or running; then it runs after them.
    ///
    /// 以离线方式展示某个作用域: 只读数据与播放, 不做准备. 没有其他切换排队或执行时立即生效; 否则在
    /// 它们之后执行.
    func openOffline(scopeKey: String) {
        guard pendingTransitions > 0 else {
            applyOffline(scopeKey: scopeKey)
            return
        }
        _ = enqueueTransition { self.applyOffline(scopeKey: scopeKey) }
    }

    private func applyOffline(scopeKey: String) {
        if activeScopeKey != scopeKey { activeScopeKey = scopeKey }
        preparer = nil
        bump()
    }

    /// Signs the active scope out: its queued and downloading episodes pause with `.signedOut`.
    ///
    /// 让当前作用域登出: 其中排队与下载中的剧集以 `.signedOut` 暂停.
    func deactivate() async {
        await beginDeactivate().value
    }

    /// Queues `deactivate` now and returns its task, so a caller that does not wait still holds its
    /// place: a transition requested later always runs after it.
    ///
    /// 立即将 `deactivate` 排入队列并返回其任务, 因此不等待的调用方也能占住顺序: 之后请求的切换总在它之后执行.
    @discardableResult
    func beginDeactivate() -> Task<Void, Never> {
        enqueueTransition { await self.applyDeactivate() }
    }

    private func applyDeactivate() async {
        guard let scope = activeScopeKey else { return }
        preparer = nil
        await pauseScope(scope, reason: .signedOut)
        activeScopeKey = nil
        bump()
    }

    /// Queues a scope transition behind every earlier one and returns its task; callers that
    /// return after it completes await the task.
    ///
    /// 将一次作用域切换排在所有之前的切换之后, 并返回其任务; 需要在其完成后才返回的调用方会等待该任务.
    private func enqueueTransition(_ body: @escaping @MainActor () async -> Void) -> Task<Void, Never> {
        let previous = lastTransition
        pendingTransitions += 1
        let task = Task { @MainActor in
            await previous?.value
            await body()
            self.pendingTransitions -= 1
        }
        lastTransition = task
        return task
    }

    private func pauseScope(_ scopeKey: String, reason: DownloadPauseReason) async {
        let hash = DownloadPaths.scopeHash(scopeKey)
        var generations: [String: Int] = [:]
        for ep in episodes(in: scopeKey) {
            generations[ep.episodeKey] = runtime[ep.episodeKey]?.manifest?.generation
            guard ep.state == .queued || ep.state == .downloading else { continue }
            ep.state = .paused
            ep.pauseReason = reason
            flushProgress(of: ep)
            if let manifest = runtime[ep.episodeKey]?.manifest { saveManifest(manifest, for: ep) }
        }
        saveContext()
        bump()
        await manifestWriter.flushAll()
        // Tasks of a newer generation come from a resume during the await; they must survive.
        //
        // 更新一代的任务来自等待期间的继续操作; 它们必须保留.
        let bound = generations
        await cancelTasks { $0.scopeHash == hash && $0.generation <= bound[$0.episodeKey] ?? .max }
    }

    // MARK: - Commands

    /// Queues episodes not already downloaded; returns how many were added.
    ///
    /// 将尚未下载的剧集加入队列; 返回新增的数量.
    @discardableResult
    func enqueue(show info: DownloadShowInfo, episodes requests: [DownloadEpisodeRequest]) throws -> Int {
        guard let scopeKey = activeScopeKey, preparer != nil else { throw DownloadEnqueueError.notSignedIn }
        let free = freeSpace()
        if freeBytes != free { freeBytes = free }
        guard free >= Self.freeSpaceFloor else { throw DownloadEnqueueError.notEnoughSpace }
        let showKey = normalizeSyncKey(info.title)
        let show: DownloadShow
        if let existing = self.show(scopeKey: scopeKey, showKey: showKey) {
            show = existing
        } else {
            show = DownloadShow(scopeKey: scopeKey, title: info.title, cover: info.cover, type: info.type,
                                year: info.year, createdAt: now())
            context.insert(show)
        }
        var order = (episodes(in: scopeKey).map(\.queueOrder).max() ?? 0) + 1
        var added = 0
        for request in requests {
            // Downloads are local first: an episode another account already downloaded plays from
            // that copy, so it is not downloaded twice.
            //
            // 下载是本地优先的: 其他账号已下载的剧集会播放那份副本, 因此不会重复下载.
            if completedCopy(showKey: showKey, sourceKey: request.sourceKey, videoId: request.videoId,
                             episodeIndex: request.episodeIndex) != nil { continue }
            if let existing = episode(scopeKey: scopeKey, sourceKey: request.sourceKey, videoId: request.videoId,
                                      episodeIndex: request.episodeIndex) {
                // Picking a failed or paused episode again retries or resumes it.
                //
                // 再次选择失败或已暂停的剧集会重试或继续它.
                if existing.state == .failed {
                    retry(existing)
                    added += 1
                } else if existing.state == .paused {
                    resume(existing)
                    added += 1
                }
                continue
            }
            context.insert(DownloadEpisode(show: show, sourceKey: request.sourceKey, sourceName: request.sourceName,
                                           videoId: request.videoId, episodeIndex: request.episodeIndex,
                                           episodeName: request.episodeName, lineIndex: request.lineIndex,
                                           episodeCount: request.episodeCount, episodeURL: request.episodeURL,
                                           queueOrder: order, createdAt: now()))
            order += 1
            added += 1
        }
        saveContext()
        bump()
        // A show without a saved poster takes the latest cover, so enqueueing again with a cover
        // that loads replaces one that failed.
        //
        // 尚未保存海报的剧集采用最新的封面, 因此再次加入下载时, 可加载的封面会替换此前失败的封面.
        if show.coverFile.isEmpty, let coverURL = info.coverURL {
            if show.coverURLString != coverURL.absoluteString {
                show.coverURLString = coverURL.absoluteString
                show.cover = info.cover
                saveContext()
            }
            Task { await covers.fetchCover(scopeKey: scopeKey, showKey: showKey, from: coverURL) }
        }
        schedulePump()
        return added
    }

    /// Pauses an episode by the user.
    ///
    /// 由用户暂停一集.
    func pause(_ ep: DownloadEpisode) async {
        guard ep.state == .queued || ep.state == .downloading else { return }
        ep.state = .paused
        ep.pauseReason = .user
        flushProgress(of: ep)
        let generation = currentGeneration(of: ep)
        if let manifest = runtime[ep.episodeKey]?.manifest { saveManifest(manifest, for: ep) }
        saveContext()
        bump()
        await manifestWriter.flush(ep.episodeKey)
        await cancelTasks(of: ep, upTo: generation)
        schedulePump()
    }

    /// Resumes a paused episode.
    ///
    /// 继续一集已暂停的剧集.
    func resume(_ ep: DownloadEpisode) {
        guard ep.state == .paused else { return }
        ep.state = .queued
        ep.pauseReason = nil
        saveContext()
        bump()
        schedulePump()
    }

    /// Retries a failed episode, keeping finished entries.
    ///
    /// 重试一集失败的剧集, 保留已完成的条目.
    func retry(_ ep: DownloadEpisode) {
        guard ep.state == .failed else { return }
        if var manifest = manifest(for: ep) {
            for index in manifest.entries.indices where !manifest.entries[index].done {
                manifest.entries[index].attempts = 0
            }
            saveManifest(manifest, for: ep)
        }
        ep.failure = nil
        ep.refreshCount = 0
        ep.state = .queued
        saveContext()
        bump()
        schedulePump()
    }

    /// Pauses every queued or downloading episode of the active scope.
    ///
    /// 暂停当前作用域中所有排队或下载中的剧集.
    func pauseAll(reason: DownloadPauseReason = .user) async {
        guard let scope = activeScopeKey else { return }
        await pauseScope(scope, reason: reason)
    }

    /// Resumes every paused episode of the active scope.
    ///
    /// 继续当前作用域中所有已暂停的剧集.
    func resumeAll() {
        guard let scope = activeScopeKey, preparer != nil else { return }
        for ep in episodes(in: scope) where ep.state == .paused {
            ep.state = .queued
            ep.pauseReason = nil
        }
        saveContext()
        bump()
        schedulePump()
    }

    /// Deletes an episode and, when it was the last one, its show.
    ///
    /// 删除一集; 若是最后一集, 一并删除所属剧集.
    func delete(_ ep: DownloadEpisode) async {
        guard isLive(ep) else { return }
        let key = ep.episodeKey
        let scopeKey = ep.scopeKey
        let showKey = ep.showKey
        ep.state = .paused
        // Drop the cached manifest before any await, so a persist meanwhile cannot queue it again.
        //
        // 在任何 await 之前丢弃缓存的 manifest, 使期间的持久化无法再次排入它.
        forget(key, cancelWrite: true)
        await cancelTasks { $0.episodeKey == key }
        // A late manifest write must not recreate the directory after it is removed.
        //
        // 迟到的 manifest 写入不能在目录删除后重新创建它.
        await manifestWriter.discard { $0 == key }
        // A concurrent `deleteShow` or `deleteScope` may have deleted the row during the awaits.
        //
        // 等待期间, 并发的 `deleteShow` 或 `deleteScope` 可能已删除该行.
        guard isLive(ep) else { return }
        removeEpisodeFiles(ep)
        setBytes(ep, 0)
        context.delete(ep)
        saveContext()
        if episodes(in: scopeKey, showKey: showKey).isEmpty, let show = show(scopeKey: scopeKey, showKey: showKey) {
            trash.discard(layout.showDir(scopeHash: show.scopeHash, showDir: show.showDir))
            context.delete(show)
            saveContext()
        }
        bump()
        schedulePump()
    }

    /// Deletes every episode of a show.
    ///
    /// 删除某部剧的所有剧集.
    func deleteShow(_ show: DownloadShow) async {
        for ep in episodes(in: show.scopeKey, showKey: show.showKey) { await delete(ep) }
    }

    /// Deletes every download of a scope; a scope transition, so it runs after earlier ones.
    ///
    /// 删除某个作用域的所有下载; 属于作用域切换, 因此在之前的切换之后执行.
    func deleteScope(_ scopeKey: String) async {
        await enqueueTransition { await self.applyDeleteScope(scopeKey) }.value
    }

    private func applyDeleteScope(_ scopeKey: String) async {
        let hash = DownloadPaths.scopeHash(scopeKey)
        for ep in episodes(in: scopeKey) {
            ep.state = .paused
            forget(ep.episodeKey, cancelWrite: true)
        }
        await cancelTasks { $0.scopeHash == hash }
        await manifestWriter.discard { EpisodeKey.path($0, isInScope: hash) }
        for ep in episodes(in: scopeKey) {
            // Again after the awaits, without touching the writer, which `discard` just emptied.
            //
            // 在等待之后再遗忘一次, 不触及写入器, 因为 `discard` 刚刚清空了它.
            forget(ep.episodeKey, cancelWrite: false)
            setBytes(ep, 0)
            context.delete(ep)
        }
        for show in shows(in: scopeKey) { context.delete(show) }
        trash.discard(layout.scopeDir(hash))
        saveContext()
        bump()
    }

    /// Marks a completed episode whose files failed to play as damaged and removes its files, so a
    /// retry downloads it again.
    ///
    /// 将播放失败的已完成剧集标记为已损坏并删除其文件, 重试时会重新下载.
    func markDamaged(_ ep: DownloadEpisode) {
        removeEpisodeFiles(ep)
        ep.state = .failed
        ep.failure = .damaged
        ep.doneEntries = 0
        setBytes(ep, 0)
        saveContext()
        bump()
    }

    /// Whether a completed episode's playlist, manifest, and every entry file are on disk. A
    /// playback failure with intact files is a server or player problem, never damage.
    ///
    /// 已完成剧集的 playlist, manifest 与所有条目文件是否都在磁盘上. 文件完好时的播放失败属于服务
    /// 或播放器问题, 不算损坏.
    func filesIntact(_ ep: DownloadEpisode) -> Bool {
        let dir = layout.episodeDir(ep.key)
        guard FileManager.default.fileExists(atPath: layout.playlistURL(episodeDir: dir).path),
              let manifest = DownloadManifest.load(from: layout.manifestURL(episodeDir: dir)) else { return false }
        return manifest.entries.allSatisfy { FileManager.default.fileExists(atPath: dir.appending(path: $0.fileName).path) }
    }

    /// Stores the local watch position of an episode.
    ///
    /// 保存某一集的本地观看位置.
    func recordWatch(_ ep: DownloadEpisode, positionSec: Double, finished: Bool) {
        ep.positionSec = positionSec
        ep.finished = finished
        // Not structural: rows that show the watch position observe the episode itself.
        //
        // 不属于结构变化: 展示观看位置的数据行直接观察该剧集.
        saveContext()
    }

    /// Changes the cellular setting and re-enqueues in-flight tasks with the new policy.
    ///
    /// 修改蜂窝数据设置, 并按新策略重新提交进行中的任务.
    func setAllowsCellular(_ value: Bool) async {
        guard value != allowsCellular else { return }
        allowsCellular = value
        defaults.set(value, forKey: Self.cellularKey)
        guard let scope = activeScopeKey else { return }
        let hash = DownloadPaths.scopeHash(scope)
        // Only tasks created under the old policy; they stay claimed during the cancel, and the
        // pump afterwards re-creates them under the new one.
        //
        // 只取消按旧策略创建的任务; 取消期间它们保持占用, 之后的队列推进会按新策略重建它们.
        await cancel(ledger.inFlight.filter { $0.scopeHash == hash })
        schedulePump()
    }

    // MARK: - Playback

    /// Loopback URL of a completed episode; see `LocalPlaybackHost`.
    ///
    /// 已完成剧集的 loopback URL; 参见 `LocalPlaybackHost`.
    func localPlaybackURL(for ep: DownloadEpisode) async throws -> URL {
        try await playback.playbackURL(for: ep.key)
    }

    // MARK: - Lifecycle

    /// Tracks the scene phase. Tasks created while the app is in the background are discretionary,
    /// so `.inactive` (on the way out and on the way back) pumps while still in the foreground.
    ///
    /// 跟踪场景状态. App 在后台时创建的任务会被系统视为 discretionary, 因此 `.inactive` (离开前与返回时)
    /// 仍在前台时就推进队列.
    func handleScenePhase(_ phase: ScenePhase) async {
        switch phase {
        case .active, .inactive:
            let returning = !isForeground
            isForeground = true
            if returning {
                await playback.enterForeground()
                await reconcile()
            }
            schedulePump()
        case .background:
            isForeground = false
            playback.enterBackground()
            await persistAll()
        @unknown default:
            break
        }
    }

    /// Handles a background relaunch for session events: waits for them, reconciles, pumps once,
    /// and persists. The pump prepares no new episode after the wake budget runs out, and the wake
    /// stops waiting for it then, so it persists before iOS suspends the app; episodes still queued
    /// continue on the next foreground or wake pump.
    ///
    /// 处理因 session 事件触发的后台唤醒: 等待事件投递完毕, 对账, 推进一次队列并持久化. 唤醒预算用完后,
    /// 队列推进不再准备新的剧集, 唤醒流程也不再等待它, 从而在 iOS 挂起 App 之前完成持久化; 仍在队列中的
    /// 剧集由下一次前台或唤醒推进继续处理.
    func handleBackgroundWake() async {
        let deadline = ContinuousClock.now.advanced(by: wakeBudget)
        await transport.waitForBackgroundEvents()
        await transport.drainEvents()
        await reconcile()
        backgroundWake = true
        wakeDeadline = deadline
        schedulePump()
        await waitForIdle(until: deadline)
        backgroundWake = false
        wakeDeadline = nil
        await persistAll()
    }

    /// Rebuilds the in-flight set from the transport: keeps current-generation tasks for missing
    /// entries of downloading episodes and cancels the rest (see `DownloadTaskLedger.mergeReconcile`).
    ///
    /// 依据传输层重建进行中的任务集合: 保留下载中剧集缺失条目的当前代任务, 取消其余任务
    /// (参见 `DownloadTaskLedger.mergeReconcile`).
    func reconcile() async {
        // Events of tasks that already finished are no longer in `outstanding()`; apply them first,
        // or their entries would be enqueued again.
        //
        // 已完成任务的事件不再出现在 `outstanding()` 中; 必须先处理这些事件, 否则对应条目会被重复提交.
        await transport.drainEvents()
        await preloadManifests(of: library.downloadingEpisodes())
        let token = ledger.beginReconcile()
        let outstanding = await transport.outstanding()
        let stale = ledger.mergeReconcile(token, outstanding: outstanding) { self.isCurrentTask($0) }
        await cancel(stale)
    }

    /// Whether a transport task belongs to a downloading episode's current manifest and its entry
    /// is still missing.
    ///
    /// 传输任务是否属于下载中剧集的当前 manifest, 且其条目仍然缺失.
    private func isCurrentTask(_ id: DownloadTaskID) -> Bool {
        guard let ep = library.episode(forKey: id.episodeKey), ep.state == .downloading,
              let manifest = manifest(for: ep) else { return false }
        return manifest.generation == id.generation && manifest.entries.indices.contains(id.entryIndex)
            && !manifest.entries[id.entryIndex].done
    }

    /// Returns when no pump is running.
    ///
    /// 没有正在运行的队列推进时返回.
    func waitForIdle() async {
        while let task = pumpTask { await task.value }
    }

    /// Returns when no pump is running or the deadline passes, whichever comes first. A prepare in
    /// flight at the deadline keeps running; it does not hold up the caller.
    ///
    /// 没有正在运行的队列推进或到达截止时间时返回, 以先到者为准. 截止时仍在进行的准备会继续执行, 但不会
    /// 阻塞调用方.
    private func waitForIdle(until deadline: ContinuousClock.Instant) async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            let resumer = ResumeOnce(continuation)
            let timer = Task {
                try? await Task.sleep(until: deadline, clock: .continuous)
                resumer.resume()
            }
            Task {
                await self.waitForIdle()
                timer.cancel()
                resumer.resume()
            }
        }
    }

    /// Writes cached manifests and pending row changes, and returns once the manifests are on disk.
    ///
    /// 写入缓存的 manifest 与待保存的数据行变化, 并在 manifest 落盘后返回.
    func persistAll() async {
        flushAllProgress()
        for (key, entry) in runtime {
            guard let manifest = entry.manifest, let episode = EpisodeKey(relativePath: key) else { continue }
            manifestWriter.submit(manifest, to: layout.manifestURL(episodeDir: layout.episodeDir(episode)), key: key)
        }
        for key in Array(runtime.keys) {
            runtime[key]?.unsaved = 0
            runtime.prune(key)
        }
        saveContext()
        await manifestWriter.flushAll()
    }

    // MARK: - Pump

    private func schedulePump() {
        pumpRequested = true
        guard pumpTask == nil else { return }
        pumpTask = Task { [weak self] in
            while let self, self.pumpRequested {
                self.pumpRequested = false
                await self.pumpOnce()
            }
            self?.pumpTask = nil
        }
    }

    private func pumpOnce() async {
        guard isForeground || backgroundWake, let scopeKey = activeScopeKey, let preparer else { return }
        let candidates = episodes(in: scopeKey)
            .filter { $0.state == .queued || $0.state == .downloading }
            .sorted { $0.queueOrder < $1.queueOrder }
        await preloadManifests(of: candidates)
        guard self.preparer != nil else { return }
        for (position, ep) in candidates.enumerated() {
            guard activeScopeKey == scopeKey else { return }
            guard ledger.hasRoom() else {
                ledger.markStarved()
                return
            }
            // The app may have gone to the background, or a row may have been deleted, while the
            // previous episode was preparing.
            //
            // 上一集准备期间, App 可能已进入后台, 或某行可能已被删除.
            guard isForeground || backgroundWake else { return }
            guard isLive(ep) else { continue }
            let priority: Float = position < 2 ? URLSessionTask.highPriority : URLSessionTask.defaultPriority
            if ep.state == .downloading {
                if let manifest = manifest(for: ep) {
                    // A complete manifest on a downloading row means the app stopped between writing
                    // the manifest and saving the row in `complete`; finish it now.
                    //
                    // 下载中的行对应一个已完成的 manifest, 说明 App 在 `complete` 写入 manifest 之后,
                    // 保存数据行之前停止了; 此处补完.
                    if manifest.isComplete {
                        await complete(ep, manifest)
                    } else {
                        enqueueMissing(ep, manifest, priority: priority)
                    }
                    continue
                }
                ep.state = .queued
            }
            guard ep.state == .queued, mayPrepare else { continue }
            let key = ep.episodeKey
            await prepare(ep, with: preparer, priority: priority)
            if self.preparer == nil || activeScopeKey != scopeKey { return }
            if let current = library.episode(forKey: key), current.pauseReason == .signedOut { return }
        }
    }

    /// Whether the pump may start preparing an episode: in the foreground, or during a background
    /// wake before its deadline.
    ///
    /// 队列推进是否可以开始准备剧集: 处于前台, 或处于后台唤醒且尚未到达截止时间.
    private var mayPrepare: Bool {
        if isForeground { return true }
        guard backgroundWake, let wakeDeadline else { return false }
        return ContinuousClock.now < wakeDeadline
    }

    private func prepare(_ ep: DownloadEpisode, with preparer: any DownloadPreparing, priority: Float) async {
        let key = ep.episodeKey
        let generation = (manifest(for: ep)?.generation ?? 0) + 1
        // No structural bump: rows and the picker observe `preparingKeys` directly.
        //
        // 不做结构递增: 数据行与选集面板直接观察 `preparingKeys`.
        preparingKeys.insert(key)
        let result: Result<DownloadManifest, Error>
        do {
            result = .success(try await preparer.prepare(episodeURL: ep.episodeURL, sourceKey: ep.sourceKey,
                                                         generation: generation))
        } catch {
            result = .failure(error)
        }
        preparingKeys.remove(key)
        guard let current = library.episode(forKey: key), current.state == .queued else { return }
        switch result {
        case .success(let fresh):
            var next = fresh
            // Read after the await: a delete and re-queue meanwhile removed the old files.
            //
            // 在 await 之后读取: 期间若被删除并重新加入队列, 旧文件已被移除.
            if let existing = manifest(for: current) {
                if let remapped = existing.remapping(onto: fresh) {
                    next = remapped
                    let layout = remapped.lines == fresh.lines ? "fresh" : "saved"
                    logger.info("download resume remaps manifest episode=\(key, privacy: .public) done=\(existing.doneCount, privacy: .public)/\(existing.entries.count, privacy: .public) layout=\(layout, privacy: .public)")
                } else if !(existing.hasUpstreamIdentities && fresh.hasUpstreamIdentities), existing.matches(fresh) {
                    // Direct URLs can change on every fetch (signed CDNs), so files that line up by
                    // index and duration are kept. Proxied identities are reliable: when they differ,
                    // the files differ, even if the durations match.
                    //
                    // 直连 URL 每次获取都可能变化 (带签名的 CDN), 因此按序号与时长对得上的文件会被保留.
                    // 代理身份是可靠的: 身份不同即文件不同, 即使时长一致.
                    next = existing.adopting(urlsFrom: fresh)
                    logger.info("download resume adopts manifest episode=\(key, privacy: .public) done=\(existing.doneCount, privacy: .public)/\(existing.entries.count, privacy: .public)")
                } else {
                    // The summary holds only counts, kinds, and durations, so it is safe in public.
                    //
                    // 摘要只包含数量, 类型与时长, 因此可以公开记录.
                    logger.notice("download playlist changed, restarting episode=\(key, privacy: .public) done=\(existing.doneCount, privacy: .public) \(existing.mismatchSummary(fresh), privacy: .public)")
                    forget(key, cancelWrite: true)
                    await manifestWriter.discard { $0 == key }
                    guard isLive(current), current.state == .queued else { return }
                    removeEpisodeFiles(current)
                }
            } else if current.doneEntries > 0 {
                logger.notice("download manifest missing, starting over episode=\(key, privacy: .public) rowDone=\(current.doneEntries, privacy: .public)/\(current.totalEntries, privacy: .public)")
            }
            // The writer never creates directories (a late write must not bring a deleted episode
            // back), so the first save creates it here.
            //
            // 写入器从不创建目录 (迟到的写入不能让已删除的剧集重新出现), 因此首次保存时在此创建.
            try? FileManager.default.createDirectory(at: layout.episodeDir(current.key),
                                                     withIntermediateDirectories: true)
            saveManifest(next, for: current)
            runtime[key]?.progressPending = false
            current.totalEntries = next.entries.count
            current.doneEntries = next.doneCount
            setBytes(current, next.totalBytes)
            current.state = .downloading
            saveContext()
            bump()
            // When the app went to the background during the prepare, tasks created now would be
            // discretionary; the next foreground pump enqueues them from the saved manifest.
            //
            // 若 App 在准备期间已进入后台, 此时创建的任务会被视为 discretionary; 由下一次前台推进依据
            // 已保存的 manifest 提交.
            if next.isComplete {
                await complete(current, next)
            } else if isForeground || backgroundWake {
                enqueueMissing(current, next, priority: priority)
            }
        case .failure(let error):
            switch error as? DownloadPrepareError {
            case .format(let parse):
                await fail(current, parse == .separateAudio ? .separateAudio : .unsupportedFormat)
            case .status(let status):
                await fail(current, .sourceStatus(status))
            case .signedOut:
                await pauseScope(current.scopeKey, reason: .signedOut)
            case .network, nil:
                break
            }
        }
    }

    private func enqueueMissing(_ ep: DownloadEpisode, _ manifest: DownloadManifest, priority: Float) {
        guard !preparingKeys.contains(ep.episodeKey) else { return }
        let room = ledger.room
        guard room > 0 else {
            ledger.markStarved()
            return
        }
        var requests: [DownloadTaskRequest] = []
        for entry in manifest.entries where !entry.done {
            let id = taskID(ep, generation: manifest.generation, entry: entry.index)
            guard !ledger.isClaimed(id) else { continue }
            if requests.count >= room {
                ledger.markStarved()
                break
            }
            requests.append(DownloadTaskRequest(id: id, url: entry.remoteURL, earliestBegin: nil, priority: priority,
                                                allowsCellular: allowsCellular))
        }
        guard !requests.isEmpty else { return }
        transport.enqueue(requests)
        ledger.claim(requests.map(\.id))
    }

    /// Pumps again when a starved queue has `refillBatch` free slots.
    ///
    /// 受限队列有 `refillBatch` 个空位时再次推进.
    private func pumpIfRoomOpened() {
        guard ledger.takeRefill() else { return }
        schedulePump()
    }

    // MARK: - Events

    /// Handles one transport event; the transport delivers them one at a time.
    ///
    /// 处理一个传输事件; 传输层逐个投递事件.
    func process(_ event: DownloadTransportEvent) async {
        switch event {
        case .finished(let id, let info):
            ledger.release(id)
            await handleFinished(id, info)
        case .failed(let id, let code):
            ledger.release(id)
            if let outcome = DownloadEntryValidator.classify(transportError: URLError(code)) {
                await apply(outcome, to: id)
            }
        case .storageFull(let id):
            ledger.release(id)
            await pauseAll(reason: .noSpace)
        }
        pumpIfRoomOpened()
    }

    /// The row, entry, and ciphertext flag of a finished task, or nil when the task is stale. It
    /// returns no manifest, so the caller holds no second reference and can mark the cached one
    /// done in place instead of copying every entry of a long episode.
    ///
    /// 已完成任务对应的数据行, 条目与密文标记; 任务已过期时返回 nil. 它不返回 manifest, 因此调用方不持有
    /// 第二个引用, 可以就地标记缓存中的 manifest, 而不必复制长剧集的每个条目.
    private func finishedEntry(_ id: DownloadTaskID) -> (DownloadEpisode, DownloadManifest.Entry, Bool)? {
        guard let ep = library.episode(forKey: id.episodeKey), ep.state == .downloading,
              let manifest = manifest(for: ep), manifest.generation == id.generation,
              manifest.entries.indices.contains(id.entryIndex), !manifest.entries[id.entryIndex].done else {
            return nil
        }
        let encrypted = runtime[ep.episodeKey, default: EpisodeRuntime()].facts(for: manifest).encrypted
            .contains(id.entryIndex)
        return (ep, manifest.entries[id.entryIndex], encrypted)
    }

    private func handleFinished(_ id: DownloadTaskID, _ info: DownloadResponseInfo) async {
        guard let (ep, entry, encrypted) = finishedEntry(id) else {
            try? FileManager.default.removeItem(at: info.file)
            return
        }
        let key = ep.episodeKey
        let outcome = DownloadEntryValidator.classify(url: info.url, status: info.status, contentType: info.contentType,
                                                      head: info.head, size: info.size, kind: entry.kind,
                                                      encrypted: encrypted)
        guard outcome == .accept else {
            try? FileManager.default.removeItem(at: info.file)
            await apply(outcome, to: id)
            return
        }
        let destination = layout.episodeDir(id).appending(path: entry.fileName)
        do {
            try? FileManager.default.removeItem(at: destination)
            try FileManager.default.moveItem(at: info.file, to: destination)
        } catch {
            if DownloadSessionDelegate.isOutOfSpace(error) {
                await pauseAll(reason: .noSpace)
            } else {
                await apply(.retry(.invalidContent), to: id)
            }
            return
        }
        runtime[key]?.manifest?.entries[id.entryIndex].done = true
        runtime[key]?.manifest?.entries[id.entryIndex].bytes = info.size
        guard let manifest = runtime[key]?.manifest else { return }
        // The row catches up on the progress tick (or the next state transition), not per entry.
        //
        // 数据行在进度通知 (或下一次状态切换) 时同步, 而不是每个条目同步一次.
        runtime[key]?.progressPending = true
        if ep.refreshCount != 0 { ep.refreshCount = 0 }
        scheduleProgress()
        runtime[key]?.facts?.remaining -= 1
        if (runtime[key]?.facts?.remaining ?? 0) <= 0 {
            // Recheck the count against the manifest; a mismatch resets it.
            //
            // 对照 manifest 重新核实计数; 不一致时重置计数.
            let missing = manifest.missingCount
            runtime[key]?.facts?.remaining = missing
            if missing == 0 {
                await complete(ep, manifest)
                schedulePump()
                return
            }
        }
        let pending = (runtime[key]?.unsaved ?? 0) + 1
        // Long episodes save less often: every save encodes the whole manifest.
        //
        // 长剧集降低保存频率: 每次保存都要编码整个 manifest.
        if pending >= max(Self.saveEvery, manifest.entries.count / 50) {
            saveManifest(manifest, for: ep)
            flushProgress(of: ep)
            // Keep the episode pending, so the tick still records its show for badge readers.
            //
            // 让该集保持待同步, 进度通知因此仍会为选集角标记录其所属剧集.
            runtime[key]?.progressPending = true
            saveContext()
        } else {
            runtime[key]?.unsaved = pending
        }
    }

    private func apply(_ outcome: EntryOutcome, to id: DownloadTaskID) async {
        guard let ep = library.episode(forKey: id.episodeKey), ep.state == .downloading,
              var manifest = manifest(for: ep), manifest.generation == id.generation,
              manifest.entries.indices.contains(id.entryIndex), !manifest.entries[id.entryIndex].done else { return }
        switch outcome {
        case .accept:
            return
        case .tokenExpired:
            await refresh(ep, generation: manifest.generation)
        case .reject(let failure):
            await fail(ep, failure)
        case .retry(let failure):
            manifest.entries[id.entryIndex].attempts += 1
            let attempts = manifest.entries[id.entryIndex].attempts
            // In memory only; the next coalesced save (or a pause, fail, or persist) writes it.
            //
            // 只保存在内存中; 下一次合并保存 (或暂停, 失败, 持久化) 时写入.
            runtime[ep.episodeKey, default: EpisodeRuntime()].manifest = manifest
            guard attempts <= Self.retryDelays.count else {
                await fail(ep, failure)
                return
            }
            // A cancel of this ID is in flight; the pump after it re-creates the task.
            //
            // 该 ID 的取消正在进行; 取消之后的队列推进会重建该任务.
            guard !ledger.isCancelling(id) else { return }
            let request = DownloadTaskRequest(id: id, url: manifest.entries[id.entryIndex].remoteURL,
                                              earliestBegin: now().addingTimeInterval(Self.retryDelays[attempts - 1]),
                                              priority: URLSessionTask.defaultPriority, allowsCellular: allowsCellular)
            transport.enqueue([request])
            ledger.claim([id])
        }
    }

    private func refresh(_ ep: DownloadEpisode, generation: Int) async {
        guard ep.state == .downloading else { return }
        if ep.refreshCount >= Self.refreshLimit {
            await fail(ep, .sourceRejects)
            return
        }
        ep.refreshCount += 1
        ep.state = .queued
        flushProgress(of: ep)
        if let manifest = runtime[ep.episodeKey]?.manifest { saveManifest(manifest, for: ep) }
        saveContext()
        bump()
        await cancelTasks(of: ep, upTo: generation)
        schedulePump()
    }

    private func fail(_ ep: DownloadEpisode, _ failure: DownloadFailure) async {
        ep.state = .failed
        ep.failure = failure
        flushProgress(of: ep)
        let generation = currentGeneration(of: ep)
        if let manifest = runtime[ep.episodeKey]?.manifest { saveManifest(manifest, for: ep) }
        saveContext()
        bump()
        await manifestWriter.flush(ep.episodeKey)
        await cancelTasks(of: ep, upTo: generation)
        schedulePump()
    }

    private func complete(_ ep: DownloadEpisode, _ manifest: DownloadManifest) async {
        let key = ep.episodeKey
        guard runtime[key]?.completing != true else { return }
        runtime[key, default: EpisodeRuntime()].completing = true
        defer {
            runtime[key]?.completing = false
            runtime.prune(key)
        }
        let dir = layout.episodeDir(ep.key)
        do {
            try LocalPlaylistWriter.write(manifest).write(to: layout.playlistURL(episodeDir: dir), atomically: true,
                                                          encoding: .utf8)
        } catch {
            logger.error("download playlist write failed: \(error.localizedDescription, privacy: .public)")
            if DownloadSessionDelegate.isOutOfSpace(error) {
                await pauseAll(reason: .noSpace)
            } else {
                await fail(ep, .invalidContent)
            }
            return
        }
        try? FileManager.default.removeItem(at: dir.appending(path: "incoming", directoryHint: .isDirectory))
        // The playlist is written first; the complete manifest follows, and the row turns completed
        // only once both are on disk. A pause or sign-out during the await still completes it,
        // since every file is present; only a failure or a delete stops it.
        //
        // 先写 playlist; 完整的 manifest 随后写入, 两者都落盘后数据行才变为已完成. 等待期间的暂停或登出
        // 仍会让它完成, 因为所有文件都在; 只有失败或删除才会中止.
        manifestWriter.submit(manifest, to: layout.manifestURL(episodeDir: dir), key: key)
        await manifestWriter.flush(key)
        guard isLive(ep), ep.state != .failed else { return }
        ep.pauseReason = nil
        // The final manifest was just flushed, so the writer is left alone.
        //
        // 最终的 manifest 刚刚落盘, 因此不触及写入器.
        forget(key, cancelWrite: false)
        ep.state = .completed
        ep.completedAt = now()
        ep.totalEntries = manifest.entries.count
        ep.doneEntries = manifest.doneCount
        setBytes(ep, manifest.totalBytes)
        ep.durationSec = manifest.totalDuration
        saveContext()
        bump()
    }

    // MARK: - Helpers

    /// Whether a row is still in the store; rows deleted across an `await` must not be read.
    ///
    /// 数据行是否仍在存储中; 跨越 `await` 期间被删除的行不能再读取.
    private func isLive(_ ep: DownloadEpisode) -> Bool {
        DownloadLibrary.isLive(ep)
    }

    private func taskID(_ ep: DownloadEpisode, generation: Int, entry: Int) -> DownloadTaskID {
        DownloadTaskID(scopeHash: ep.scopeHash, showDir: ep.showDir, episodeDir: ep.episodeDir, generation: generation,
                       entryIndex: entry)
    }

    /// The generation of an episode's cached manifest, or `.max` (every generation) without one.
    ///
    /// 某集缓存 manifest 的 generation; 没有缓存时为 `.max` (即所有 generation).
    private func currentGeneration(of ep: DownloadEpisode) -> Int {
        runtime[ep.episodeKey]?.manifest?.generation ?? .max
    }

    /// Cancels an episode's tasks up to `generation`, captured before the caller's first await; a
    /// newer generation comes from a prepare that ran during the awaits and must survive.
    ///
    /// 取消某集截至 `generation` 的任务 (由调用方在第一次 await 之前取得); 更新一代的任务来自等待期间
    /// 完成的准备, 必须保留.
    private func cancelTasks(of ep: DownloadEpisode, upTo generation: Int) async {
        let key = ep.episodeKey
        await cancelTasks { $0.episodeKey == key && $0.generation <= generation }
    }

    /// Cancels every transport task that matches `predicate`, including tasks the ledger does not
    /// know (left from an earlier launch); the in-flight ones among them stay claimed meanwhile.
    ///
    /// 取消所有满足 `predicate` 的传输任务, 包括账本不知道的任务 (之前启动遗留的); 其中进行中的任务在
    /// 取消期间保持占用.
    private func cancelTasks(where predicate: @escaping @Sendable (DownloadTaskID) -> Bool) async {
        await cancel(claiming: ledger.inFlight.filter(predicate), freeingRoom: true, where: predicate)
    }

    /// Cancels exactly `ids`, claimed for the length of the cancel.
    ///
    /// 只取消 `ids`, 取消期间它们保持占用.
    private func cancel(_ ids: Set<DownloadTaskID>) async {
        guard !ids.isEmpty else { return }
        await cancel(claiming: ids, freeingRoom: false, where: { ids.contains($0) })
    }

    /// The one path every cancellation takes: claims `ids` through the ledger, has the transport
    /// cancel what `predicate` matches, then releases the claims for the next pump. A claimed ID
    /// is never re-created during the cancel, so the cancel cannot kill its replacement.
    ///
    /// 所有取消都经过的唯一路径: 通过账本占用 `ids`, 由传输层取消满足 `predicate` 的任务, 再释放这些
    /// 占用留给下一次队列推进. 取消期间被占用的 ID 不会被重建, 因此取消不会误杀其替代任务.
    private func cancel(claiming ids: Set<DownloadTaskID>, freeingRoom: Bool,
                        where predicate: @escaping @Sendable (DownloadTaskID) -> Bool) async {
        ledger.beginCancel(ids, freeingRoom: freeingRoom)
        await transport.cancel(where: predicate)
        ledger.endCancel(ids)
    }

    /// Forgets an episode's cached manifest and pending progress (see `EpisodeRuntime.forget()`);
    /// with `cancelWrite`, also its pending manifest write, so nothing submits it again.
    ///
    /// 遗忘某集缓存的 manifest 与待同步进度 (见 `EpisodeRuntime.forget()`); 设置 `cancelWrite` 时还会
    /// 丢弃其待写入的 manifest, 之后不会再提交它.
    private func forget(_ key: String, cancelWrite: Bool) {
        runtime.forget(key)
        if cancelWrite { manifestWriter.cancel(key) }
    }

    /// Copies an episode's cached manifest progress to its row, writing only changed values.
    ///
    /// 将某集缓存的 manifest 进度写入其数据行, 只写入发生变化的值.
    private func flushProgress(of ep: DownloadEpisode) {
        let key = ep.episodeKey
        runtime[key]?.progressPending = false
        guard let manifest = runtime[key]?.manifest else {
            runtime.prune(key)
            return
        }
        let done = manifest.doneCount
        let bytes = manifest.totalBytes
        if ep.doneEntries != done { ep.doneEntries = done }
        setBytes(ep, bytes)
    }

    /// Flushes every episode with pending progress; returns the `showDir` of each flushed episode.
    ///
    /// 写入所有有待同步进度的剧集; 返回每个已写入剧集的 `showDir`.
    @discardableResult
    private func flushAllProgress() -> Set<String> {
        var shows: Set<String> = []
        for key in runtime.takePendingProgress() {
            guard let ep = library.episode(forKey: key), isLive(ep) else { continue }
            flushProgress(of: ep)
            shows.insert(ep.showDir)
        }
        return shows
    }

    /// Decodes the saved manifests of downloading rows that are not cached yet off the main actor
    /// (a long episode's manifest is megabytes of JSON), so the reconcile or pump that follows reads
    /// them from the cache. Returns at once when nothing needs decoding. A manifest is cached only
    /// when its row is still live, still downloading, and still the row of its key, and nothing
    /// cached one meanwhile; otherwise `manifest(for:)` reads the disk later as before.
    ///
    /// 在主 actor 之外解码尚未缓存的下载中数据行的已保存 manifest (长剧集的 manifest 是数 MB 的 JSON),
    /// 之后的对账或队列推进因此直接读取缓存. 没有需要解码的内容时立即返回. 只有当数据行仍然存在, 仍在
    /// 下载, 仍是该键对应的数据行, 且期间没有其他操作缓存过 manifest 时才会缓存; 否则仍由
    /// `manifest(for:)` 像以前一样稍后读取磁盘.
    private func preloadManifests(of rows: [DownloadEpisode]) async {
        var wanted: [String: DownloadEpisode] = [:]
        var files: [(key: String, url: URL)] = []
        for ep in rows where ep.state == .downloading && runtime[ep.episodeKey]?.manifest == nil
            && wanted[ep.episodeKey] == nil {
            wanted[ep.episodeKey] = ep
            files.append((ep.episodeKey, layout.manifestURL(episodeDir: layout.episodeDir(ep.key))))
        }
        guard !files.isEmpty else { return }
        let loaded = await Task.detached(priority: .userInitiated) {
            files.compactMap { file in DownloadManifest.load(from: file.url).map { (file.key, $0) } }
        }.value
        for (key, manifest) in loaded {
            guard runtime[key]?.manifest == nil, let row = wanted[key], isLive(row), row.state == .downloading,
                  library.episode(forKey: key) === row else { continue }
            runtime[key, default: EpisodeRuntime()].cacheLoaded(manifest)
        }
    }

    private func manifest(for ep: DownloadEpisode) -> DownloadManifest? {
        let key = ep.episodeKey
        if let cached = runtime[key]?.manifest { return cached }
        guard let loaded = DownloadManifest.load(from: layout.manifestURL(episodeDir: layout.episodeDir(ep.key))) else {
            return nil
        }
        runtime[key, default: EpisodeRuntime()].cacheLoaded(loaded)
        return loaded
    }

    /// Caches a manifest and queues it for the background writer; callers that need it on disk
    /// before continuing await `manifestWriter.flush`.
    ///
    /// 缓存 manifest 并交给后台写入器; 需要在继续之前落盘的调用方会等待 `manifestWriter.flush`.
    private func saveManifest(_ manifest: DownloadManifest, for ep: DownloadEpisode) {
        let key = ep.episodeKey
        runtime[key, default: EpisodeRuntime()].manifest = manifest
        runtime[key]?.unsaved = 0
        manifestWriter.submit(manifest, to: layout.manifestURL(episodeDir: layout.episodeDir(ep.key)), key: key)
    }

    /// Removes an episode's files (moved to the trash at once, deleted off the main actor) and
    /// cached manifest. Callers with a manifest write possibly in
    /// progress await `manifestWriter.discard` first; `markDamaged` only sees completed episodes,
    /// whose last write `complete` already flushed, so dropping a pending one is enough there.
    /// The writer never creates directories either, so a late write cannot bring the files back.
    ///
    /// 删除某集的文件 (立即移入回收站, 在主 actor 之外删除) 与缓存的 manifest. 可能有 manifest 写入正在进行的调用方会先等待
    /// 对 `manifestWriter.discard` 的调用; 而 `markDamaged` 只处理已完成的剧集, 其最后一次写入已由
    /// 对 `complete` 的调用落盘, 因此丢弃待写入快照即可. 写入器也从不创建目录, 迟到的写入无法让文件
    /// 重新出现.
    private func removeEpisodeFiles(_ ep: DownloadEpisode) {
        forget(ep.episodeKey, cancelWrite: true)
        trash.discard(layout.episodeDir(ep.key))
    }

    private func saveContext() {
        do {
            try context.save()
        } catch {
            logger.error("download rows save failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// Marks a structural change and recounts the active episodes.
    ///
    /// 标记一次结构变化, 并重新统计进行中的集数.
    private func bump() {
        changeCount &+= 1
        recountActive()
    }

    /// Schedules one progress notification at the end of the current interval; entries finishing
    /// before it fires share it.
    ///
    /// 在当前间隔结束时安排一次进度通知; 在它发出之前完成的条目共用这一次通知.
    private func scheduleProgress() {
        guard progressTask == nil else { return }
        let interval = progressInterval
        let wait = progressWait
        progressTask = Task { [weak self] in
            await wait(interval)
            guard let self else { return }
            self.progressTask = nil
            // Rows get the cached manifest's progress, which can run ahead of the manifest on disk
            // (saved every `saveEvery` entries or on a state change); after a crash the row may
            // show less on relaunch. That rewind is display only: the files and the saved manifest
            // stay consistent.
            //
            // 数据行写入缓存 manifest 的进度, 它可能领先于磁盘上的 manifest (每 `saveEvery` 个条目或
            // 状态切换时才保存); 崩溃后重启时数据行显示的进度可能回退. 这种回退只影响展示: 文件与已保存
            // 的 manifest 保持一致.
            let shows = self.flushAllProgress()
            let tick = self.progressTick &+ 1
            for show in shows { self.showProgressTicks[show] = tick }
            self.progressTick = tick
        }
    }

    /// Recomputes storage use from the rows and refreshes free space off the main actor, for
    /// example when a screen showing them appears.
    ///
    /// 依据数据行重新计算存储占用, 并在主 actor 之外刷新剩余空间, 例如在展示它们的页面出现时.
    func refreshStorage() {
        recomputeBytes()
        Task { await refreshFreeSpace() }
    }

    /// Reads the volume's free space off the main actor and caches it.
    ///
    /// 在主 actor 之外读取磁盘卷的剩余空间并缓存.
    func refreshFreeSpace() async {
        let read = freeSpace
        let free = await Task.detached(priority: .utility) { read() }.value
        if freeBytes != free { freeBytes = free }
    }

    /// Writes an episode's bytes and moves the cached total by the difference.
    ///
    /// 写入某集的字节数, 并按差值调整缓存的总量.
    private func setBytes(_ ep: DownloadEpisode, _ value: Int64) {
        guard ep.bytes != value else { return }
        let delta = value - ep.bytes
        ep.bytes = value
        usedBytes += delta
    }

    /// Recomputes the cached total from every row; only at launch and on demand.
    ///
    /// 依据所有数据行重新计算缓存的总量; 只在启动与按需时执行.
    private func recomputeBytes() {
        let total = library.totalBytes()
        if usedBytes != total { usedBytes = total }
    }

    /// Recounts queued and downloading episodes of the active scope with a count query; assigns only
    /// a changed value, so the tab badge moves only with state.
    ///
    /// 用计数查询重新统计当前作用域中排队与下载中的集数; 只在数值变化时赋值, 因此 tab 角标只随状态变化.
    private func recountActive() {
        let count = library.activeEpisodeCount(in: activeScopeKey)
        if count != activeEpisodeCount { activeEpisodeCount = count }
    }
}

extension DownloadManager: DownloadScopeControlling {}

extension DownloadManager: LocalEpisodeProviding {
    func localPlaybackURL(showKey: String, sourceKey: String, videoId: String, episodeIndex: Int) async -> URL? {
        guard let ep = completedCopy(showKey: showKey, sourceKey: sourceKey, videoId: videoId,
                                     episodeIndex: episodeIndex) else { return nil }
        return try? await localPlaybackURL(for: ep)
    }

    func reportPlaybackFailure(showKey: String, sourceKey: String, videoId: String, episodeIndex: Int) {
        guard let ep = completedCopy(showKey: showKey, sourceKey: sourceKey, videoId: videoId,
                                     episodeIndex: episodeIndex),
              !filesIntact(ep) else { return }
        markDamaged(ep)
    }
}

/// Resumes a continuation once, however many callers race to resume it.
///
/// 只恢复一次 continuation, 无论有多少调用方竞相恢复它.
@MainActor
private final class ResumeOnce {
    private var continuation: CheckedContinuation<Void, Never>?

    init(_ continuation: CheckedContinuation<Void, Never>) {
        self.continuation = continuation
    }

    /// Resumes the continuation on the first call; later calls do nothing.
    ///
    /// 首次调用时恢复 continuation; 之后的调用不做任何事.
    func resume() {
        continuation?.resume()
        continuation = nil
    }
}
#endif
