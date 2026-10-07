#if os(iOS)
import Foundation
import Observation
import SwiftData
import SwiftUI

/// Owns downloads: the queue, background tasks, manifests, and the rows the UI reads. One instance
/// lives for the whole process, created before any view, so background relaunches deliver their
/// events to it. It is the observable façade over focused units: `DownloadEngine` (pump,
/// transport events, manifest cache, task ledger), `DownloadLibrary` (row queries and library
/// merge rules), `DownloadCoverStore` (posters), and `LocalPlaybackHost` (the loopback server).
/// Views read `librarySnapshot`, rebuilt lazily after structural changes, and per-show progress ticks.
///
/// 管理下载: 队列, 后台任务, manifest 以及 UI 读取的数据行. 整个进程只有一个实例, 在任何视图之前创建,
/// 因此后台唤醒时的事件都会投递给它. 它是若干专注单元之上的可观察外观: `DownloadEngine` (队列推进,
/// 传输事件, manifest 缓存, 任务账本), `DownloadLibrary` (数据行查询与下载库合并规则),
/// `DownloadCoverStore` (海报) 与 `LocalPlaybackHost` (loopback 服务). 视图读取在结构变化后按需重建的
/// `librarySnapshot`, 以及每部剧的进度序号.
@Observable
@MainActor
final class DownloadManager {
    /// UserDefaults key of the cellular setting and the free-space floor for queueing.
    ///
    /// 蜂窝数据设置的 UserDefaults 键, 以及加入队列所需的剩余空间下限.
    static let cellularKey = "kmtv.downloads.allowsCellular"
    static let freeSpaceFloor: Int64 = 1_000_000_000
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
    /// Bumped on structural changes (rows added or removed, state transitions, scope, cover), which
    /// invalidate `librarySnapshot`. A finished entry does not bump it; see `progressTick`.
    ///
    /// 在结构变化 (增删数据行, 状态切换, 作用域, 封面) 时递增, 并使 `librarySnapshot` 失效. 完成单个条目
    /// 不会使其递增; 参见 `progressTick`.
    private(set) var changeCount = 0
    /// What the download screens show; see `DownloadLibrarySnapshot`. Built on the first read after a
    /// structural change, never per progress tick, so changes nobody looks at (a background wake, a
    /// show deleted episode by episode) fetch nothing. Reading it observes `changeCount` and the scope.
    ///
    /// 下载页面要展示的内容; 参见 `DownloadLibrarySnapshot`. 在结构变化后的首次读取时构建, 从不随进度通知
    /// 构建, 因此无人查看的变化 (后台唤醒, 逐集删除一部剧) 不会产生查询. 读取它会观察 `changeCount` 与作用域.
    var librarySnapshot: DownloadLibrarySnapshot {
        let revision = changeCount
        let scope = activeScopeKey
        if let cached = snapshotCache, cached.revision == revision, cachedSnapshotScope == scope { return cached }
        let snapshot = DownloadLibrarySnapshot(
            revision: revision, shows: library.libraryShows(activeScopeKey: scope),
            episodes: library.libraryEpisodes(showKey: nil, activeScopeKey: scope),
            scopeEpisodes: scope.map { library.episodes(in: $0) } ?? [])
        snapshotCache = snapshot
        cachedSnapshotScope = scope
        return snapshot
    }
    @ObservationIgnored private var snapshotCache: DownloadLibrarySnapshot?
    @ObservationIgnored private var cachedSnapshotScope: String?
    /// Bumped at most once per `progressInterval` while entries finish. Views read the per-show
    /// `progressTick(forTitle:)` instead, so a tick re-renders only readers of the shows it moved.
    ///
    /// 条目完成期间, 每个 `progressInterval` 至多递增一次. 视图改为读取每部剧的
    /// `progressTick(forTitle:)`, 因此一次进度通知只会重新渲染其影响的剧集的读取方.
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
    /// Episodes currently being prepared, by `episodeKey`.
    ///
    /// 正在准备的剧集, 以 `episodeKey` 标识.
    private(set) var preparingKeys: Set<String> = []
    /// Whether a preparer is set, mirrored from the engine's unobserved preparer so `canDownload`
    /// updates views.
    ///
    /// 是否设置了准备器; 由引擎中不被观察的准备器同步而来, 使 `canDownload` 能够刷新视图.
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
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let freeSpace: @Sendable () -> Int64
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private let library: DownloadLibrary
    @ObservationIgnored private let covers: DownloadCoverStore
    @ObservationIgnored private let playback: LocalPlaybackHost
    @ObservationIgnored private let engine: DownloadEngine
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
    /// Per-show progress counters by `showKey`, created on first read or write; each is observed on
    /// its own.
    ///
    /// 以 `showKey` 为键的每部剧进度计数, 在首次读取或写入时创建; 每个计数单独被观察.
    @ObservationIgnored private var showTicks: [String: DownloadShowTick] = [:]

