#if os(iOS)
import Foundation
import Observation
import os
import SwiftData
import SwiftUI

/// Show metadata for a new download.
///
/// 新下载所需的剧集元数据.
struct DownloadShowInfo: Sendable, Equatable {
    let title: String
    let cover: String
    let type: String
    let year: String
    let coverURL: URL?
}

/// One episode to download.
///
/// 一集待下载的剧集.
struct DownloadEpisodeRequest: Sendable, Equatable {
    let sourceKey: String
    let sourceName: String
    let videoId: String
    let episodeIndex: Int
    let episodeName: String
    let lineIndex: Int
    let episodeCount: Int
    let episodeURL: String
}

/// Every observed input of `DownloadManager.displayState(of:)` besides the row itself, plus the
/// structural and progress counters; views that compute download state outside their body refresh
/// when it changes.
///
/// 除数据行本身外, `DownloadManager.displayState(of:)` 的全部被观察输入, 加上结构与进度计数; 在 body
/// 之外计算下载状态的视图会在它变化时刷新.
struct DownloadDisplayRevision: Equatable {
    var structure: Int
    var progress: Int
    var satisfied: Bool
    var expensive: Bool
    var constrained: Bool
    var allowsCellular: Bool
    var preparing: Set<String>
}

/// Why episodes could not be queued.
///
/// 无法加入队列的原因.
enum DownloadEnqueueError: Error, Equatable {
    case notSignedIn
    case notEnoughSpace
}

/// What a row shows for an episode.
///
/// 一集在列表行中展示的状态.
enum DownloadDisplayState: Equatable {
    case queued
    case preparing
    case downloading(Double)
    case waitingNetwork
    case waitingWiFi
    case paused(DownloadPauseReason)
    case completed
    case failed(DownloadFailure)
}

