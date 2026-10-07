import Foundation

/// Which transport tasks the download engine owns. A claimed ID is either in flight (the engine
/// created the task and waits for its event) or being cancelled; a claimed ID is never created
/// again, so a cancel cannot kill a task re-created while it runs. Running reconciles record every
/// ID cancelled during their await, so they never adopt one from their older snapshot. A value
/// type with no transport or storage, so its rules test on their own.
///
/// 下载引擎持有哪些传输任务. 被占用的 ID 要么处于进行中 (引擎已创建任务并等待其事件), 要么正在取消;
/// 被占用的 ID 不会被再次创建, 因此取消不会误杀在其执行期间重建的任务. 进行中的对账会记录其等待期间
/// 被取消的每个 ID, 因此不会从较旧的快照中重新接管它们. 这是一个不依赖传输层与存储的值类型, 其规则
/// 可以单独测试.
struct DownloadTaskLedger {
    /// A reconcile in progress: the in-flight set when it started, and its slot for IDs cancelled
    /// meanwhile.
    ///
    /// 一次进行中的对账: 开始时的进行中集合, 以及记录期间被取消 ID 的位置.
    struct ReconcileToken {
        fileprivate let id = UUID()
        fileprivate let before: Set<DownloadTaskID>
    }

    /// Most tasks in flight at once.
    ///
    /// 同时进行中的任务数上限.
    let limit: Int
    /// Tasks the engine created and has not seen an event for or cancelled.
    ///
    /// 引擎已创建, 尚未收到其事件也未取消的任务.
    private(set) var inFlight: Set<DownloadTaskID> = []
    /// IDs being cancelled, counted per pending cancel.
    ///
    /// 正在取消的 ID, 按未完成的取消次数计数.
    private var cancelling: [DownloadTaskID: Int] = [:]
    /// IDs cancelled while each running reconcile awaited the transport.
    ///
    /// 每个进行中的对账等待传输层期间被取消的 ID.
    private var cancelledDuringReconcile: [UUID: Set<DownloadTaskID>] = [:]
    /// Whether a pump stopped at `limit` with entries left; see `takeRefill()`.
    ///
    /// 队列推进是否因达到 `limit` 而停下且仍有条目; 参见 `takeRefill()`.
    private(set) var starved = false

    init(limit: Int) {
        self.limit = limit
    }

    /// Free slots below `limit`.
    ///
    /// `limit` 以下的空位数.
    var room: Int { limit - inFlight.count }

    /// Whether another task fits under `limit`.
    ///
    /// 是否还能在 `limit` 以下再容纳一个任务.
    func hasRoom() -> Bool { inFlight.count < limit }

    /// Whether `id` is being cancelled.
    ///
    /// `id` 是否正在取消.
    func isCancelling(_ id: DownloadTaskID) -> Bool { cancelling[id] != nil }

    /// Whether `id` is in flight or being cancelled, so it must not be created now.
    ///
    /// `id` 是否处于进行中或正在取消, 因此此时不能创建它.
    func isClaimed(_ id: DownloadTaskID) -> Bool { inFlight.contains(id) || cancelling[id] != nil }

    /// Records tasks just created.
    ///
    /// 记录刚创建的任务.
    mutating func claim(_ ids: some Sequence<DownloadTaskID>) {
        inFlight.formUnion(ids)
    }

    /// Forgets a task whose event arrived.
    ///
    /// 遗忘已收到事件的任务.
    mutating func release(_ id: DownloadTaskID) {
        inFlight.remove(id)
    }

    /// Starts cancelling `ids`, in flight or not: they stay claimed until `endCancel(ids)` and are
    /// recorded for every running reconcile. With `freeingRoom` they leave the in-flight set now, so
    /// the pump may refill at once (a pause or delete of a whole generation); without it they keep
    /// their room until the cancel ends (the cellular toggle, stale tasks), so the transport never
    /// holds more than the limit while the cancel runs.
    ///
    /// 开始取消 `ids` (无论是否处于进行中): 它们在 `endCancel(ids)` 之前保持占用, 并记录到每个进行中
    /// 的对账. 设置 `freeingRoom` 时它们立即离开进行中集合, 队列推进可以马上补充 (暂停或删除整代任务);
    /// 否则在取消结束前继续占用名额 (切换蜂窝网络设置, 过期任务), 使取消期间传输层的任务数不超过上限.
    mutating func beginCancel(_ ids: Set<DownloadTaskID>, freeingRoom: Bool = true) {
        for id in ids { cancelling[id, default: 0] += 1 }
        for watch in cancelledDuringReconcile.keys { cancelledDuringReconcile[watch]?.formUnion(ids) }
        if freeingRoom { inFlight.subtract(ids) }
    }