    /// Creates the manager and subscribes to transport events before any task can be enqueued.
    ///
    /// 创建管理器, 并在任何任务入队之前订阅传输事件.
    init(context: ModelContext, layout: DownloadLayout, transport: any DownloadTransport,
         defaults: UserDefaults = .standard,
         freeSpace: @escaping @Sendable () -> Int64 = DownloadManager.deviceFreeSpace,
         now: @escaping () -> Date = Date.init, outstandingLimit: Int = 3000,
         network: DownloadNetworkMonitor? = nil,
         coverFetcher: @escaping @Sendable (URL) async -> Data? = DownloadCoverStore.fetchCoverData,
         backgroundWakeBudget: Duration = DownloadManager.backgroundWakeBudget,
         progressInterval: Duration = DownloadManager.progressInterval,
         progressWait: @escaping @Sendable (Duration) async -> Void = { try? await Task.sleep(for: $0) },
         manifestWriter: DownloadManifestWriter = .logging()) {
        self.context = context
        self.layout = layout
        self.defaults = defaults
        self.freeSpace = freeSpace
        self.now = now
        self.allowsCellular = defaults.bool(forKey: Self.cellularKey)
        self.network = network
        let library = DownloadLibrary(context: context)
        self.library = library
        covers = DownloadCoverStore(layout: layout, library: library, fetcher: coverFetcher)
        playback = LocalPlaybackHost(root: layout.root)
        let trash = DownloadTrash(layout: layout)
        self.trash = trash
        trash.sweep()
        engine = DownloadEngine(context: context, layout: layout, transport: transport, library: library, trash: trash,
                                now: now, outstandingLimit: outstandingLimit, manifestWriter: manifestWriter,
                                wakeBudget: backgroundWakeBudget, progressInterval: progressInterval,
                                progressWait: progressWait)
        engine.host = self
        covers.onSaved = { [weak self] in
            self?.saveContext()
            self?.bump()
        }
        network?.onRestore = { [weak self] in self?.engine.schedulePump() }
        recomputeBytes()
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
    var inFlight: Set<DownloadTaskID> { engine.inFlight }

    /// The pending progress notification; nil when none is scheduled. Exposed for tests.
    ///
    /// 待发出的进度通知; 未安排时为 nil. 供测试使用.
    var progressTask: Task<Void, Never>? { engine.progressTask }

    /// The progress tick that last moved the show with this title, 0 before any. Reading it
    /// observes only that show, so a reader skips ticks that moved other shows.
    ///
    /// 最近一次影响该标题剧集的进度通知序号, 尚未有过时为 0. 读取它只会观察这部剧, 读取方因此会跳过
    /// 只影响其他剧的通知.
    func progressTick(forTitle title: String) -> Int {
        showTick(normalizeSyncKey(title)).value
    }

    // MARK: - Library

    /// One show per show key across scopes, newest first; see `DownloadLibrary`. Views read
    /// `librarySnapshot` instead.
    ///
    /// 跨作用域按剧集键每部剧一行, 最新的在前; 参见 `DownloadLibrary`. 视图改为读取 `librarySnapshot`.
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

    /// The current `DownloadDisplayRevision`; reading it observes structure, the network path, the
    /// cellular setting, and the preparing keys, but no row and no progress.
    ///
    /// 当前的 `DownloadDisplayRevision`; 读取它会观察结构, 网络路径, 蜂窝数据设置与正在准备的键,
    /// 但不观察任何数据行与进度.
    var displayRevision: DownloadDisplayRevision {
        DownloadDisplayRevision(structure: changeCount, satisfied: network?.isSatisfied ?? true,
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
            await engine.pauseScope(previous, reason: .signedOut)
        }
        if activeScopeKey != scopeKey { activeScopeKey = scopeKey }
        setPreparer(preparer)
        for ep in episodes(in: scopeKey) where ep.state == .paused && ep.pauseReason == .signedOut {
            ep.state = .queued
            ep.pauseReason = nil
        }
        saveContext()
        bump()
        await dropRedundantCopies(in: scopeKey)
        await engine.reconcile()
        engine.schedulePump()
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
        setPreparer(nil)
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
        setPreparer(nil)
        await engine.pauseScope(scope, reason: .signedOut)
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

    /// Sets the engine's preparer and mirrors whether one is set.
    ///
    /// 设置引擎的准备器, 并同步是否已设置.
    private func setPreparer(_ preparer: (any DownloadPreparing)?) {
        engine.preparer = preparer
        let has = preparer != nil
        if hasPreparer != has { hasPreparer = has }
    }

    // MARK: - Commands

    /// Queues episodes not already downloaded; returns how many were added.
    ///
    /// 将尚未下载的剧集加入队列; 返回新增的数量.
    @discardableResult
    func enqueue(show info: DownloadShowInfo, episodes requests: [DownloadEpisodeRequest]) throws -> Int {
        guard let scopeKey = activeScopeKey, engine.preparer != nil else { throw DownloadEnqueueError.notSignedIn }
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
        engine.schedulePump()
        return added
    }

    /// Pauses an episode by the user.
    ///
    /// 由用户暂停一集.
    func pause(_ ep: DownloadEpisode) async {
        guard ep.state == .queued || ep.state == .downloading else { return }
        ep.state = .paused
        ep.pauseReason = .user
        engine.flushProgress(of: ep)
        let generation = engine.currentGeneration(of: ep)
        engine.saveCachedManifest(of: ep)
        saveContext()
        bump()
        await engine.flushManifest(ep.episodeKey)
        await engine.cancelTasks(of: ep, upTo: generation)
        engine.schedulePump()
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
        engine.schedulePump()
    }

    /// Retries a failed episode, keeping finished entries.
    ///
    /// 重试一集失败的剧集, 保留已完成的条目.
    func retry(_ ep: DownloadEpisode) {
        guard ep.state == .failed else { return }
        engine.resetAttempts(of: ep)
        ep.failure = nil
        ep.refreshCount = 0
        ep.state = .queued
        saveContext()
        bump()
        engine.schedulePump()
    }

    /// Pauses every queued or downloading episode of the active scope.
    ///
    /// 暂停当前作用域中所有排队或下载中的剧集.
    func pauseAll(reason: DownloadPauseReason = .user) async {
        await engine.pauseActiveScope(reason: reason)
    }

    /// Resumes every paused episode of the active scope.
    ///
    /// 继续当前作用域中所有已暂停的剧集.
    func resumeAll() {
        guard let scope = activeScopeKey, engine.preparer != nil else { return }
        for ep in episodes(in: scope) where ep.state == .paused {
            ep.state = .queued
            ep.pauseReason = nil
        }
        saveContext()
        bump()
        engine.schedulePump()
    }

    /// Deletes an episode and, when it was the last one, its show.
    ///
    /// 删除一集; 若是最后一集, 一并删除所属剧集.
    func delete(_ ep: DownloadEpisode) async {
        guard DownloadLibrary.isLive(ep) else { return }
        let key = ep.episodeKey
        let scopeKey = ep.scopeKey
        let showKey = ep.showKey
        ep.state = .paused
        // Drop the cached manifest before any await, so a persist meanwhile cannot queue it again.
        //
        // 在任何 await 之前丢弃缓存的 manifest, 使期间的持久化无法再次排入它.
        engine.forget(key, cancelWrite: true)
        await engine.cancelTasks { $0.episodeKey == key }
        // A late manifest write must not recreate the directory after it is removed.
        //
        // 迟到的 manifest 写入不能在目录删除后重新创建它.
        await engine.discardManifests { $0 == key }
        // A concurrent `deleteShow` or `deleteScope` may have deleted the row during the awaits.
        //
        // 等待期间, 并发的 `deleteShow` 或 `deleteScope` 可能已删除该行.
        guard DownloadLibrary.isLive(ep) else { return }
        engine.removeEpisodeFiles(ep)
        setBytes(ep, 0)
        context.delete(ep)
        saveContext()
        if episodes(in: scopeKey, showKey: showKey).isEmpty, let show = show(scopeKey: scopeKey, showKey: showKey) {
            trash.discard(layout.showDir(scopeHash: show.scopeHash, showDir: show.showDir))
            context.delete(show)
            saveContext()
        }
        bump()
        engine.schedulePump()
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
            engine.forget(ep.episodeKey, cancelWrite: true)
        }
        await engine.cancelTasks { $0.scopeHash == hash }
        await engine.discardManifests { EpisodeKey.path($0, isInScope: hash) }
        for ep in episodes(in: scopeKey) {
            // Again after the awaits, without touching the writer, which `discard` just emptied.
            //
            // 在等待之后再遗忘一次, 不触及写入器, 因为 `discard` 刚刚清空了它.
            engine.forget(ep.episodeKey, cancelWrite: false)
            setBytes(ep, 0)
            context.delete(ep)
        }
        for show in shows(in: scopeKey) { context.delete(show) }
        trash.discard(layout.scopeDir(hash))
        saveContext()
        bump()
    }

    /// Marks a completed episode whose files failed to play as damaged and removes its files, so a
    /// retry downloads it again. A row deleted or no longer completed (for example after an async
    /// file check) is left alone.
    ///
    /// 将播放失败的已完成剧集标记为已损坏并删除其文件, 重试时会重新下载. 已删除或不再处于已完成状态的
    /// 数据行 (例如经过异步文件检查之后) 保持不变.
    func markDamaged(_ ep: DownloadEpisode) {
        guard DownloadLibrary.isLive(ep), ep.state == .completed else { return }
        engine.removeEpisodeFiles(ep)
        ep.state = .failed
        ep.failure = .damaged
        ep.doneEntries = 0
        setBytes(ep, 0)
        saveContext()
        bump()
    }

    /// Whether a completed episode's playlist, manifest, and every entry file are on disk. A
    /// playback failure with intact files is a server or player problem, never damage. It reads the
    /// disk on the main actor; prefer `checkFilesIntact(_:)`.
    ///
    /// 已完成剧集的 playlist, manifest 与所有条目文件是否都在磁盘上. 文件完好时的播放失败属于服务
    /// 或播放器问题, 不算损坏. 它在主 actor 上读取磁盘; 优先使用异步版本 `checkFilesIntact(_:)`.
    func filesIntact(_ ep: DownloadEpisode) -> Bool {
        layout.filesIntact(episodeDir: layout.episodeDir(ep.key))
    }

    /// `filesIntact(_:)` off the main actor: the manifest decode and one existence check per entry
    /// (thousands for a long episode) run on a detached task.
    ///
    /// 在主 actor 之外执行的 `filesIntact(_:)`: manifest 解码与逐条目的存在性检查 (长剧集有数千个)
    /// 在独立任务中运行.
    func checkFilesIntact(_ ep: DownloadEpisode) async -> Bool {
        let layout = layout
        let dir = layout.episodeDir(ep.key)
        return await Task.detached(priority: .userInitiated) { layout.filesIntact(episodeDir: dir) }.value
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
        // Only tasks created under the old policy; they stay claimed during the cancel, and the
        // pump afterwards re-creates them under the new one.
        //
        // 只取消按旧策略创建的任务; 取消期间它们保持占用, 之后的队列推进会按新策略重建它们.
        await engine.cancelInFlight(scopeHash: DownloadPaths.scopeHash(scope))
        engine.schedulePump()
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
            let returning = !engine.isForeground
            engine.isForeground = true
            if returning {
                await playback.enterForeground()
                await engine.reconcile()
            }
            engine.schedulePump()
        case .background:
            engine.isForeground = false
            playback.enterBackground()
            await engine.persistAll()
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
        await engine.handleBackgroundWake()
    }

    /// Rebuilds the in-flight set from the transport; see `DownloadEngine.reconcile()`.
    ///
    /// 依据传输层重建进行中的任务集合; 参见 `DownloadEngine.reconcile()`.
    func reconcile() async {
        await engine.reconcile()
    }

    /// Returns when no pump is running.
    ///
    /// 没有正在运行的队列推进时返回.
    func waitForIdle() async {
        await engine.waitForIdle()
    }

    /// Writes cached manifests and pending row changes, and returns once the manifests are on disk.
    ///
    /// 写入缓存的 manifest 与待保存的数据行变化, 并在 manifest 落盘后返回.
    func persistAll() async {
        await engine.persistAll()
    }

    // MARK: - Storage

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

    /// Recomputes the cached total from every row; only at launch and on demand.
    ///
    /// 依据所有数据行重新计算缓存的总量; 只在启动与按需时执行.
    private func recomputeBytes() {
        let total = library.totalBytes()
        if usedBytes != total { usedBytes = total }
    }

    // MARK: - Observed state

    private func saveContext() {
        engine.saveContext()
    }

    /// Recounts queued and downloading episodes of the active scope with a count query; assigns only
    /// a changed value, so the tab badge moves only with state.
    ///
    /// 用计数查询重新统计当前作用域中排队与下载中的集数; 只在数值变化时赋值, 因此 tab 角标只随状态变化.
    private func recountActive() {
        let count = library.activeEpisodeCount(in: activeScopeKey)
        if count != activeEpisodeCount { activeEpisodeCount = count }
    }

    /// The progress counter of one show, created on first use.
    ///
    /// 某部剧的进度计数, 首次使用时创建.
    private func showTick(_ showKey: String) -> DownloadShowTick {
        if let tick = showTicks[showKey] { return tick }
        let tick = DownloadShowTick()
        showTicks[showKey] = tick
        return tick
    }
}

extension DownloadManager: DownloadEngineHost {
    /// Marks a structural change: recounts the active episodes; the snapshot rebuilds on its next read.
    ///
    /// 标记一次结构变化: 重新统计进行中的集数; 快照在下次读取时重建.
    func bump() {
        changeCount &+= 1
        recountActive()
    }

    /// Writes an episode's bytes and moves the cached total by the difference.
    ///
    /// 写入某集的字节数, 并按差值调整缓存的总量.
    func setBytes(_ ep: DownloadEpisode, _ value: Int64) {
        guard ep.bytes != value else { return }
        let delta = value - ep.bytes
        ep.bytes = value
        usedBytes += delta
    }

    func setPreparing(_ key: String, _ preparing: Bool) {
        if preparing {
            preparingKeys.insert(key)
        } else {
            preparingKeys.remove(key)
        }
    }

    func progressTicked(showKeys: Set<String>) {
        let tick = progressTick &+ 1
        for showKey in showKeys { showTick(showKey).advance(to: tick) }
        progressTick = tick
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
                                     episodeIndex: episodeIndex) else { return }
        // The file check runs off the main actor; the row may be deleted or re-downloaded meanwhile.
        //
        // 文件检查在主 actor 之外运行; 期间该行可能被删除或重新下载.
        Task {
            guard !(await checkFilesIntact(ep)) else { return }
            markDamaged(ep)
        }
    }
}
#endif
