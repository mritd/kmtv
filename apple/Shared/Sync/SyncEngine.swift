import Foundation
import os

/// Why a sync cycle was requested; only `.page` is throttled.
///
/// 请求同步的原因; 只有 `.page` 会被限频.
enum SyncReason: String, Sendable {
    case launch, foreground, page, player, change, retry
}

/// How the engine treats a failed request.
///
/// 引擎对失败请求的处理分类.
enum SyncErrorKind: Sendable {
    case unauthorized, conflict, retry

    /// Maps 401 to unauthorized and any HTTP 409 from push (epoch mismatch or cursor ahead) to a
    /// conflict that the following pull resolves; everything else is retried.
    ///
    /// 将 401 映射为未授权, 推送返回的任何 HTTP 409 (epoch 不一致或游标超前) 映射为冲突, 由随后的
    /// 拉取处理; 其余为重试.
    static func classify(_ error: Error) -> SyncErrorKind {
        guard let apiError = error as? APIError else { return .retry }
        switch apiError {
        case .unauthorized, .serverError(401, _, _): return .unauthorized
        case .serverError(409, _, _): return .conflict
        default: return .retry
        }
    }
}

// Aborts a cycle or flush whose engine was stopped (or stopped and started again) while a request
// was in flight.
//
// 用于中止请求进行期间引擎已被停止 (或停止后又重新启动) 的同步流程或补写.
private struct SyncEngineStopped: Error {}

/// Cancellable handle of a scheduled engine timer.
///
/// 引擎定时器的可取消句柄.
@MainActor
final class SyncTimerHandle {
    private let onCancel: () -> Void

    init(_ onCancel: @escaping () -> Void) {
        self.onCancel = onCancel
    }

    /// Cancels the timer.
    ///
    /// 取消定时器.
    func cancel() { onCancel() }
}

/// Runs `action` after `delayMs`; tests inject a manual scheduler.
///
/// 在 `delayMs` 毫秒后执行 `action`; 测试会注入手动调度器.
typealias SyncScheduler = @MainActor (_ delayMs: Int64, _ action: @escaping @MainActor @Sendable () -> Void) -> SyncTimerHandle

/// Push-then-pull sync cycles for one signed-in scope. It ports `web/src/sync/syncEngine.ts`.
///
/// 单个已登录作用域的 "先推送再拉取" 同步流程. 移植自 `web/src/sync/syncEngine.ts`.
@MainActor
final class SyncEngine {
    static let pageMinIntervalMs: Int64 = 30_000
    static let changeDebounceMs: Int64 = 2_000
    static let watchPushIntervalMs: Int64 = 30_000
    static let retryMinMs: Int64 = 2_000
    static let retryMaxMs: Int64 = 300_000
    static let pullLimit = 500
    private static let maxPushRounds = 20

    /// Called with favorites the server rejected because the cap was reached.
    ///
    /// 服务端因达到上限而拒绝收藏时调用.
    var onLimit: (([LocalRecord]) -> Void)?

    /// Called once when a request comes back unauthorized; the engine is stopped by then.
    ///
    /// 请求返回未授权时调用一次; 此时引擎已停止.
    var onUnauthorized: (() -> Void)?

    private let api: any SyncAPIProtocol
    private let store: SyncStore
    private let now: @Sendable () -> Int64
    private let schedule: SyncScheduler
    private let logger = Logger(subsystem: "com.mritd.kmtv", category: "sync")
    private var stopped = true
    // generation counts start() and stop() calls; a cycle or flush captures it when it begins and
    // abandons its work once it changes, so a late response from an earlier lifetime is ignored.
    //
    // generation 统计 start() 和 stop() 的调用次数; 同步流程和补写开始时记录它, 一旦变化就放弃
    // 后续工作, 因此上一个生命周期的迟到响应会被忽略.
    private var generation = 0
    private var running: Task<Void, Never>?
    private var flushing: Task<Void, Never>?
    private var flushingGeneration = 0
    private var flushAgain = false
    private var rerun = false
    private var lastCycleAt = Int64.min / 2
    private var lastPushAt = Int64.min / 2
    private var pushTimer: SyncTimerHandle?
    private var pushDeadline: Int64 = 0
    private var retryTimer: SyncTimerHandle?
    private var retryDelay = SyncEngine.retryMinMs
    private var pushCount = 0
    private var unsubscribe: (() -> Void)?

