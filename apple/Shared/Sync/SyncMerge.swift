import Foundation

/// Pure state transitions for the client side of the sync protocol. It ports
/// `web/src/sync/syncMerge.ts` and mirrors `simDevice` in `server/internal/handler/sync_e2e_test.go`;
/// keep all three in step.
///
/// 同步协议客户端部分的纯状态转换. 移植自 `web/src/sync/syncMerge.ts`, 与
/// `server/internal/handler/sync_e2e_test.go` 中的 `simDevice` 一致; 三处需同步修改.
enum SyncMerge {
    /// Most changes sent in one push request.
    ///
    /// 一次推送请求最多携带的变更数.
    static let pushBatch = 200

    /// Most encoded change bytes in one push, below the server's 256 KiB body limit.
    ///
    /// 一次推送中变更编码后的最大字节数, 低于服务端 256 KiB 的请求体上限.
    static let pushMaxBytes = 192 * 1024

    /// A change the server refused as invalid, kept for diagnostics.
    ///
    /// 被服务端判定为无效的变更, 保留用于诊断.
    struct PushInvalid: Equatable, Sendable {
        let record: LocalRecord
        let reason: String
    }

    /// Pushed changes paired with the local record IDs they came from (nil for clears).
    ///
    /// 推送的变更与其来源的本地记录 ID (清空操作为 nil).
    struct PushBatch: Equatable, Sendable {
        var changes: [SyncChangeWire] = []
        var targets: [String?] = []
    }

    /// Newest first, then by key in UTF-8 byte order, matching the server's trim order.
    ///
    /// 最新优先, 再按 key 的 UTF-8 字节序, 与服务端的淘汰顺序一致.
    static func compare(_ a: LocalRecord, _ b: LocalRecord) -> Bool {
        if a.eventTimeMs != b.eventTimeMs { return a.eventTimeMs > b.eventTimeMs }
        return a.key.utf8.lexicographicallyPrecedes(b.key.utf8)
    }

    /// Non-deleted records of one kind, newest first.
    ///
    /// 某类数据中未删除的记录, 最新的在前.
    static func listLive(_ state: SyncState, kind: SyncKind) -> [LocalRecord] {
        state.records.values.filter { $0.kind == kind && !$0.deleted }.sorted(by: compare)
    }

    /// Trims kinds with a cap down to their newest records.
    ///
    /// 将有上限的数据类型裁剪为最新的若干条.
    static func applyCaps(_ state: SyncState) -> SyncState {
        var next = state
        for kind in SyncKind.allCases {
            guard let cap = kind.cap else { continue }
            let live = listLive(next, kind: kind)
            guard live.count > cap else { continue }
            for record in live[cap...] { next.records.removeValue(forKey: record.id) }
        }
        return next
    }

    /// Next push batch: pending clears first, then dirty records (oldest first unless
    /// `newestFirst`). The batch stops at `limit` changes or `maxBytes` of encoded changes; the
    /// first change is always taken so one large record cannot block the queue.
    ///
    /// 下一批推送: 先待推送的清空, 再是待推送记录 (默认从旧到新, `newestFirst` 时从新到旧).
    /// 达到 `limit` 条或变更编码达到 `maxBytes` 时停止; 第一条总会放入, 单条大记录不会卡住队列.
    static func collectChanges(_ state: SyncState, limit: Int = pushBatch, maxBytes: Int = pushMaxBytes,
                               newestFirst: Bool = false) -> PushBatch {
        var batch = PushBatch()
        var bytes = 0
        let encoder = JSONEncoder()
        encoder.outputFormatting = .withoutEscapingSlashes
        func take(_ change: SyncChangeWire, _ target: String?) -> Bool {
            guard batch.changes.count < limit else { return false }
            let size = ((try? encoder.encode(change))?.count ?? maxBytes) + 1
            if !batch.changes.isEmpty && bytes + size > maxBytes { return false }
            bytes += size
            batch.changes.append(change)
            batch.targets.append(target)
            return true
        }
        for kind in SyncKind.allCases {
            guard let clearedAt = state.pendingClears[kind] else { continue }
            let change = SyncChangeWire(kind: kind, op: .clear, key: nil, payload: nil, eventTimeMs: clearedAt)
            if !take(change, nil) { return batch }
        }
        let dirty = state.records.filter { $0.value.dirty }.sorted { a, b in
            if a.value.eventTimeMs != b.value.eventTimeMs {
                return newestFirst ? a.value.eventTimeMs > b.value.eventTimeMs : a.value.eventTimeMs < b.value.eventTimeMs
            }
            return a.key.utf8.lexicographicallyPrecedes(b.key.utf8)
        }
        for (id, record) in dirty {
            let change = record.deleted
                ? SyncChangeWire(kind: record.kind, op: .delete, key: record.key, payload: nil,
                                 eventTimeMs: record.eventTimeMs)
                : SyncChangeWire(kind: record.kind, op: .upsert, key: nil, payload: record.payload,
                                 eventTimeMs: record.eventTimeMs)
            if !take(change, id) { break }
        }
        return batch
    }