/// Owns downloads: the queue, background tasks, manifests, the loopback server, and the rows the
/// UI reads. One instance lives for the whole process, created before any view, so background
/// relaunches deliver their events to it.
///
/// 管理下载: 队列, 后台任务, manifest, loopback 服务以及 UI 读取的数据行. 整个进程只有一个实例,
/// 在任何视图之前创建, 因此后台唤醒时的事件都会投递给它.
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
    /// Whether an offline player is on screen; an automatic reconnect waits until it closes.
    ///
    /// 离线播放器是否正在显示; 自动重连会等到它关闭之后.
    var offlinePlaybackActive = false
    /// Network path monitor; nil means the path is assumed usable.
    ///
    /// 网络路径监视器; 为 nil 时视为网络可用.
    let network: DownloadNetworkMonitor?

    /// Dependencies, cached manifests by `episodeKey`, in-flight task IDs, entries finished since the
    /// last manifest save, and pump bookkeeping.
    ///
    /// 依赖项, 以 `episodeKey` 为键缓存的 manifest, 进行中的任务 ID, 上次保存 manifest 后完成的条目数,
    /// 以及队列推进的状态.
    @ObservationIgnored private let context: ModelContext
    @ObservationIgnored private let transport: any DownloadTransport
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let freeSpace: @Sendable () -> Int64
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private let coverFetcher: @Sendable (URL) async -> Data?
    @ObservationIgnored private let outstandingLimit: Int
    @ObservationIgnored private var preparer: (any DownloadPreparing)? {
        didSet {
            let has = preparer != nil
            if hasPreparer != has { hasPreparer = has }
        }
    }
    @ObservationIgnored private var manifests: [String: DownloadManifest] = [:]
    /// Facts of one manifest generation, so a finished entry costs O(1) instead of a pass over a
    /// long episode: the ciphertext entries (fixed per generation) and a running count of missing
    /// entries, which is rechecked against the manifest whenever it reaches zero.
    ///
    /// 某一代 manifest 的派生信息, 让完成一个条目的开销为 O(1), 而不是遍历一整集长剧: 密文条目 (每代
    /// 固定不变) 与缺失条目的计数; 计数降到零时会对照 manifest 重新核实.
    private struct ManifestFacts {
        let generation: Int
        let encrypted: Set<Int>
        var remaining: Int
    }
    @ObservationIgnored private var facts: [String: ManifestFacts] = [:]
    /// Rows by `episodeKey`, so transport events skip a fetch; a deleted row is fetched again.
    ///
    /// 以 `episodeKey` 为键的数据行, 传输事件因此无需每次查询; 已删除的行会重新查询.
    @ObservationIgnored private var rows: [String: DownloadEpisode] = [:]
    @ObservationIgnored private(set) var inFlight: Set<DownloadTaskID> = []
    /// IDs that `cancelClaimed` cancelled while a reconcile awaited the transport, per running
    /// reconcile; that reconcile must not adopt them from its older snapshot.
    ///
    /// 对账等待传输层期间被 `cancelClaimed` 取消的 ID, 按进行中的对账分别记录; 该对账不能从其较旧的
    /// 快照中重新接管它们.
    @ObservationIgnored private var cancelledDuringReconcile: [UUID: Set<DownloadTaskID>] = [:]
    @ObservationIgnored private var unsaved: [String: Int] = [:]
    /// IDs being cancelled, counted per pending cancel. They stay claimed until the cancel returns,
    /// so no pump or retry re-creates a task with the same ID that the cancel would then kill.
    ///
    /// 正在取消的 ID, 按未完成的取消次数计数. 取消返回之前它们一直被占用, 因此队列推进或重试不会重建
    /// 同一 ID 的任务, 再被这次取消误杀.
    @ObservationIgnored private var cancelling: [DownloadTaskID: Int] = [:]
    /// Whether a pump stopped at `outstandingLimit` with entries left; finished entries pump again
    /// once `refillBatch` slots are free.
    ///
    /// 队列推进是否因达到 `outstandingLimit` 而停下且仍有条目; 腾出 `refillBatch` 个空位后, 完成的条目
    /// 会再次推进队列.
    @ObservationIgnored private var starved = false
    /// Episodes whose finished entries have not reached their rows yet; flushed on the progress
    /// tick and on every state transition, so rows re-render per tick instead of per entry.
    ///
    /// 已完成条目尚未写入数据行的剧集; 在进度通知以及每次状态切换时写入, 数据行因此按通知而不是按条目
    /// 重新渲染.
    @ObservationIgnored private var progressPending: Set<String> = []
    /// Writes manifests off the main actor; see `DownloadManifestWriter`.
    ///
    /// 在主 actor 之外写入 manifest; 参见 `DownloadManifestWriter`.
    @ObservationIgnored private let manifestWriter: DownloadManifestWriter
    /// Episodes whose completion is awaiting its manifest write, so a pump meanwhile does not
    /// complete them a second time.
    ///
    /// 完成流程正在等待 manifest 写入的剧集, 以免期间的队列推进再次完成它们.
    @ObservationIgnored private var completing: Set<String> = []
    @ObservationIgnored private var pumpTask: Task<Void, Never>?
    @ObservationIgnored private var pumpRequested = false
    @ObservationIgnored private var backgroundWake = false
    @ObservationIgnored private var wakeDeadline: ContinuousClock.Instant?
    @ObservationIgnored private let wakeBudget: Duration
    @ObservationIgnored private var server: LocalMediaServer?
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
        self.outstandingLimit = outstandingLimit
        self.allowsCellular = defaults.bool(forKey: Self.cellularKey)
        self.network = network
        self.coverFetcher = coverFetcher
        self.wakeBudget = backgroundWakeBudget
        self.progressInterval = progressInterval
        self.progressWait = progressWait
        self.manifestWriter = manifestWriter
        trash = DownloadTrash(layout: layout)
        trash.sweep()
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

    // MARK: - Library

    // The library is every download on the device, whatever server or account it was made under:
    // anyone, signed in, anonymous, or offline, can play and delete it. Copies of one show or episode
    // under several accounts read as one. Only the active scope's unfinished episodes can be
    // paused, resumed, or retried, since that needs its account's media tokens.
    //
    // 下载库即本机上的全部下载, 无论它是在哪个服务器或账号下完成的: 任何人 (已登录, 匿名或离线) 都可以
    // 播放和删除. 同一部剧或同一集在多个账号下的副本视为一份. 只有当前作用域中未完成的剧集可以暂停, 继续
    // 或重试, 因为这需要其账号的媒体 token.

    /// One show per show key across scopes, newest first; the active scope's row stands for the
    /// show when it has one.
    ///
    /// 跨作用域按剧集键每部剧一行, 最新的在前; 当前作用域有该剧时以其数据行代表该剧.
    func libraryShows() -> [DownloadShow] {
        let all = (try? context.fetch(FetchDescriptor<DownloadShow>(
            sortBy: [SortDescriptor(\.createdAt, order: .reverse)]))) ?? []
        var picked: [String: DownloadShow] = [:]
        var order: [String] = []
        for show in all {
            guard let current = picked[show.showKey] else {
                picked[show.showKey] = show
                order.append(show.showKey)
                continue
            }
            if show.scopeKey == activeScopeKey && current.scopeKey != activeScopeKey { picked[show.showKey] = show }
        }
        return order.compactMap { picked[$0] }
    }

    /// The library row of one show.
    ///
    /// 某部剧在下载库中的数据行.
    func libraryShow(showKey: String) -> DownloadShow? {
        let descriptor = FetchDescriptor<DownloadShow>(predicate: #Predicate { $0.showKey == showKey })
        let rows = (try? context.fetch(descriptor)) ?? []
        return rows.first { $0.scopeKey == activeScopeKey } ?? rows.max { $0.createdAt < $1.createdAt }
    }

    /// One episode per (show, source, video, index) across scopes, optionally of one show, ordered
    /// by source then index. A completed copy wins, then the active scope's, then the newest.
    ///
    /// 跨作用域按 (剧集, 来源, 视频, 序号) 每集一行, 可限定某部剧, 按来源再按序号排序. 已完成的副本优先,
    /// 其次是当前作用域的, 再次是最新的.
    func libraryEpisodes(showKey: String? = nil) -> [DownloadEpisode] {
        let descriptor: FetchDescriptor<DownloadEpisode>
        if let showKey {
            descriptor = FetchDescriptor(predicate: #Predicate { $0.showKey == showKey })
        } else {
            descriptor = FetchDescriptor()
        }
        var picked: [String: DownloadEpisode] = [:]
        for ep in (try? context.fetch(descriptor)) ?? [] {
            let key = Self.libraryKey(ep)
            if let current = picked[key], !libraryPrefers(ep, over: current) { continue }
            picked[key] = ep
        }
        return picked.values.sorted { ($0.sourceKey, $0.episodeIndex) < ($1.sourceKey, $1.episodeIndex) }
    }

    /// Whether any scope has a completed episode.
    ///
    /// 是否有任一作用域存在已完成的剧集.
    var hasCompletedDownloads: Bool {
        let completed = DownloadState.completed.rawValue
        let descriptor = FetchDescriptor<DownloadEpisode>(predicate: #Predicate { $0.stateRaw == completed })
        return ((try? context.fetchCount(descriptor)) ?? 0) > 0
    }

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
        let key = Self.libraryKey(ep)
        let showKey = ep.showKey
        let copies = ((try? context.fetch(FetchDescriptor<DownloadEpisode>(
            predicate: #Predicate { $0.showKey == showKey }))) ?? []).filter { Self.libraryKey($0) == key }
        for copy in copies { await delete(copy) }
    }

    /// Deletes every copy of a show across scopes.
    ///
    /// 删除某部剧在所有作用域中的副本.
    func deleteShowFromLibrary(showKey: String) async {
        let descriptor = FetchDescriptor<DownloadShow>(predicate: #Predicate { $0.showKey == showKey })
        for show in (try? context.fetch(descriptor)) ?? [] { await deleteShow(show) }
    }

    /// Deletes every download on the device.
    ///
    /// 删除本机上的全部下载.
    func deleteAllDownloads() async {
        let shows = (try? context.fetch(FetchDescriptor<DownloadShow>())) ?? []
        let episodes = (try? context.fetch(FetchDescriptor<DownloadEpisode>())) ?? []
        for scope in Set(shows.map(\.scopeKey) + episodes.map(\.scopeKey)) { await deleteScope(scope) }
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

    private static func libraryKey(_ ep: DownloadEpisode) -> String {
        "\(ep.showKey)/\(ep.episodeDir)"
    }

    private func libraryPrefers(_ ep: DownloadEpisode, over current: DownloadEpisode) -> Bool {
        let done = ep.state == .completed, currentDone = current.state == .completed
        if done != currentDone { return done }
        let active = ep.scopeKey == activeScopeKey, currentActive = current.scopeKey == activeScopeKey
        if active != currentActive { return active }
        return ep.createdAt > current.createdAt
    }

    // MARK: - Queries

    /// Shows of a scope, newest first.
    ///
    /// 某个作用域的剧集, 最新的在前.
    func shows(in scopeKey: String) -> [DownloadShow] {
        let descriptor = FetchDescriptor<DownloadShow>(predicate: #Predicate { $0.scopeKey == scopeKey },
                                                       sortBy: [SortDescriptor(\.createdAt, order: .reverse)])
        return (try? context.fetch(descriptor)) ?? []
    }

    /// One show.
    ///
    /// 单部剧集.
    func show(scopeKey: String, showKey: String) -> DownloadShow? {
        let descriptor = FetchDescriptor<DownloadShow>(
            predicate: #Predicate { $0.scopeKey == scopeKey && $0.showKey == showKey })
        return try? context.fetch(descriptor).first
    }

    /// Episodes of a scope, optionally of one show, ordered by source then index.
    ///
    /// 某个作用域的剧集分集, 可限定某部剧, 按来源再按序号排序.
    func episodes(in scopeKey: String, showKey: String? = nil) -> [DownloadEpisode] {
        let descriptor: FetchDescriptor<DownloadEpisode>
        if let showKey {
            descriptor = FetchDescriptor(predicate: #Predicate { $0.scopeKey == scopeKey && $0.showKey == showKey })
        } else {
            descriptor = FetchDescriptor(predicate: #Predicate { $0.scopeKey == scopeKey })
        }
        return ((try? context.fetch(descriptor)) ?? []).sorted {
            ($0.sourceKey, $0.episodeIndex) < ($1.sourceKey, $1.episodeIndex)
        }
    }

    /// One episode by identity.
    ///
    /// 按身份查找一集.
    func episode(scopeKey: String, sourceKey: String, videoId: String, episodeIndex: Int) -> DownloadEpisode? {
        let descriptor = FetchDescriptor<DownloadEpisode>(predicate: #Predicate {
            $0.scopeKey == scopeKey && $0.sourceKey == sourceKey && $0.videoId == videoId && $0.episodeIndex == episodeIndex
        })
        return try? context.fetch(descriptor).first
    }

    private func episode(forKey key: String) -> DownloadEpisode? {
        if let row = rows[key], isLive(row), row.episodeKey == key { return row }
        rows[key] = nil
        let parts = key.split(separator: "/").map(String.init)
        guard parts.count == 3 else { return nil }
        let (scopeHash, showDir, episodeDir) = (parts[0], parts[1], parts[2])
        let descriptor = FetchDescriptor<DownloadEpisode>(predicate: #Predicate {
            $0.scopeHash == scopeHash && $0.showDir == showDir && $0.episodeDir == episodeDir
        })
        let row = try? context.fetch(descriptor).first
        rows[key] = row
        return row
    }

    private func facts(for key: String, _ manifest: DownloadManifest) -> ManifestFacts {
        if let cached = facts[key], cached.generation == manifest.generation { return cached }
        let made = ManifestFacts(generation: manifest.generation, encrypted: manifest.encryptedEntries,
                                 remaining: manifest.missingCount)
        facts[key] = made
        return made
    }

    /// Local poster file of a show, if downloaded.
    ///
    /// 剧集的本地海报文件 (如已下载).
    func coverFileURL(for show: DownloadShow) -> URL? {
        guard !show.coverFile.isEmpty else { return nil }
        return layout.showDir(scopeHash: show.scopeHash, showDir: show.showDir).appending(path: show.coverFile)
    }

    /// Display state of an episode under the current network path.
    ///
    /// 当前网络路径下一集的展示状态.
    func displayState(of ep: DownloadEpisode) -> DownloadDisplayState {
        Self.displayState(state: ep.state, pauseReason: ep.pauseReason, failure: ep.failure, done: ep.doneEntries,
                          total: ep.totalEntries, preparing: preparingKeys.contains(ep.episodeKey),
                          satisfied: network?.isSatisfied ?? true, expensive: network?.isExpensive ?? false,
                          constrained: network?.isConstrained ?? false, allowsCellular: allowsCellular)
    }

    /// Pure display-state rule: stored terminal and paused states win; otherwise an unusable path
    /// waits for the network, and an expensive path without the cellular setting (or Low Data
    /// Mode) waits for WiFi.
    ///
    /// 纯粹的展示状态规则: 持久化的终止与暂停状态优先; 否则网络不可用时等待网络, 网络昂贵且未允许
    /// 蜂窝数据 (或处于低数据模式) 时等待 WiFi.
    static func displayState(state: DownloadState, pauseReason: DownloadPauseReason?, failure: DownloadFailure?,
                             done: Int, total: Int, preparing: Bool, satisfied: Bool, expensive: Bool,
                             constrained: Bool, allowsCellular: Bool) -> DownloadDisplayState {
        switch state {
        case .completed: return .completed
        case .failed: return .failed(failure ?? .network)
        case .paused: return .paused(pauseReason ?? .user)
        case .queued, .downloading:
            if !satisfied { return .waitingNetwork }
            if constrained || (expensive && !allowsCellular) { return .waitingWiFi }
            if preparing { return .preparing }
            if state == .queued { return .queued }
            return .downloading(total > 0 ? Double(done) / Double(total) : 0)
        }
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
        retryMissingCovers(scopeKey: scopeKey)
    }

    /// Re-fetches covers that never arrived or vanished from disk, without blocking activation.
    ///
    /// 重新获取从未下载成功或已从磁盘丢失的封面, 不阻塞激活流程.
    private func retryMissingCovers(scopeKey: String) {
        let pending = shows(in: scopeKey).filter { show in
            guard coverRemoteURL(for: show) != nil else { return false }
            guard let file = coverFileURL(for: show) else { return true }
            return !FileManager.default.fileExists(atPath: file.path)
        }.map(\.showKey)
        guard !pending.isEmpty else { return }
        Task {
            for showKey in pending {
                guard activeScopeKey == scopeKey, let show = show(scopeKey: scopeKey, showKey: showKey),
                      let url = coverRemoteURL(for: show) else { continue }
                await fetchCover(scopeKey: scopeKey, showKey: showKey, from: url)
            }
        }
    }

    /// Remote cover URL of a show: the resolved URL saved at enqueue, else `cover` when it is
    /// already absolute; nil when neither gives one.
    ///
    /// 剧集封面的远程 URL: 优先使用入队时保存的已解析 URL, 其次在 `cover` 已是绝对地址时使用它;
    /// 两者都没有时返回 nil.
    private func coverRemoteURL(for show: DownloadShow) -> URL? {
        if !show.coverURLString.isEmpty { return URL(string: show.coverURLString) }
        guard show.cover.hasPrefix("http") else { return nil }
        return URL(string: show.cover)
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
            generations[ep.episodeKey] = manifests[ep.episodeKey]?.generation
            guard ep.state == .queued || ep.state == .downloading else { continue }
            ep.state = .paused
            ep.pauseReason = reason
            flushProgress(of: ep)
            if let manifest = manifests[ep.episodeKey] { saveManifest(manifest, for: ep) }
        }
        saveContext()
        bump()
        await manifestWriter.flushAll()
        // Tasks of a newer generation come from a resume during the await; they must survive.
        //
        // 更新一代的任务来自等待期间的继续操作; 它们必须保留.
        let bound = generations
        inFlight = inFlight.filter { !($0.scopeHash == hash && $0.generation <= bound[$0.episodeKey] ?? .max) }
        await transport.cancel { $0.scopeHash == hash && $0.generation <= bound[$0.episodeKey] ?? .max }
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
            Task { await fetchCover(scopeKey: scopeKey, showKey: showKey, from: coverURL) }
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
        if let manifest = manifests[ep.episodeKey] { saveManifest(manifest, for: ep) }
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
        dropCachedManifest(key)
        inFlight = inFlight.filter { $0.episodeKey != key }
        await transport.cancel { $0.episodeKey == key }
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
            dropCachedManifest(ep.episodeKey)
        }
        inFlight = inFlight.filter { $0.scopeHash != hash }
        await transport.cancel { $0.scopeHash == hash }
        await manifestWriter.discard { $0.hasPrefix(hash + "/") }
        for ep in episodes(in: scopeKey) {
            manifests[ep.episodeKey] = nil
            facts[ep.episodeKey] = nil
            unsaved[ep.episodeKey] = nil
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
        let dir = layout.episodeDir(scopeHash: ep.scopeHash, showDir: ep.showDir, episodeDir: ep.episodeDir)
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
        await cancelClaimed(inFlight.filter { $0.scopeHash == hash })
        schedulePump()
    }

    // MARK: - Playback

    /// Loopback URL of a completed episode. One server rooted at the downloads directory serves
    /// every scope, so playing the next episode from another account's download never restarts it
    /// under the item that is still playing.
    ///
    /// 已完成剧集的 loopback URL. 一个以下载目录为根的服务覆盖所有作用域, 因此播放另一个账号下载的
    /// 下一集时, 不会在仍在播放的 item 下重启服务.
    func localPlaybackURL(for ep: DownloadEpisode) async throws -> URL {
        let server = self.server ?? LocalMediaServer(root: layout.root)
        self.server = server
        _ = try await server.start()
        guard let url = server.url(forRelativePath: "\(ep.scopeHash)/\(ep.showDir)/\(ep.episodeDir)/index.m3u8") else {
            throw LocalMediaServerError.notReady
        }
        return url
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
                if let server { _ = try? await server.start() }
                await reconcile()
            }
            schedulePump()
        case .background:
            isForeground = false
            // The app has no background audio, so playback stops here; release the socket and
            // rebind the same port on return.
            //
            // App 没有后台音频, 播放会在此停止; 释放 socket, 返回前台时重新绑定同一端口.
            server?.stop()
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
    /// entries of downloading episodes and cancels the rest.
    ///
    /// 依据传输层重建进行中的任务集合: 保留下载中剧集缺失条目的当前代任务, 取消其余任务.
    func reconcile() async {
        // Events of tasks that already finished are no longer in `outstanding()`; apply them first,
        // or their entries would be enqueued again.
        //
        // 已完成任务的事件不再出现在 `outstanding()` 中; 必须先处理这些事件, 否则对应条目会被重复提交.
        await transport.drainEvents()
        await preloadManifests(of: downloadingEpisodes())
        let before = inFlight
        let watch = UUID()
        cancelledDuringReconcile[watch] = []
        let outstanding = await transport.outstanding()
        let cancelledMeanwhile = cancelledDuringReconcile.removeValue(forKey: watch) ?? []
        var keep: Set<DownloadTaskID> = []
        var stale: Set<DownloadTaskID> = []
        for id in outstanding where !cancelledMeanwhile.contains(id) {
            if let ep = episode(forKey: id.episodeKey), ep.state == .downloading, let manifest = manifest(for: ep),
               manifest.generation == id.generation, manifest.entries.indices.contains(id.entryIndex),
               !manifest.entries[id.entryIndex].done {
                keep.insert(id)
            } else {
                stale.insert(id)
            }
        }
        // Merge rather than overwrite: a pump that ran during the await added tasks the snapshot
        // may predate. Claims from before the await that the transport no longer has are dropped,
        // except IDs cancelled meanwhile: a claim on those now belongs to a task re-created since.
        //
        // 合并而非覆盖: 等待期间运行的队列推进新增的任务可能晚于快照. 等待之前的占用若已不在传输层中,
        // 则被丢弃; 但期间被取消的 ID 除外: 对它们的占用此时属于之后重建的任务.
        inFlight = keep.union(inFlight.subtracting(before.subtracting(cancelledMeanwhile)))
        await cancelClaimed(stale)
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
        for (key, manifest) in manifests {
            manifestWriter.submit(manifest, to: layout.manifestURL(episodeDir: layout.root.appending(path: key, directoryHint: .isDirectory)),
                                  key: key)
        }
        unsaved = [:]
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
            guard inFlight.count < outstandingLimit else {
                starved = true
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
            if let current = episode(forKey: key), current.pauseReason == .signedOut { return }
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
        guard let current = episode(forKey: key), current.state == .queued else { return }
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
                    dropCachedManifest(key)
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
            try? FileManager.default.createDirectory(
                at: layout.episodeDir(scopeHash: current.scopeHash, showDir: current.showDir,
                                      episodeDir: current.episodeDir),
                withIntermediateDirectories: true)
            saveManifest(next, for: current)
            progressPending.remove(key)
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
        let room = outstandingLimit - inFlight.count
        guard room > 0 else {
            starved = true
            return
        }
        var requests: [DownloadTaskRequest] = []
        for entry in manifest.entries where !entry.done {
            let id = taskID(ep, generation: manifest.generation, entry: entry.index)
            guard !inFlight.contains(id), cancelling[id] == nil else { continue }
            if requests.count >= room {
                starved = true
                break
            }
            requests.append(DownloadTaskRequest(id: id, url: entry.remoteURL, earliestBegin: nil, priority: priority,
                                                allowsCellular: allowsCellular))
        }
        guard !requests.isEmpty else { return }
        transport.enqueue(requests)
        inFlight.formUnion(requests.map(\.id))
    }

    /// Free slots that make a starved queue pump again: a tenth of the limit, at least one, so a
    /// long episode refills in batches instead of once per finished entry.
    ///
    /// 让受限队列再次推进所需的空位数: 上限的十分之一, 至少为一, 因此长剧集按批补充, 而不是每完成一个
    /// 条目就推进一次.
    private var refillBatch: Int { max(1, outstandingLimit / 10) }

    /// Pumps again when a starved queue has `refillBatch` free slots.
    ///
    /// 受限队列有 `refillBatch` 个空位时再次推进.
    private func pumpIfRoomOpened() {
        guard starved, inFlight.count <= outstandingLimit - refillBatch else { return }
        starved = false
        schedulePump()
    }

    // MARK: - Events

    /// Handles one transport event; the transport delivers them one at a time.
    ///
    /// 处理一个传输事件; 传输层逐个投递事件.
    func process(_ event: DownloadTransportEvent) async {
        switch event {
        case .finished(let id, let info):
            inFlight.remove(id)
            await handleFinished(id, info)
        case .failed(let id, let code):
            inFlight.remove(id)
            if let outcome = DownloadEntryValidator.classify(transportError: URLError(code)) {
                await apply(outcome, to: id)
            }
        case .storageFull(let id):
            inFlight.remove(id)
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
        guard let ep = episode(forKey: id.episodeKey), ep.state == .downloading,
              let manifest = manifest(for: ep), manifest.generation == id.generation,
              manifest.entries.indices.contains(id.entryIndex), !manifest.entries[id.entryIndex].done else {
            return nil
        }
        let encrypted = facts(for: ep.episodeKey, manifest).encrypted.contains(id.entryIndex)
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
        manifests[key]?.entries[id.entryIndex].done = true
        manifests[key]?.entries[id.entryIndex].bytes = info.size
        guard let manifest = manifests[key] else { return }
        // The row catches up on the progress tick (or the next state transition), not per entry.
        //
        // 数据行在进度通知 (或下一次状态切换) 时同步, 而不是每个条目同步一次.
        progressPending.insert(key)
        if ep.refreshCount != 0 { ep.refreshCount = 0 }
        scheduleProgress()
        facts[key]?.remaining -= 1
        if (facts[key]?.remaining ?? 0) <= 0 {
            // Recheck the count against the manifest; a mismatch resets it.
            //
            // 对照 manifest 重新核实计数; 不一致时重置计数.
            let missing = manifest.missingCount
            facts[key]?.remaining = missing
            if missing == 0 {
                await complete(ep, manifest)
                schedulePump()
                return
            }
        }
        let pending = (unsaved[key] ?? 0) + 1
        // Long episodes save less often: every save encodes the whole manifest.
        //
        // 长剧集降低保存频率: 每次保存都要编码整个 manifest.
        if pending >= max(Self.saveEvery, manifest.entries.count / 50) {
            saveManifest(manifest, for: ep)
            flushProgress(of: ep)
            // Keep the episode pending, so the tick still records its show for badge readers.
            //
            // 让该集保持待同步, 进度通知因此仍会为选集角标记录其所属剧集.
            progressPending.insert(key)
            saveContext()
        } else {
            unsaved[key] = pending
        }
    }

    private func apply(_ outcome: EntryOutcome, to id: DownloadTaskID) async {
        guard let ep = episode(forKey: id.episodeKey), ep.state == .downloading,
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
            manifests[ep.episodeKey] = manifest
            guard attempts <= Self.retryDelays.count else {
                await fail(ep, failure)
                return
            }
            // A cancel of this ID is in flight; the pump after it re-creates the task.
            //
            // 该 ID 的取消正在进行; 取消之后的队列推进会重建该任务.
            guard cancelling[id] == nil else { return }
            let request = DownloadTaskRequest(id: id, url: manifest.entries[id.entryIndex].remoteURL,
                                              earliestBegin: now().addingTimeInterval(Self.retryDelays[attempts - 1]),
                                              priority: URLSessionTask.defaultPriority, allowsCellular: allowsCellular)
            transport.enqueue([request])
            inFlight.insert(id)
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
        if let manifest = manifests[ep.episodeKey] { saveManifest(manifest, for: ep) }
        saveContext()
        bump()
        let key = ep.episodeKey
        inFlight = inFlight.filter { !($0.episodeKey == key && $0.generation <= generation) }
        await transport.cancel { $0.episodeKey == key && $0.generation <= generation }
        schedulePump()
    }

    private func fail(_ ep: DownloadEpisode, _ failure: DownloadFailure) async {
        ep.state = .failed
        ep.failure = failure
        flushProgress(of: ep)
        let generation = currentGeneration(of: ep)
        if let manifest = manifests[ep.episodeKey] { saveManifest(manifest, for: ep) }
        saveContext()
        bump()
        await manifestWriter.flush(ep.episodeKey)
        await cancelTasks(of: ep, upTo: generation)
        schedulePump()
    }

    private func complete(_ ep: DownloadEpisode, _ manifest: DownloadManifest) async {
        let key = ep.episodeKey
        guard !completing.contains(key) else { return }
        completing.insert(key)
        defer { completing.remove(key) }
        let dir = layout.episodeDir(scopeHash: ep.scopeHash, showDir: ep.showDir, episodeDir: ep.episodeDir)
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
        manifests[ep.episodeKey] = nil
        facts[ep.episodeKey] = nil
        unsaved[ep.episodeKey] = nil
        progressPending.remove(ep.episodeKey)
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
        !ep.isDeleted && ep.modelContext != nil
    }

    private func taskID(_ ep: DownloadEpisode, generation: Int, entry: Int) -> DownloadTaskID {
        DownloadTaskID(scopeHash: ep.scopeHash, showDir: ep.showDir, episodeDir: ep.episodeDir, generation: generation,
                       entryIndex: entry)
    }

    /// The generation of an episode's cached manifest, or `.max` (every generation) without one.
    ///
    /// 某集缓存 manifest 的 generation; 没有缓存时为 `.max` (即所有 generation).
    private func currentGeneration(of ep: DownloadEpisode) -> Int {
        manifests[ep.episodeKey]?.generation ?? .max
    }

    /// Cancels an episode's tasks up to `generation`, captured before the caller's first await; a
    /// newer generation comes from a prepare that ran during the awaits and must survive.
    ///
    /// 取消某集截至 `generation` 的任务 (由调用方在第一次 await 之前取得); 更新一代的任务来自等待期间
    /// 完成的准备, 必须保留.
    private func cancelTasks(of ep: DownloadEpisode, upTo generation: Int) async {
        let key = ep.episodeKey
        inFlight = inFlight.filter { !($0.episodeKey == key && $0.generation <= generation) }
        await transport.cancel { $0.episodeKey == key && $0.generation <= generation }
    }

    /// Cancels tasks by ID while keeping the IDs claimed (see `cancelling`), then releases them for
    /// the next pump.
    ///
    /// 按 ID 取消任务, 期间保持这些 ID 被占用 (见 `cancelling`), 之后释放给下一次队列推进.
    private func cancelClaimed(_ ids: Set<DownloadTaskID>) async {
        guard !ids.isEmpty else { return }
        for id in ids { cancelling[id, default: 0] += 1 }
        for watch in cancelledDuringReconcile.keys { cancelledDuringReconcile[watch]?.formUnion(ids) }
        await transport.cancel { ids.contains($0) }
        for id in ids {
            let count = (cancelling[id] ?? 1) - 1
            cancelling[id] = count > 0 ? count : nil
        }
        inFlight.subtract(ids)
    }

    /// Copies an episode's cached manifest progress to its row, writing only changed values.
    ///
    /// 将某集缓存的 manifest 进度写入其数据行, 只写入发生变化的值.
    private func flushProgress(of ep: DownloadEpisode) {
        progressPending.remove(ep.episodeKey)
        guard let manifest = manifests[ep.episodeKey] else { return }
        let done = manifest.doneCount
        let bytes = manifest.totalBytes
        if ep.doneEntries != done { ep.doneEntries = done }
        setBytes(ep, bytes)
    }

    /// Flushes every episode with pending progress.
    ///
    /// 写入所有有待同步进度的剧集.
    @discardableResult
    private func flushAllProgress() -> Set<String> {
        let keys = progressPending
        progressPending = []
        var shows: Set<String> = []
        for key in keys {
            guard let ep = episode(forKey: key), isLive(ep) else { continue }
            flushProgress(of: ep)
            shows.insert(ep.showDir)
        }
        return shows
    }

    /// Downloading rows of every scope.
    ///
    /// 所有作用域中下载中的数据行.
    private func downloadingEpisodes() -> [DownloadEpisode] {
        let downloading = DownloadState.downloading.rawValue
        let descriptor = FetchDescriptor<DownloadEpisode>(predicate: #Predicate { $0.stateRaw == downloading })
        return (try? context.fetch(descriptor)) ?? []
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
        for ep in rows where ep.state == .downloading && manifests[ep.episodeKey] == nil && wanted[ep.episodeKey] == nil {
            wanted[ep.episodeKey] = ep
            let dir = layout.episodeDir(scopeHash: ep.scopeHash, showDir: ep.showDir, episodeDir: ep.episodeDir)
            files.append((ep.episodeKey, layout.manifestURL(episodeDir: dir)))
        }
        guard !files.isEmpty else { return }
        let loaded = await Task.detached(priority: .userInitiated) {
            files.compactMap { file in DownloadManifest.load(from: file.url).map { (file.key, $0) } }
        }.value
        for (key, manifest) in loaded {
            guard manifests[key] == nil, let row = wanted[key], isLive(row), row.state == .downloading,
                  episode(forKey: key) === row else { continue }
            manifests[key] = manifest
            facts[key] = nil
        }
    }

    private func manifest(for ep: DownloadEpisode) -> DownloadManifest? {
        if let cached = manifests[ep.episodeKey] { return cached }
        let dir = layout.episodeDir(scopeHash: ep.scopeHash, showDir: ep.showDir, episodeDir: ep.episodeDir)
        guard let loaded = DownloadManifest.load(from: layout.manifestURL(episodeDir: dir)) else { return nil }
        manifests[ep.episodeKey] = loaded
        facts[ep.episodeKey] = nil
        return loaded
    }

    /// Caches a manifest and queues it for the background writer; callers that need it on disk
    /// before continuing await `manifestWriter.flush`.
    ///
    /// 缓存 manifest 并交给后台写入器; 需要在继续之前落盘的调用方会等待 `manifestWriter.flush`.
    private func saveManifest(_ manifest: DownloadManifest, for ep: DownloadEpisode) {
        manifests[ep.episodeKey] = manifest
        unsaved[ep.episodeKey] = 0
        let dir = layout.episodeDir(scopeHash: ep.scopeHash, showDir: ep.showDir, episodeDir: ep.episodeDir)
        manifestWriter.submit(manifest, to: layout.manifestURL(episodeDir: dir), key: ep.episodeKey)
    }

    /// Forgets an episode's cached manifest and pending writes, so nothing submits it again.
    ///
    /// 丢弃某集缓存的 manifest 与待写入快照, 之后不会再提交它.
    private func dropCachedManifest(_ key: String) {
        manifests[key] = nil
        facts[key] = nil
        unsaved[key] = nil
        progressPending.remove(key)
        manifestWriter.cancel(key)
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
        manifestWriter.cancel(ep.episodeKey)
        manifests[ep.episodeKey] = nil
        facts[ep.episodeKey] = nil
        unsaved[ep.episodeKey] = nil
        progressPending.remove(ep.episodeKey)
        trash.discard(layout.episodeDir(scopeHash: ep.scopeHash, showDir: ep.showDir, episodeDir: ep.episodeDir))
    }

    private func fetchCover(scopeKey: String, showKey: String, from url: URL) async {
        guard let data = await coverFetcher(url),
              let show = show(scopeKey: scopeKey, showKey: showKey) else { return }
        let dir = layout.showDir(scopeHash: show.scopeHash, showDir: show.showDir)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try data.write(to: dir.appending(path: "cover.jpg"), options: .atomic)
        } catch {
            return
        }
        show.coverFile = "cover.jpg"
        saveContext()
        bump()
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
        let all = (try? context.fetch(FetchDescriptor<DownloadEpisode>())) ?? []
        let total = all.reduce(Int64(0)) { $0 + $1.bytes }
        if usedBytes != total { usedBytes = total }
    }

    /// Recounts queued and downloading episodes of the active scope with a count query; assigns only
    /// a changed value, so the tab badge moves only with state.
    ///
    /// 用计数查询重新统计当前作用域中排队与下载中的集数; 只在数值变化时赋值, 因此 tab 角标只随状态变化.
    private func recountActive() {
        var count = 0
        if let scope = activeScopeKey {
            let queued = DownloadState.queued.rawValue
            let downloading = DownloadState.downloading.rawValue
            let descriptor = FetchDescriptor<DownloadEpisode>(predicate: #Predicate {
                $0.scopeKey == scope && ($0.stateRaw == queued || $0.stateRaw == downloading)
            })
            count = (try? context.fetchCount(descriptor)) ?? 0
        }
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

extension DownloadManager {
    /// A completed copy of the episode in any scope, the active scope's first. The show key is part
    /// of the match, since source keys are names each server's admin picks and two servers can
    /// reuse one for different upstreams.
    ///
    /// 任一作用域中该集的已完成副本, 优先当前作用域. 剧集键也参与匹配, 因为来源键是各服务端管理员自定义
    /// 的名称, 两个服务端可能把同一个名称用于不同的上游.
    func completedCopy(showKey: String, sourceKey: String, videoId: String, episodeIndex: Int) -> DownloadEpisode? {
        let completed = DownloadState.completed.rawValue
        let descriptor = FetchDescriptor<DownloadEpisode>(predicate: #Predicate {
            $0.showKey == showKey && $0.sourceKey == sourceKey && $0.videoId == videoId
                && $0.episodeIndex == episodeIndex && $0.stateRaw == completed
        })
        let copies = (try? context.fetch(descriptor)) ?? []
        return copies.first { $0.scopeKey == activeScopeKey } ?? copies.max { $0.createdAt < $1.createdAt }
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
