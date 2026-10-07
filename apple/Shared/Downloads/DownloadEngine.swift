#if os(iOS)
import Foundation
import os
import SwiftData

/// What the engine reads from and reports to its owner, the observable `DownloadManager`: the
/// active scope and cellular setting it runs under, and the observed state it changes (structure,
/// storage, preparing keys, progress ticks).
///
/// 引擎从其持有者 (可观察的 `DownloadManager`) 读取以及向其报告的内容: 运行所依据的当前作用域与蜂窝
/// 数据设置, 以及它会改变的被观察状态 (结构, 存储占用, 正在准备的键, 进度通知).
@MainActor
protocol DownloadEngineHost: AnyObject {
    /// Scope whose downloads the engine runs.
    ///
    /// 引擎正在处理其下载的作用域.
    var activeScopeKey: String? { get }
    /// Whether new tasks may use cellular data.
    ///
    /// 新任务是否可以使用蜂窝数据.
    var allowsCellular: Bool { get }
    /// Episodes currently being prepared, by `episodeKey`.
    ///
    /// 正在准备的剧集, 以 `episodeKey` 标识.
    var preparingKeys: Set<String> { get }
    /// Marks a structural change (rows added or removed, state transitions).
    ///
    /// 标记一次结构变化 (增删数据行, 状态切换).
    func bump()
    /// Writes an episode's bytes and moves the cached storage total by the difference.
    ///
    /// 写入某集的字节数, 并按差值调整缓存的存储总量.
    func setBytes(_ ep: DownloadEpisode, _ value: Int64)
    /// Records whether an episode is being prepared.
    ///
    /// 记录某集是否正在准备.
    func setPreparing(_ key: String, _ preparing: Bool)
    /// Publishes one progress notification for the shows (by `showKey`) whose rows just caught up.
    ///
    /// 为数据行刚刚同步了进度的剧集 (以 `showKey` 标识) 发出一次进度通知.
    func progressTicked(showKeys: Set<String>)
}

/// The download engine behind `DownloadManager`: the pump and preparation, transport events with
/// retry, refresh, fail, and complete, reconcile and background wakes, and the per-episode
/// manifest cache, task ledger, and progress coalescing. It keeps no observed state; it changes
/// rows through SwiftData and reports structure, bytes, preparing keys, and ticks to its host.
///
/// `DownloadManager` 背后的下载引擎: 队列推进与准备, 传输事件及其重试, 刷新, 失败与完成, 对账与后台
/// 唤醒, 以及每集的 manifest 缓存, 任务账本与进度合并. 它不持有被观察的状态; 它通过 SwiftData 修改
/// 数据行, 并把结构, 字节数, 正在准备的键与进度通知报告给持有者.
@MainActor
final class DownloadEngine {
    /// Retry delays per attempt, refreshes allowed without progress, and finished entries between
    /// manifest saves.
    ///
    /// 每次重试的延迟, 无进展时允许的刷新次数, 以及两次保存 manifest 之间完成的条目数.
    static let retryDelays: [TimeInterval] = [30, 120, 600]
    static let refreshLimit = 2
    static let saveEvery = 20

    /// The owner the engine reports to.
    ///
    /// 引擎向其报告的持有者.
    weak var host: (any DownloadEngineHost)?
    /// The preparer of the signed-in scope; nil offline or signed out.
    ///
    /// 已登录作用域的准备器; 离线或登出时为 nil.
    var preparer: (any DownloadPreparing)?
    /// Whether the scene is active or inactive; preparation runs only then or during a background wake.
    ///
    /// 场景是否处于 active 或 inactive; 只有此时或后台唤醒期间才会做准备.
    var isForeground = true

