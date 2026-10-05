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

    /// On-disk layout of the downloads root.
    ///
    /// 下载根目录的磁盘布局.
    let layout: DownloadLayout
    /// Scope whose downloads the UI shows and the engine runs.
    ///
    /// UI 展示且引擎正在处理其下载的作用域.
    private(set) var activeScopeKey: String?
    /// Bumped on every change, so views re-read rows.
    ///
    /// 每次变化都会递增, 视图据此重新读取数据行.
    private(set) var changeCount = 0
    /// Episodes currently being prepared, by `episodeKey`.
    ///
    /// 正在准备的剧集, 以 `episodeKey` 标识.
    private(set) var preparingKeys: Set<String> = []
    /// Whether the scene is active or inactive; preparation runs only then or during a background wake.
    ///
    /// 场景是否处于 active 或 inactive; 只有此时或后台唤醒期间才会做准备.
    private(set) var isForeground = true
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
    @ObservationIgnored private let freeSpace: () -> Int64
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private let coverFetcher: @Sendable (URL) async -> Data?
    @ObservationIgnored private let outstandingLimit: Int
    @ObservationIgnored private var preparer: (any DownloadPreparing)?
    @ObservationIgnored private var manifests: [String: DownloadManifest] = [:]
    @ObservationIgnored private var inFlight: Set<DownloadTaskID> = []
    @ObservationIgnored private var unsaved: [String: Int] = [:]
    @ObservationIgnored private var pumpTask: Task<Void, Never>?
    @ObservationIgnored private var pumpRequested = false
    @ObservationIgnored private var backgroundWake = false
    @ObservationIgnored private var server: LocalMediaServer?
    @ObservationIgnored private let logger = Logger(subsystem: "com.mritd.kmtv", category: "downloads")

    /// Creates the manager and subscribes to transport events before any task can be enqueued.
    ///
    /// 创建管理器, 并在任何任务入队之前订阅传输事件.
    init(context: ModelContext, layout: DownloadLayout, transport: any DownloadTransport,
         defaults: UserDefaults = .standard, freeSpace: @escaping () -> Int64 = DownloadManager.deviceFreeSpace,
         now: @escaping () -> Date = Date.init, outstandingLimit: Int = 3000,
         network: DownloadNetworkMonitor? = nil,
         coverFetcher: @escaping @Sendable (URL) async -> Data? = DownloadManager.fetchCoverData) {
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
        transport.onEvent = { [weak self] event in await self?.process(event) }
        network?.onRestore = { [weak self] in self?.schedulePump() }
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
    var canDownload: Bool { activeScopeKey != nil && preparer != nil }

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
        let parts = key.split(separator: "/").map(String.init)
        guard parts.count == 3 else { return nil }
        let (scopeHash, showDir, episodeDir) = (parts[0], parts[1], parts[2])
        let descriptor = FetchDescriptor<DownloadEpisode>(predicate: #Predicate {
            $0.scopeHash == scopeHash && $0.showDir == showDir && $0.episodeDir == episodeDir
        })
        return try? context.fetch(descriptor).first
    }

    /// Local poster file of a show, if downloaded.
    ///
    /// 剧集的本地海报文件 (如已下载).
    func coverFileURL(for show: DownloadShow) -> URL? {
        guard !show.coverFile.isEmpty else { return nil }
        return layout.showDir(scopeHash: show.scopeHash, showDir: show.showDir).appending(path: show.coverFile)
    }

    /// Episodes downloading or queued in the active scope (the tab badge).
    ///
    /// 当前作用域中正在下载或排队的集数 (tab 角标).
    var activeEpisodeCount: Int {
        _ = changeCount
        guard let scope = activeScopeKey else { return 0 }
        return episodes(in: scope).filter { $0.state == .queued || $0.state == .downloading }.count
    }

    /// Bytes stored for a scope.
    ///
    /// 某个作用域占用的字节数.
    func usedBytes(in scopeKey: String) -> Int64 {
        episodes(in: scopeKey).reduce(0) { $0 + $1.bytes }
    }

    /// Bytes stored for every scope except one.
    ///
    /// 除指定作用域外, 其他所有作用域占用的字节数.
    func otherScopesBytes(excluding scopeKey: String?) -> Int64 {
        let all = (try? context.fetch(FetchDescriptor<DownloadEpisode>())) ?? []
        return all.filter { $0.scopeKey != scopeKey }.reduce(0) { $0 + $1.bytes }
    }

    /// Whether a scope has at least one completed episode.
    ///
    /// 某个作用域是否至少有一集已完成.
    func hasCompleted(in scopeKey: String) -> Bool {
        episodes(in: scopeKey).contains { $0.state == .completed }
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

    // MARK: - Scope

    /// Makes `scopeKey` the signed-in scope: pauses the previous one, resumes this scope's episodes
    /// paused by sign-out, reconciles tasks, and pumps.
    ///
    /// 将 `scopeKey` 设为已登录的作用域: 暂停前一个作用域, 恢复本作用域中因登出而暂停的剧集, 对账任务
    /// 并推进队列.
    func activate(scopeKey: String, preparer: any DownloadPreparing) async {
        if let previous = activeScopeKey, previous != scopeKey {
            await pauseScope(previous, reason: .signedOut)
            stopServer()
        }
        activeScopeKey = scopeKey
        self.preparer = preparer
        for ep in episodes(in: scopeKey) where ep.state == .paused && ep.pauseReason == .signedOut {
            ep.state = .queued
            ep.pauseReason = nil
        }
        saveContext()
        bump()
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

    private func coverRemoteURL(for show: DownloadShow) -> URL? {
        if !show.coverURLString.isEmpty { return URL(string: show.coverURLString) }
        guard show.cover.hasPrefix("http") else { return nil }
        return URL(string: show.cover)
    }

    /// Shows a scope offline: rows and playback only, no preparation.
    ///
    /// 以离线方式展示某个作用域: 只读数据与播放, 不做准备.
    func openOffline(scopeKey: String) {
        if activeScopeKey != scopeKey { stopServer() }
        activeScopeKey = scopeKey
        preparer = nil
        bump()
    }

    /// Signs the active scope out: its queued and downloading episodes pause with `.signedOut`.
    ///
    /// 让当前作用域登出: 其中排队与下载中的剧集以 `.signedOut` 暂停.
    func deactivate() async {
        guard let scope = activeScopeKey else { return }
        preparer = nil
        await pauseScope(scope, reason: .signedOut)
        activeScopeKey = nil
        stopServer()
        bump()
    }

    private func pauseScope(_ scopeKey: String, reason: DownloadPauseReason) async {
        let hash = DownloadPaths.scopeHash(scopeKey)
        for ep in episodes(in: scopeKey) where ep.state == .queued || ep.state == .downloading {
            ep.state = .paused
            ep.pauseReason = reason
            if let manifest = manifests[ep.episodeKey] { saveManifest(manifest, for: ep) }
        }
        saveContext()
        bump()
        inFlight = inFlight.filter { $0.scopeHash != hash }
        await transport.cancel { $0.scopeHash == hash }
    }

    // MARK: - Commands

    /// Queues episodes not already downloaded; returns how many were added.
    ///
    /// 将尚未下载的剧集加入队列; 返回新增的数量.
    @discardableResult
    func enqueue(show info: DownloadShowInfo, episodes requests: [DownloadEpisodeRequest]) throws -> Int {
        guard let scopeKey = activeScopeKey, preparer != nil else { throw DownloadEnqueueError.notSignedIn }
        guard freeSpace() >= Self.freeSpaceFloor else { throw DownloadEnqueueError.notEnoughSpace }
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
        if show.coverURLString.isEmpty, let coverURL = info.coverURL {
            show.coverURLString = coverURL.absoluteString
            saveContext()
        }
        if show.coverFile.isEmpty, let coverURL = info.coverURL {
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
        if let manifest = manifests[ep.episodeKey] { saveManifest(manifest, for: ep) }
        saveContext()
        bump()
        await cancelTasks(of: ep)
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
        inFlight = inFlight.filter { $0.episodeKey != key }
        await transport.cancel { $0.episodeKey == key }
        // A concurrent `deleteShow` or `deleteScope` may have deleted the row during the await.
        //
        // 等待期间, 并发的 `deleteShow` 或 `deleteScope` 可能已删除该行.
        guard isLive(ep) else { return }
        removeEpisodeFiles(ep)
        context.delete(ep)
        saveContext()
        if episodes(in: scopeKey, showKey: showKey).isEmpty, let show = show(scopeKey: scopeKey, showKey: showKey) {
            try? FileManager.default.removeItem(at: layout.showDir(scopeHash: show.scopeHash, showDir: show.showDir))
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

    /// Deletes every download of a scope.
    ///
    /// 删除某个作用域的所有下载.
    func deleteScope(_ scopeKey: String) async {
        let hash = DownloadPaths.scopeHash(scopeKey)
        for ep in episodes(in: scopeKey) { ep.state = .paused }
        inFlight = inFlight.filter { $0.scopeHash != hash }
        await transport.cancel { $0.scopeHash == hash }
        for ep in episodes(in: scopeKey) {
            manifests[ep.episodeKey] = nil
            unsaved[ep.episodeKey] = nil
            context.delete(ep)
        }
        for show in shows(in: scopeKey) { context.delete(show) }
        if server?.root == layout.scopeDir(hash) { stopServer() }
        try? FileManager.default.removeItem(at: layout.scopeDir(hash))
        saveContext()
        bump()
    }

    /// Deletes the downloads of every scope except one.
    ///
    /// 删除除指定作用域外所有作用域的下载.
    func deleteOtherScopes(excluding scopeKey: String?) async {
        let all = (try? context.fetch(FetchDescriptor<DownloadEpisode>())) ?? []
        for other in Set(all.map(\.scopeKey)) where other != scopeKey { await deleteScope(other) }
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
        ep.bytes = 0
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
        saveContext()
        bump()
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
        // Only tasks created under the old policy; a pump running during the await adds tasks
        // under the new one, which must survive.
        //
        // 只取消按旧策略创建的任务; 等待期间运行的队列推进会按新策略新增任务, 这些任务必须保留.
        let old = inFlight.filter { $0.scopeHash == hash }
        inFlight.subtract(old)
        await transport.cancel { old.contains($0) }
        schedulePump()
    }

    // MARK: - Playback

    /// Loopback URL of a completed episode; starts the server for the episode's scope.
    ///
    /// 已完成剧集的 loopback URL; 会为该集所属作用域启动服务.
    func localPlaybackURL(for ep: DownloadEpisode) async throws -> URL {
        let scopeDir = layout.scopeDir(ep.scopeHash)
        if server?.root != scopeDir {
            server?.stop()
            server = LocalMediaServer(root: scopeDir)
        }
        guard let server else { throw LocalMediaServerError.notReady }
        _ = try await server.start()
        guard let url = server.url(forRelativePath: "\(ep.showDir)/\(ep.episodeDir)/index.m3u8") else {
            throw LocalMediaServerError.notReady
        }
        return url
    }

    private func stopServer() {
        server?.stop()
        server = nil
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
            persistAll()
        @unknown default:
            break
        }
    }

    /// Handles a background relaunch for session events: waits for them, reconciles, pumps once,
    /// and persists.
    ///
    /// 处理因 session 事件触发的后台唤醒: 等待事件投递完毕, 对账, 推进一次队列并持久化.
    func handleBackgroundWake() async {
        await transport.waitForBackgroundEvents()
        await transport.drainEvents()
        await reconcile()
        backgroundWake = true
        schedulePump()
        await waitForIdle()
        backgroundWake = false
        persistAll()
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
        var keep: Set<DownloadTaskID> = []
        var stale: Set<DownloadTaskID> = []
        for id in await transport.outstanding() {
            if let ep = episode(forKey: id.episodeKey), ep.state == .downloading, let manifest = manifest(for: ep),
               manifest.generation == id.generation, manifest.entries.indices.contains(id.entryIndex),
               !manifest.entries[id.entryIndex].done {
                keep.insert(id)
            } else {
                stale.insert(id)
            }
        }
        // Set before the cancel await, so a pump running meanwhile keeps the tasks it adds.
        //
        // 在等待取消之前赋值, 这样期间运行的队列推进所新增的任务不会被覆盖.
        inFlight = keep
        let staleIDs = stale
        if !staleIDs.isEmpty { await transport.cancel { staleIDs.contains($0) } }
    }

    /// Returns when no pump is running.
    ///
    /// 没有正在运行的队列推进时返回.
    func waitForIdle() async {
        while let task = pumpTask { await task.value }
    }

    /// Writes cached manifests and pending row changes.
    ///
    /// 写入缓存的 manifest 与待保存的数据行变化.
    func persistAll() {
        for (key, manifest) in manifests {
            try? manifest.save(to: layout.manifestURL(episodeDir: layout.root.appending(path: key, directoryHint: .isDirectory)))
        }
        unsaved = [:]
        saveContext()
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
        for (position, ep) in candidates.enumerated() {
            guard inFlight.count < outstandingLimit, activeScopeKey == scopeKey else { return }
            // The app may have gone to the background, or a row may have been deleted, while the
            // previous episode was preparing.
            //
            // 上一集准备期间, App 可能已进入后台, 或某行可能已被删除.
            guard isForeground || backgroundWake else { return }
            guard isLive(ep) else { continue }
            let priority: Float = position < 2 ? URLSessionTask.highPriority : URLSessionTask.defaultPriority
            if ep.state == .downloading {
                if let manifest = manifest(for: ep) {
                    enqueueMissing(ep, manifest, priority: priority)
                    continue
                }
                ep.state = .queued
            }
            guard ep.state == .queued else { continue }
            let key = ep.episodeKey
            await prepare(ep, with: preparer, priority: priority)
            if self.preparer == nil || activeScopeKey != scopeKey { return }
            if let current = episode(forKey: key), current.pauseReason == .signedOut { return }
        }
    }

    private func prepare(_ ep: DownloadEpisode, with preparer: any DownloadPreparing, priority: Float) async {
        let key = ep.episodeKey
        let generation = (manifest(for: ep)?.generation ?? 0) + 1
        preparingKeys.insert(key)
        bump()
        let result: Result<DownloadManifest, Error>
        do {
            result = .success(try await preparer.prepare(episodeURL: ep.episodeURL, sourceKey: ep.sourceKey,
                                                         generation: generation))
        } catch {
            result = .failure(error)
        }
        preparingKeys.remove(key)
        bump()
        guard let current = episode(forKey: key), current.state == .queued else { return }
        switch result {
        case .success(let fresh):
            var next = fresh
            // Read after the await: a delete and re-queue meanwhile removed the old files.
            //
            // 在 await 之后读取: 期间若被删除并重新加入队列, 旧文件已被移除.
            if let existing = manifest(for: current) {
                if existing.matches(fresh) {
                    next = existing.adopting(urlsFrom: fresh)
                } else {
                    logger.info("download playlist changed, restarting episode=\(key, privacy: .public)")
                    removeEpisodeFiles(current)
                }
            }
            saveManifest(next, for: current)
            current.totalEntries = next.entries.count
            current.doneEntries = next.doneCount
            current.bytes = next.totalBytes
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
        guard room > 0 else { return }
        var requests: [DownloadTaskRequest] = []
        for entry in manifest.entries where !entry.done {
            let id = taskID(ep, generation: manifest.generation, entry: entry.index)
            guard !inFlight.contains(id) else { continue }
            requests.append(DownloadTaskRequest(id: id, url: entry.remoteURL, earliestBegin: nil, priority: priority,
                                                allowsCellular: allowsCellular))
            if requests.count >= room { break }
        }
        guard !requests.isEmpty else { return }
        transport.enqueue(requests)
        inFlight.formUnion(requests.map(\.id))
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
    }

    private func handleFinished(_ id: DownloadTaskID, _ info: DownloadResponseInfo) async {
        guard let ep = episode(forKey: id.episodeKey), ep.state == .downloading,
              var manifest = manifest(for: ep), manifest.generation == id.generation,
              manifest.entries.indices.contains(id.entryIndex), !manifest.entries[id.entryIndex].done else {
            try? FileManager.default.removeItem(at: info.file)
            return
        }
        let entry = manifest.entries[id.entryIndex]
        let outcome = DownloadEntryValidator.classify(url: info.url, status: info.status, contentType: info.contentType,
                                                      head: info.head, size: info.size, kind: entry.kind)
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
        manifest.entries[id.entryIndex].done = true
        manifest.entries[id.entryIndex].bytes = info.size
        manifests[ep.episodeKey] = manifest
        ep.doneEntries = manifest.doneCount
        ep.bytes = manifest.totalBytes
        ep.refreshCount = 0
        bump()
        if manifest.isComplete {
            await complete(ep, manifest)
            schedulePump()
            return
        }
        let pending = (unsaved[ep.episodeKey] ?? 0) + 1
        if pending >= Self.saveEvery {
            saveManifest(manifest, for: ep)
            saveContext()
        } else {
            unsaved[ep.episodeKey] = pending
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
            saveManifest(manifest, for: ep)
            guard attempts <= Self.retryDelays.count else {
                await fail(ep, failure)
                return
            }
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
        if let manifest = manifests[ep.episodeKey] { saveManifest(manifest, for: ep) }
        saveContext()
        bump()
        await cancelTasks(of: ep)
        schedulePump()
    }

    private func complete(_ ep: DownloadEpisode, _ manifest: DownloadManifest) async {
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
        try? manifest.save(to: layout.manifestURL(episodeDir: dir))
        manifests[ep.episodeKey] = nil
        unsaved[ep.episodeKey] = nil
        ep.state = .completed
        ep.completedAt = now()
        ep.totalEntries = manifest.entries.count
        ep.doneEntries = manifest.doneCount
        ep.bytes = manifest.totalBytes
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

    private func cancelTasks(of ep: DownloadEpisode) async {
        let key = ep.episodeKey
        inFlight = inFlight.filter { $0.episodeKey != key }
        await transport.cancel { $0.episodeKey == key }
    }

    private func manifest(for ep: DownloadEpisode) -> DownloadManifest? {
        if let cached = manifests[ep.episodeKey] { return cached }
        let dir = layout.episodeDir(scopeHash: ep.scopeHash, showDir: ep.showDir, episodeDir: ep.episodeDir)
        guard let loaded = DownloadManifest.load(from: layout.manifestURL(episodeDir: dir)) else { return nil }
        manifests[ep.episodeKey] = loaded
        return loaded
    }

    private func saveManifest(_ manifest: DownloadManifest, for ep: DownloadEpisode) {
        manifests[ep.episodeKey] = manifest
        unsaved[ep.episodeKey] = 0
        let dir = layout.episodeDir(scopeHash: ep.scopeHash, showDir: ep.showDir, episodeDir: ep.episodeDir)
        do {
            try manifest.save(to: layout.manifestURL(episodeDir: dir))
        } catch {
            logger.error("download manifest save failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func removeEpisodeFiles(_ ep: DownloadEpisode) {
        manifests[ep.episodeKey] = nil
        unsaved[ep.episodeKey] = nil
        try? FileManager.default.removeItem(at: layout.episodeDir(scopeHash: ep.scopeHash, showDir: ep.showDir,
                                                                  episodeDir: ep.episodeDir))
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

    private func bump() {
        changeCount &+= 1
    }
}

extension DownloadManager: DownloadScopeControlling {}

extension DownloadManager: LocalEpisodeProviding {
    func localPlaybackURL(scopeKey: String, sourceKey: String, videoId: String, episodeIndex: Int) async -> URL? {
        guard let ep = episode(scopeKey: scopeKey, sourceKey: sourceKey, videoId: videoId, episodeIndex: episodeIndex),
              ep.state == .completed else { return nil }
        return try? await localPlaybackURL(for: ep)
    }

    func reportPlaybackFailure(scopeKey: String, sourceKey: String, videoId: String, episodeIndex: Int) {
        guard let ep = episode(scopeKey: scopeKey, sourceKey: sourceKey, videoId: videoId, episodeIndex: episodeIndex),
              ep.state == .completed, !filesIntact(ep) else { return }
        markDamaged(ep)
    }
}
#endif