    /// Creates an engine that stays idle until `start()`: it sends nothing and ignores local
    /// changes. `start()` activates it (a no-op while active) and `stop()` returns it to idle. Work
    /// begun before a `stop()` never writes the store, even when `start()` follows before it ends.
    ///
    /// 创建的引擎在 `start()` 之前保持空闲: 不发送请求, 也不响应本地修改. `start()` 启用引擎
    /// (已启用时无操作), `stop()` 使其回到空闲. `stop()` 之前开始的工作不会再写入存储, 即使它
    /// 完成前又调用了 `start()`.
    init(api: any SyncAPIProtocol, store: SyncStore,
         now: @escaping @Sendable () -> Int64 = SyncClock.systemNowMs,
         schedule: @escaping SyncScheduler = SyncEngine.taskScheduler) {
        self.api = api
        self.store = store
        self.now = now
        self.schedule = schedule
    }

    /// Default scheduler backed by `Task.sleep`.
    ///
    /// 基于 `Task.sleep` 的默认调度器.
    static let taskScheduler: SyncScheduler = { delayMs, action in
        let task = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(delayMs))
            guard !Task.isCancelled else { return }
            action()
        }
        return SyncTimerHandle { task.cancel() }
    }

    /// Activates the engine; a no-op while it is active. The retry backoff starts over.
    ///
    /// 启用引擎; 已启用时无操作. 重试退避从头开始.
    func start() {
        guard stopped else { return }
        stopped = false
        generation += 1
        retryDelay = Self.retryMinMs
        unsubscribe = store.onLocalChange { [weak self] kind in self?.schedulePush(kind) }
    }

    /// Returns the engine to idle and cancels its timers.
    ///
    /// 使引擎回到空闲并取消其定时器.
    func stop() {
        stopped = true
        generation += 1
        pushTimer?.cancel()
        retryTimer?.cancel()
        pushTimer = nil
        retryTimer = nil
        unsubscribe?()
        unsubscribe = nil
    }

    private func schedulePush(_ kind: SyncKind) {
        // A pending retry pushes this change too; a debounce timer would only bypass the backoff.
        //
        // 等待中的重试也会推送这次修改; 再设防抖定时器只会绕过退避.
        guard !stopped, retryTimer == nil else { return }
        let delay = kind == .watch
            ? max(Self.changeDebounceMs, lastPushAt + Self.watchPushIntervalMs - now())
            : Self.changeDebounceMs
        let deadline = now() + delay
        if pushTimer != nil {
            if pushDeadline <= deadline { return }
            pushTimer?.cancel()
        }
        pushDeadline = deadline
        pushTimer = schedule(delay) { [weak self] in
            guard let self else { return }
            self.pushTimer = nil
            Task { await self.requestSync(.change) }
        }
    }

    /// Runs a cycle, or joins the running one and asks for one more pass afterwards.
    ///
    /// 运行一轮同步; 若已有一轮在运行则等待它, 并在结束后再执行一轮.
    func requestSync(_ reason: SyncReason) async {
        guard !stopped else { return }
        // A page entry joins a running cycle instead of queueing another one.
        //
        // 页面进入时若已有同步在运行, 直接复用它, 不再排队新的一轮.
        if reason == .page, running != nil || now() - lastCycleAt < Self.pageMinIntervalMs {
            await running?.value
            return
        }
        if let running {
            rerun = true
            await running.value
            return
        }
        let task = Task { @MainActor [weak self] in
            guard let self else { return }
            repeat {
                self.rerun = false
                await self.cycle()
            } while self.rerun && !self.stopped
            self.running = nil
        }
        running = task
        await task.value
    }

    /// Requests a sync and returns when it finishes or `timeout` passes, whichever is first.
    ///
    /// 请求一次同步, 在同步完成或超时之后返回, 以先到者为准.
    func requestSync(_ reason: SyncReason, waitingAtMost timeout: Duration) async {
        let once = SyncOnce()
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            Task { @MainActor in
                await self.requestSync(reason)
                once.run { continuation.resume() }
            }
            Task { @MainActor in
                try? await Task.sleep(for: timeout)
                once.run { continuation.resume() }
            }
        }
    }

    /// Pushes pending changes now, outside the cycle, before the app leaves the foreground. It is
    /// single-flight: a flush requested while one runs shares its result. A conflict means the server
    /// reset or was restored; the flush then runs a full cycle and returns when it ends.
    ///
    /// 在应用离开前台前立即推送待同步的修改, 不经过完整同步流程. 同一时间只运行一次: 运行期间
    /// 再次请求会共享当前结果. 冲突说明服务端被重置或从旧副本恢复, 此时补写会运行完整的一轮同步,
    /// 并在其结束后返回.
    ///
    /// A joined request may carry a record written after the running flush collected its last batch,
    /// and it cancelled that record's push timer. The shared flush therefore pushes once more before
    /// it settles. After a failure the pending retry pushes the record instead, so the backoff holds.
    ///
    /// 加入的请求可能带有正在进行的补写收集最后一批之后才写入的记录, 且它已取消该记录的推送
    /// 定时器. 因此共享的补写在结束前会再推送一次. 失败后改由等待中的重试推送, 保持退避不变.
    func flushNow() async {
        guard !stopped else { return }
        pushTimer?.cancel()
        pushTimer = nil
        // A flush from an earlier lifetime was abandoned; it cannot carry this request.
        //
        // 上一个生命周期的补写已被放弃, 不能代替本次请求.
        if let flushing, flushingGeneration == generation {
            flushAgain = true
            await flushing.value
            return
        }
        let started = generation
        flushingGeneration = started
        let task = Task { @MainActor [weak self] in
            guard let self else { return }
            repeat {
                self.flushAgain = false
                await self.flush()
            } while self.flushAgain && !self.isStale(started) && self.retryTimer == nil
            // A newer lifetime may have started its own flush meanwhile; leave that one in place.
            //
            // 期间新的生命周期可能已开始自己的补写; 保留那一个.
            if self.flushingGeneration == started { self.flushing = nil }
        }
        flushing = task
        await task.value
    }

    private func flush() async {
        let started = generation
        let pushesBefore = pushCount
        do {
            // A conflict means the server reset or was restored; only a full cycle can resolve it,
            // and the flush waits for it so a caller (logout, a source switch) knows the data left.
            //
            // 冲突说明服务端被重置或从旧副本恢复, 只有完整的一轮同步能处理; 补写会等待这一轮,
            // 让调用方 (退出登录, 切换来源) 知道数据已经发出.
            if try await !pushPending(started) {
                await requestSync(.retry)
                return
            }
            // A push went through, so the server is reachable again: run the pending retry now
            // instead of waiting out its backoff. A flush with nothing to push proves nothing and
            // leaves it.
            //
            // 推送成功说明服务端已恢复可达: 立即执行等待中的重试, 不再等待退避. 没有内容可推送的
            // 补写无法说明这一点, 保持重试不变.
            if retryTimer != nil, pushCount != pushesBefore {
                retryTimer?.cancel()
                retryTimer = nil
                retryDelay = Self.retryMinMs
                Task { await self.requestSync(.retry) }
            }
        } catch {
            handle(error, started)
        }
    }

    private func isStale(_ started: Int) -> Bool {
        stopped || started != generation
    }

    private func checkStopped(_ started: Int) throws {
        if isStale(started) { throw SyncEngineStopped() }
    }

    private func handle(_ error: Error, _ started: Int) {
        guard !isStale(started) else { return }
        if SyncErrorKind.classify(error) == .unauthorized {
            stop()
            onUnauthorized?()
            return
        }
        logger.warning("sync failed, retrying: \(error.localizedDescription, privacy: .public)")
        retryTimer?.cancel()
        let delay = retryDelay
        retryDelay = min(retryDelay * 2, Self.retryMaxMs)
        retryTimer = schedule(delay) { [weak self] in
            guard let self else { return }
            self.retryTimer = nil
            Task { await self.requestSync(.retry) }
        }
    }

    // pushPending returns false on a conflict (new epoch, or a cursor ahead of a restored server);
    // the following pull then reports the reset.
    //
    // 冲突 (新 epoch, 或游标超前于已恢复的服务端) 时 pushPending 返回 false; 随后的拉取会报告重置.
    private func pushPending(_ started: Int) async throws -> Bool {
        for _ in 0..<Self.maxPushRounds {
            let state = store.state
            let batch = SyncMerge.collectChanges(state)
            guard !batch.changes.isEmpty else { return true }
            let sentAt = now()
            let response: SyncPushResponse
            do {
                response = try await api.syncPush(SyncPushRequest(epoch: state.epoch, cursor: state.cursor,
                                                                  changes: batch.changes))
            } catch {
                try checkStopped(started)
                if SyncErrorKind.classify(error) == .conflict { return false }
                throw error
            }
            try checkStopped(started)
            store.clock.observe(serverTimeMs: response.serverTimeMs, sentAtMs: sentAt, receivedAtMs: now())
            var rejected: [LocalRecord] = []
            var invalid: [SyncMerge.PushInvalid] = []
            store.update { state in
                let outcome = SyncMerge.applyPushResults(state, batch: batch, response: response)
                rejected = outcome.rejected
                invalid = outcome.invalid
                var next = outcome.state
                next.clockOffsetMs = store.clock.offsetMs
                return next
            }
            lastPushAt = now()
            pushCount += 1
            for item in invalid {
                let kind = item.record.kind.rawValue
                logger.warning("sync change rejected as invalid: \(kind, privacy: .public) \(item.record.key) \(item.reason, privacy: .public)")
            }
            if !rejected.isEmpty { onLimit?(rejected) }
        }
        return true
    }

    // pullAll returns false after the server lost data this device has (a new epoch, or a same-epoch
    // reset whose rev is below the cursor: a restore from an older copy); the records are re-marked
    // and the cycle pushes them. Any other same-epoch reset is a full resync that may drop unseen
    // records; a first pull from cursor 0 must keep records this device just pushed.
    //
    // 服务端丢失本设备已有数据时 (新 epoch, 或同 epoch 且 rev 低于游标的 reset, 即从旧副本恢复),
    // pullAll 重新标记记录并返回 false, 由本轮流程推送. 其他同 epoch 的 reset 是可以删除未出现记录
    // 的全量重同步; 从游标 0 开始的首次拉取必须保留本设备刚推送的记录.
    //
    // A full resync keeps its cursor in memory and saves it only together with finishFullResync. If a
    // later page fails, the saved cursor stays below min_rev, so the next cycle is reset again and
    // redoes the whole resync; records merged from earlier pages stay, because merging is idempotent.
    //
    // 全量重同步的游标只保存在内存中, 与 finishFullResync 一起写入. 如果后续某页失败, 已保存的
    // 游标仍低于 min_rev, 下一轮会再次收到 reset 并重做整个全量重同步; 之前页面合并的记录保留,
    // 因为合并是幂等的.
    private func pullAll(_ started: Int) async throws -> Bool {
        var seen = Set<String>()
        var full = false
        var fullCursor: Int64 = 0
        var resets = 0
        // A chain that starts at revision 0 asks the server not to answer with a reset for a cursor
        // below its purge floor; it stays set for every later page of that chain.
        //
        // 从版本 0 开始的拉取链会要求服务端, 不要因为游标低于其清理下限而返回 reset; 该标志对
        // 这条链之后的每一页都保持有效.
        let fromZero = store.state.cursor == 0
        while true {
            let state = store.state
            let since = full ? fullCursor : state.cursor
            let sentAt = now()
            let page = try await api.syncPull(since: since, epoch: state.epoch, limit: Self.pullLimit,
                                            full: fromZero || full)
            try checkStopped(started)
            store.clock.observe(serverTimeMs: page.serverTimeMs, sentAtMs: sentAt, receivedAtMs: now())
            if page.reset {
                if !state.epoch.isEmpty && page.epoch != state.epoch {
                    store.update { SyncMerge.resetForNewEpoch($0, epoch: page.epoch, username: store.username) }
                    return false
                }
                if page.rev < state.cursor {
                    store.update { SyncMerge.resetForNewEpoch($0, epoch: $0.epoch, username: store.username) }
                    return false
                }
                resets += 1
                if resets > 1 { throw URLError(.badServerResponse) }
                seen = []
                full = true
                fullCursor = 0
                continue
            }
            store.update { current in
                var next = SyncMerge.applyPullPage(current, page: page, seen: &seen)
                if full { next.cursor = current.cursor }
                next.username = store.username
                next.clockOffsetMs = store.clock.offsetMs
                return next
            }
            if full { fullCursor = page.rev }
            if !page.hasMore { break }
        }
        if full {
            store.update { current in
                var next = SyncMerge.finishFullResync(current, seen: seen)
                next.cursor = fullCursor
                return next
            }
        }
        return true
    }

    private func cycle() async {
        // A cycle runs in its own task or as a rerun, so it may begin after stop().
        //
        // 同步流程在独立任务中运行或作为追加的一轮运行, 因此可能在 stop() 之后才开始.
        guard !stopped else { return }
        let started = generation
        retryTimer?.cancel()
        retryTimer = nil
        do {
            for _ in 0..<3 {
                let pushed = try await pushPending(started)
                let pulled = try await pullAll(started)
                if pushed && pulled { break }
            }
            lastCycleAt = now()
            retryDelay = Self.retryMinMs
        } catch {
            handle(error, started)
        }
    }
}

/// Runs a body at most once; used to resume a continuation from two racing tasks.
///
/// 最多执行一次; 用于在两个竞争的任务中只恢复一次 continuation.
@MainActor
private final class SyncOnce {
    private var done = false

    func run(_ body: () -> Void) {
        guard !done else { return }
        done = true
        body()
    }
}