    private let context: ModelContext
    private let layout: DownloadLayout
    private let transport: any DownloadTransport
    private let library: DownloadLibrary
    private let trash: DownloadTrash
    private let now: () -> Date
    /// Per-episode engine state by `episodeKey`; see `EpisodeRuntime`.
    ///
    /// 以 `episodeKey` 为键的每集引擎状态; 参见 `EpisodeRuntime`.
    private var runtime: [String: EpisodeRuntime] = [:]
    /// Which transport tasks the engine owns; see `DownloadTaskLedger`.
    ///
    /// 引擎持有哪些传输任务; 参见 `DownloadTaskLedger`.
    private var ledger: DownloadTaskLedger
    /// Writes manifests off the main actor; see `DownloadManifestWriter`.
    ///
    /// 在主 actor 之外写入 manifest; 参见 `DownloadManifestWriter`.
    private let manifestWriter: DownloadManifestWriter
    private var pumpTask: Task<Void, Never>?
    private var pumpRequested = false
    private var backgroundWake = false
    private var wakeDeadline: ContinuousClock.Instant?
    private let wakeBudget: Duration
    private let progressInterval: Duration
    /// Waits out one progress interval; tests replace it to fire ticks on demand.
    ///
    /// 等待一个进度间隔; 测试会替换它, 以便按需触发进度通知.
    private let progressWait: @Sendable (Duration) async -> Void
    /// The pending progress notification; nil when none is scheduled, so nothing runs while no
    /// entry finishes.
    ///
    /// 待发出的进度通知; 未安排时为 nil, 因此没有条目完成时不会运行任何任务.
    private(set) var progressTask: Task<Void, Never>?
    private let logger = Logger(subsystem: "com.mritd.kmtv", category: "downloads")

    /// Creates the engine and subscribes to transport events before any task can be enqueued.
    ///
    /// 创建引擎, 并在任何任务入队之前订阅传输事件.
    init(context: ModelContext, layout: DownloadLayout, transport: any DownloadTransport, library: DownloadLibrary,
         trash: DownloadTrash, now: @escaping () -> Date, outstandingLimit: Int, manifestWriter: DownloadManifestWriter,
         wakeBudget: Duration, progressInterval: Duration,
         progressWait: @escaping @Sendable (Duration) async -> Void) {
        self.context = context
        self.layout = layout
        self.transport = transport
        self.library = library
        self.trash = trash
        self.now = now
        ledger = DownloadTaskLedger(limit: outstandingLimit)
        self.manifestWriter = manifestWriter
        self.wakeBudget = wakeBudget
        self.progressInterval = progressInterval
        self.progressWait = progressWait
        transport.onEvent = { [weak self] event in await self?.process(event) }
    }

    /// Tasks the engine created and has not seen an event for or cancelled.
    ///
    /// 引擎已创建, 尚未收到其事件也未取消的任务.
    var inFlight: Set<DownloadTaskID> { ledger.inFlight }

    private var allowsCellular: Bool { host?.allowsCellular ?? false }

    // MARK: - Scope

    /// Pauses every queued or downloading episode of the active scope.
    ///
    /// 暂停当前作用域中所有排队或下载中的剧集.
    func pauseActiveScope(reason: DownloadPauseReason) async {
        guard let scope = host?.activeScopeKey else { return }
        await pauseScope(scope, reason: reason)
    }

    /// Pauses a scope's queued and downloading episodes with `reason`, writes their manifests, and
    /// cancels their tasks up to the generations cached before the first await.
    ///
    /// 以 `reason` 暂停某个作用域中排队与下载中的剧集, 写入其 manifest, 并取消截至第一次 await 之前
    /// 缓存的 generation 的任务.
    func pauseScope(_ scopeKey: String, reason: DownloadPauseReason) async {
        let hash = DownloadPaths.scopeHash(scopeKey)
        var generations: [String: Int] = [:]
        for ep in library.episodes(in: scopeKey) {
            generations[ep.episodeKey] = runtime[ep.episodeKey]?.manifest?.generation
            guard ep.state == .queued || ep.state == .downloading else { continue }
            ep.state = .paused
            ep.pauseReason = reason
            flushProgress(of: ep)
            saveCachedManifest(of: ep)
        }
        saveContext()
        host?.bump()
        await manifestWriter.flushAll()
        // Tasks of a newer generation come from a resume during the await; they must survive.
        //
        // 更新一代的任务来自等待期间的继续操作; 它们必须保留.
        let bound = generations
        await cancelTasks { $0.scopeHash == hash && $0.generation <= bound[$0.episodeKey] ?? .max }
    }