    private static func fromWire(_ remote: SyncRecordWire) -> LocalRecord? {
        guard let payload = remote.payload else { return nil }
        return LocalRecord(payload: payload, key: remote.key, eventTimeMs: remote.eventTimeMs,
                           deleted: false, dirty: false, synced: true)
    }

    private static func adopt(_ records: inout [String: LocalRecord], id: String, remote: SyncRecordWire?) {
        records.removeValue(forKey: id)
        guard let remote, let kind = remote.kind else { return }
        let remoteID = syncRecordID(kind, remote.key)
        if remote.deleted {
            records.removeValue(forKey: remoteID)
            return
        }
        if let record = fromWire(remote) { records[remoteID] = record }
    }

    /// Applies per-change push outcomes. It returns favorites rejected by the cap and changes the
    /// server refused as invalid; the engine logs the latter.
    ///
    /// 应用逐条推送结果. 返回因上限被拒绝的收藏, 以及被服务端判定为无效的变更; 后者由引擎记录日志.
    static func applyPushResults(_ state: SyncState, batch: PushBatch, response: SyncPushResponse)
        -> (state: SyncState, rejected: [LocalRecord], invalid: [PushInvalid]) {
        var records = state.records
        var pendingClears = state.pendingClears
        var rejected: [LocalRecord] = []
        var invalid: [PushInvalid] = []
        for result in response.results {
            guard batch.changes.indices.contains(result.index) else { continue }
            let change = batch.changes[result.index]
            if change.op == .clear {
                if pendingClears[change.kind] == change.eventTimeMs { pendingClears.removeValue(forKey: change.kind) }
                continue
            }
            guard let id = batch.targets[result.index], let local = records[id],
                  local.eventTimeMs == change.eventTimeMs else { continue }
            switch result.status {
            case .applied:
                if local.deleted {
                    records.removeValue(forKey: id)
                } else if let remote = result.record {
                    records.removeValue(forKey: id)
                    var acknowledged = local
                    acknowledged.key = remote.key
                    acknowledged.eventTimeMs = remote.eventTimeMs
                    acknowledged.dirty = false
                    acknowledged.synced = true
                    records[acknowledged.id] = acknowledged
                } else {
                    var acknowledged = local
                    acknowledged.dirty = false
                    acknowledged.synced = true
                    records[id] = acknowledged
                }
            case .stale:
                adopt(&records, id: id, remote: result.record)
            case .invalid:
                var kept = local
                kept.dirty = false
                records[id] = kept
                invalid.append(PushInvalid(record: local, reason: result.reason ?? ""))
            case .limit:
                records.removeValue(forKey: id)
                rejected.append(local)
            case .unknown:
                continue
            }
        }
        var next = state
        next.epoch = response.epoch.isEmpty ? state.epoch : response.epoch
        next.records = records
        next.pendingClears = pendingClears
        return (applyCaps(next), rejected, invalid)
    }