    /// Ends a cancel started by `beginCancel`: releases its claims and drops any of the IDs a
    /// reconcile adopted meanwhile, since the transport no longer has them.
    ///
    /// 结束由 `beginCancel` 开始的取消: 释放其占用, 并丢弃期间被对账接管的这些 ID, 因为传输层已不再
    /// 持有它们.
    mutating func endCancel(_ ids: Set<DownloadTaskID>) {
        for id in ids {
            let count = (cancelling[id] ?? 1) - 1
            cancelling[id] = count > 0 ? count : nil
        }
        inFlight.subtract(ids)
    }

    /// Starts a reconcile; call before awaiting the transport's outstanding tasks.
    ///
    /// 开始一次对账; 在等待传输层的未完成任务之前调用.
    mutating func beginReconcile() -> ReconcileToken {
        let token = ReconcileToken(before: inFlight)
        cancelledDuringReconcile[token.id] = []
        return token
    }

    /// Ends a reconcile with the transport's `outstanding` tasks. IDs cancelled during the await
    /// are skipped. Of the rest, `isCurrent` ones are kept and the others returned as stale for
    /// the caller to cancel. The in-flight set merges rather than overwrites: tasks claimed during
    /// the await stay, claims from before the await that the transport no longer has are dropped,
    /// except IDs cancelled meanwhile, whose claim now belongs to a task re-created since.
    ///
    /// 用传输层的 `outstanding` 任务结束一次对账. 等待期间被取消的 ID 会被跳过. 其余的 ID 中,
    /// `isCurrent` 为真的保留, 其他的作为过期任务返回, 由调用方取消. 进行中集合采用合并而非覆盖: 等待
    /// 期间占用的任务保留, 等待之前的占用若已不在传输层中则被丢弃; 但期间被取消的 ID 除外, 对它们的
    /// 占用此时属于之后重建的任务.
    mutating func mergeReconcile(_ token: ReconcileToken, outstanding: [DownloadTaskID],
                                 isCurrent: (DownloadTaskID) -> Bool) -> Set<DownloadTaskID> {
        let cancelledMeanwhile = cancelledDuringReconcile.removeValue(forKey: token.id) ?? []
        var keep: Set<DownloadTaskID> = []
        var stale: Set<DownloadTaskID> = []
        for id in outstanding where !cancelledMeanwhile.contains(id) {
            if isCurrent(id) {
                keep.insert(id)
            } else {
                stale.insert(id)
            }
        }
        inFlight = keep.union(inFlight.subtracting(token.before.subtracting(cancelledMeanwhile)))
        return stale
    }

    /// Notes that a pump stopped at `limit` with entries left.
    ///
    /// 记录队列推进因达到 `limit` 而停下且仍有条目.
    mutating func markStarved() {
        starved = true
    }

    /// Free slots that make a starved queue pump again: a tenth of the limit, at least one, so a
    /// long episode refills in batches instead of once per finished entry.
    ///
    /// 让受限队列再次推进所需的空位数: 上限的十分之一, 至少为一, 因此长剧集按批补充, 而不是每完成一个
    /// 条目就推进一次.
    var refillBatch: Int { max(1, limit / 10) }

    /// Whether a starved queue now has `refillBatch` free slots; clears the starved flag when so.
    ///
    /// 受限队列此时是否有 `refillBatch` 个空位; 若有则清除受限标记.
    mutating func takeRefill() -> Bool {
        guard starved, inFlight.count <= limit - refillBatch else { return false }
        starved = false
        return true
    }
}