    /// Cancels the scope's in-flight tasks so the next pump re-creates them, for example under a
    /// new cellular policy; they stay claimed during the cancel.
    ///
    /// 取消该作用域进行中的任务, 由下一次队列推进重建, 例如按新的蜂窝数据策略; 取消期间它们保持占用.
    func cancelInFlight(scopeHash hash: String) async {
        await cancel(ledger.inFlight.filter { $0.scopeHash == hash })
    }

    // MARK: - Lifecycle

    /// Handles a background relaunch for session events; see `DownloadManager.handleBackgroundWake()`.
    ///
    /// 处理因 session 事件触发的后台唤醒; 参见 `DownloadManager.handleBackgroundWake()`.
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

    /// Requests a pump; one runs at a time and runs again while requests arrive.
    ///
    /// 请求一次队列推进; 同一时间只运行一个, 运行期间有新请求时会再运行一次.
    func schedulePump() {
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
        guard isForeground || backgroundWake, let scopeKey = host?.activeScopeKey, let preparer else { return }
        let candidates = library.episodes(in: scopeKey)
            .filter { $0.state == .queued || $0.state == .downloading }
            .sorted { $0.queueOrder < $1.queueOrder }
        await preloadManifests(of: candidates)
        guard self.preparer != nil else { return }
        for (position, ep) in candidates.enumerated() {
            guard host?.activeScopeKey == scopeKey else { return }
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
            if self.preparer == nil || host?.activeScopeKey != scopeKey { return }
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
        host?.setPreparing(key, true)
        let result: Result<DownloadManifest, Error>
        do {
            result = .success(try await preparer.prepare(episodeURL: ep.episodeURL, sourceKey: ep.sourceKey,
                                                         generation: generation))
        } catch {
            result = .failure(error)
        }
        host?.setPreparing(key, false)
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
            host?.setBytes(current, next.totalBytes)
            current.state = .downloading
            saveContext()
            host?.bump()
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
        guard host?.preparingKeys.contains(ep.episodeKey) != true else { return }
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
            await pauseActiveScope(reason: .noSpace)
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
                await pauseActiveScope(reason: .noSpace)
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
        saveCachedManifest(of: ep)
        saveContext()
        host?.bump()
        await cancelTasks(of: ep, upTo: generation)
        schedulePump()
    }

    private func fail(_ ep: DownloadEpisode, _ failure: DownloadFailure) async {
        ep.state = .failed
        ep.failure = failure
        flushProgress(of: ep)
        let generation = currentGeneration(of: ep)
        saveCachedManifest(of: ep)
        saveContext()
        host?.bump()
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
                await pauseActiveScope(reason: .noSpace)
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
        host?.setBytes(ep, manifest.totalBytes)
        ep.durationSec = manifest.totalDuration
        saveContext()
        host?.bump()
    }

    // MARK: - Episode state

    /// The generation of an episode's cached manifest, or `.max` (every generation) without one.
    ///
    /// 某集缓存 manifest 的 generation; 没有缓存时为 `.max` (即所有 generation).
    func currentGeneration(of ep: DownloadEpisode) -> Int {
        runtime[ep.episodeKey]?.manifest?.generation ?? .max
    }

    /// Queues the episode's cached manifest, if any, for the writer.
    ///
    /// 将该集缓存的 manifest (如有) 交给写入器.
    func saveCachedManifest(of ep: DownloadEpisode) {
        if let manifest = runtime[ep.episodeKey]?.manifest { saveManifest(manifest, for: ep) }
    }

    /// Clears the retry attempts of every unfinished entry and saves the manifest, so a retry starts
    /// each entry's retry budget again.
    ///
    /// 清零每个未完成条目的重试次数并保存 manifest, 重试因此为每个条目重新计算重试额度.
    func resetAttempts(of ep: DownloadEpisode) {
        guard var manifest = manifest(for: ep) else { return }
        for index in manifest.entries.indices where !manifest.entries[index].done {
            manifest.entries[index].attempts = 0
        }
        saveManifest(manifest, for: ep)
    }

    /// Returns once the episode's pending manifest write is on disk.
    ///
    /// 在该集待写入的 manifest 落盘后返回.
    func flushManifest(_ key: String) async {
        await manifestWriter.flush(key)
    }

    /// Drops pending manifest writes whose key matches, waiting out one in progress.
    ///
    /// 丢弃键匹配的待写入 manifest, 并等待正在进行的写入完成.
    func discardManifests(where predicate: @Sendable (String) -> Bool) async {
        await manifestWriter.discard(where: predicate)
    }

    /// Cancels an episode's tasks up to `generation`, captured before the caller's first await; a
    /// newer generation comes from a prepare that ran during the awaits and must survive.
    ///
    /// 取消某集截至 `generation` 的任务 (由调用方在第一次 await 之前取得); 更新一代的任务来自等待期间
    /// 完成的准备, 必须保留.
    func cancelTasks(of ep: DownloadEpisode, upTo generation: Int) async {
        let key = ep.episodeKey
        await cancelTasks { $0.episodeKey == key && $0.generation <= generation }
    }

    /// Cancels every transport task that matches `predicate`, including tasks the ledger does not
    /// know (left from an earlier launch); the in-flight ones among them stay claimed meanwhile.
    ///
    /// 取消所有满足 `predicate` 的传输任务, 包括账本不知道的任务 (之前启动遗留的); 其中进行中的任务在
    /// 取消期间保持占用.
    func cancelTasks(where predicate: @escaping @Sendable (DownloadTaskID) -> Bool) async {
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
    func forget(_ key: String, cancelWrite: Bool) {
        runtime.forget(key)
        if cancelWrite { manifestWriter.cancel(key) }
    }

    /// Copies an episode's cached manifest progress to its row, writing only changed values.
    ///
    /// 将某集缓存的 manifest 进度写入其数据行, 只写入发生变化的值.
    func flushProgress(of ep: DownloadEpisode) {
        let key = ep.episodeKey
        runtime[key]?.progressPending = false
        guard let manifest = runtime[key]?.manifest else {
            runtime.prune(key)
            return
        }
        let done = manifest.doneCount
        let bytes = manifest.totalBytes
        if ep.doneEntries != done { ep.doneEntries = done }
        host?.setBytes(ep, bytes)
    }

    /// Flushes every episode with pending progress; returns the `showKey` of each flushed episode.
    ///
    /// 写入所有有待同步进度的剧集; 返回每个已写入剧集的 `showKey`.
    @discardableResult
    private func flushAllProgress() -> Set<String> {
        var shows: Set<String> = []
        for key in runtime.takePendingProgress() {
            guard let ep = library.episode(forKey: key), isLive(ep) else { continue }
            flushProgress(of: ep)
            shows.insert(ep.showKey)
        }
        return shows
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
            self.host?.progressTicked(showKeys: shows)
        }
    }

    // MARK: - Manifests and files

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

    /// The episode's cached manifest, else the one on disk (then cached).
    ///
    /// 该集缓存的 manifest, 否则读取磁盘上的 manifest (随后缓存).
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
    func removeEpisodeFiles(_ ep: DownloadEpisode) {
        forget(ep.episodeKey, cancelWrite: true)
        trash.discard(layout.episodeDir(ep.key))
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

    /// Saves pending row changes, logging a failure.
    ///
    /// 保存待保存的数据行变化, 失败时记录日志.
    func saveContext() {
        do {
            try context.save()
        } catch {
            logger.error("download rows save failed: \(error.localizedDescription, privacy: .public)")
        }
    }
}

extension DownloadManifestWriter {
    /// The production manifest writer, which logs failed writes.
    ///
    /// 正式使用的 manifest 写入器, 会记录写入失败.
    static func logging() -> DownloadManifestWriter {
        DownloadManifestWriter(onError: { error in
            Logger(subsystem: "com.mritd.kmtv", category: "downloads")
                .error("download manifest save failed: \(error.localizedDescription, privacy: .public)")
        })
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