    /// Merges one pull page, clears first, then records. Live remote IDs are added to `seen`.
    /// Remote records at or before a pending local clear of their kind are skipped: the clear has
    /// not reached the server yet, but it already removed them here.
    ///
    /// 合并一页拉取结果: 先清空再记录. 远端有效记录的 ID 会加入 seen. 时间不晚于本地待推送清空的
    /// 远端记录会被跳过: 清空尚未到达服务端, 但本地已经删除了它们.
    static func applyPullPage(_ state: SyncState, page: SyncPullResponse, seen: inout Set<String>) -> SyncState {
        var records = state.records
        for clear in page.clears {
            guard let kind = clear.kind else { continue }
            records = records.filter { !($0.value.kind == kind && $0.value.eventTimeMs <= clear.clearedAtMs) }
        }
        for remote in page.records {
            guard let kind = remote.kind else { continue }
            if let pendingClear = state.pendingClears[kind], remote.eventTimeMs <= pendingClear { continue }
            let id = syncRecordID(kind, remote.key)
            if !remote.deleted { seen.insert(id) }
            guard let local = records[id] else {
                if !remote.deleted, let record = fromWire(remote) { records[id] = record }
                continue
            }
            if !local.dirty || remote.eventTimeMs > local.eventTimeMs {
                adopt(&records, id: id, remote: remote)
            }
        }
        var next = state
        next.epoch = page.epoch
        next.cursor = page.rev
        next.records = records
        return applyCaps(next)
    }

    /// Drops synced, clean records that a full pull from revision 0 did not return.
    ///
    /// 删除从版本 0 全量拉取后未出现的, 已同步且无本地修改的记录.
    static func finishFullResync(_ state: SyncState, seen: Set<String>) -> SyncState {
        var next = state
        next.records = state.records.filter { !($0.value.synced && !$0.value.dirty && !seen.contains($0.key)) }
        return next
    }

    /// Marks every record for upload and restarts pulling from revision 0. It serves a server that
    /// lost data this device has: a new epoch, or a restore from an older copy (a reset whose rev
    /// is below the local cursor).
    ///
    /// 把所有记录标记为待上传, 并从版本 0 重新拉取. 用于服务端丢失了本设备已有数据的情况:
    /// 新 epoch, 或从旧副本恢复 (reset 返回的 rev 低于本地游标).
    static func markForReupload(_ state: SyncState) -> SyncState {
        var next = state
        next.cursor = 0
        next.records = state.records.mapValues { record in
            var marked = record
            marked.dirty = true
            marked.synced = false
            return marked
        }
        return next
    }

    /// Whether a reset drops the scope's data: it was saved under another, non-empty username, so
    /// the user ID was reused by someone else.
    ///
    /// 重置是否会丢弃作用域的数据: 数据保存在另一个非空用户名下, 说明该用户 ID 已被他人复用.
    static func dropsData(_ state: SyncState, username: String) -> Bool {
        !state.username.isEmpty && state.username != username
    }

    /// Handles a server that lost data this device has: a new epoch, or a same-epoch restore from an
    /// older copy (pass the current epoch). If the local data belongs to another username, the user
    /// ID was reused by someone else and the data is dropped, keeping the clock offset and epoch.
    /// Otherwise every record is marked for re-upload.
    ///
    /// 处理服务端丢失本设备已有数据的情况: 新 epoch, 或同 epoch 下从旧副本恢复 (传入当前 epoch).
    /// 如果本地数据属于其他用户名, 说明该用户 ID 已被他人复用, 本地数据会被丢弃, 仅保留时钟偏移
    /// 与 epoch. 否则所有记录都标记为需要重新上传.
    static func resetForServerLoss(_ state: SyncState, epoch: String, username: String) -> SyncState {
        if dropsData(state, username: username) {
            return SyncState(username: username, epoch: epoch, clockOffsetMs: state.clockOffsetMs)
        }
        var next = markForReupload(state)
        next.username = username
        next.epoch = epoch
        return next
    }
}
