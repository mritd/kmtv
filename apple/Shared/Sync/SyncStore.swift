import Foundation
import Observation
import os
import SwiftData

/// Storage scope of one server and user; anonymous is user 0. The server URL is normalized like
/// Android's `syncServerKey` (trimmed, trailing slashes dropped, lowercased), so "https://X/" and
/// "https://x" share one scope instead of stranding dirty records in the other.
///
/// 某个服务器与用户的存储作用域; 匿名用户为 0. 服务器 URL 按 Android 的 `syncServerKey` 规范化
/// (去首尾空白, 去掉末尾斜杠, 转小写), 使 "https://X/" 与 "https://x" 共用一个作用域,
/// 避免未推送的记录滞留在另一个作用域中.
func syncScopeKey(serverURL: String, userID: Int64) -> String {
    var server = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
    while server.hasSuffix("/") { server.removeLast() }
    return "kmtv.sync.v1:\(server.lowercased()):\(max(0, userID))"
}

/// The only place screens read and write synchronized data. State lives in memory and every
/// change is written through to SwiftData as a row diff.
///
/// 页面读写同步数据的唯一入口. 状态保存在内存中, 每次变更都以行级差异写入 SwiftData.
@Observable
@MainActor
final class SyncStore {
    let scopeKey: String
    /// Current username of the scope's user; `state.username` is the name the data was saved under.
    ///
    /// 该作用域用户当前的用户名; `state.username` 是数据保存时的用户名.
    let username: String
    let clock: SyncClock
    private(set) var state: SyncState

    private let context: ModelContext
    private let scopeRow: SyncScopeState
    @ObservationIgnored private var rows: [String: SyncRecord]
    @ObservationIgnored private var localListeners: [UUID: (SyncKind) -> Void] = [:]
    private let logger = Logger(subsystem: "com.mritd.kmtv", category: "sync")

    /// Opens a scope. State saved under an older username is kept (a rename); the engine drops it
    /// only when the server epoch changes too (see `SyncMerge.resetForNewEpoch`).
    ///
    /// 打开一个作用域. 旧用户名下保存的状态会保留 (改名); 只有服务端 epoch 也变化时引擎才会丢弃它
    /// (见 `SyncMerge.resetForNewEpoch`).
    init(context: ModelContext, serverURL: String, userID: Int64, username: String, clock: SyncClock? = nil) {
        let scopeKey = syncScopeKey(serverURL: serverURL, userID: userID)
        let scopeRow = Self.openScope(context: context, scopeKey: scopeKey, username: username)
        var rows: [String: SyncRecord] = [:]
        var records: [String: LocalRecord] = [:]
        let descriptor = FetchDescriptor<SyncRecord>(predicate: #Predicate { $0.scopeKey == scopeKey })
        for row in (try? context.fetch(descriptor)) ?? [] {
            guard let record = row.localRecord else {
                context.delete(row)
                continue
            }
            rows[record.id] = row
            records[record.id] = record
        }
        self.scopeKey = scopeKey
        self.username = username
        self.context = context
        self.scopeRow = scopeRow
        self.rows = rows
        self.clock = clock ?? SyncClock(offsetMs: scopeRow.clockOffsetMs)
        self.state = SyncState(username: scopeRow.username, epoch: scopeRow.epoch, cursor: scopeRow.cursor,
                               clockOffsetMs: scopeRow.clockOffsetMs, records: records,
                               pendingClears: scopeRow.decodedPendingClears)
    }

    private static func openScope(context: ModelContext, scopeKey: String, username: String) -> SyncScopeState {
        let descriptor = FetchDescriptor<SyncScopeState>(predicate: #Predicate { $0.scopeKey == scopeKey })
        if let row = try? context.fetch(descriptor).first { return row }
        let row = SyncScopeState(scopeKey: scopeKey, username: username)
        context.insert(row)
        try? context.save()
        return row
    }

    /// Context for tests that reopen the same container.
    ///
    /// 供测试重新打开同一容器使用的 context.
    var contextForTesting: ModelContext { context }

    /// Live records of one kind, newest first.
    ///
    /// 某类数据的有效记录, 最新的在前.
    func list(_ kind: SyncKind) -> [LocalRecord] {
        SyncMerge.listLive(state, kind: kind)
    }

    /// Live watch records, newest first.
    ///
    /// 有效的观看记录, 最新的在前.
    var watchItems: [WatchPayload] { list(.watch).compactMap(\.payload.watch) }

    /// Live favorites, newest first.
    ///
    /// 有效的收藏, 最新的在前.
    var favoriteItems: [FavoritePayload] { list(.favorite).compactMap(\.payload.favorite) }

    /// Live search history, newest first.
    ///
    /// 有效的搜索历史, 最新的在前.
    var searchItems: [SearchPayload] { list(.search).compactMap(\.payload.search) }

    /// One live record by raw title or query.
    ///
    /// 按原始标题或搜索词返回一条有效记录.
    func record(_ kind: SyncKind, key: String) -> LocalRecord? {
        guard let record = state.records[syncRecordID(kind, normalizeSyncKey(key))], !record.deleted else { return nil }
        return record
    }

    /// Watch record of a title.
    ///
    /// 某个标题的观看记录.
    func watch(title: String) -> WatchPayload? { record(.watch, key: title)?.payload.watch }

    /// Whether a title is a favorite, in any source.
    ///
    /// 某个标题是否已收藏, 与来源无关.
    func isFavorite(title: String) -> Bool { record(.favorite, key: title) != nil }

    /// Writes a local change and marks it for push. Returns nil for an empty key.
    ///
    /// 写入一条本地修改并标记为待推送. key 为空时返回 nil.
    @discardableResult
    func upsert(_ payload: SyncPayload) -> LocalRecord? {
        let clean = payload.coerced()
        let key = clean.key
        guard !key.isEmpty else { return nil }
        let id = syncRecordID(clean.kind, key)
        var record: LocalRecord?
        update { current in
            let existing = current.records[id]
            let after = max(existing?.eventTimeMs ?? 0, current.pendingClears[clean.kind] ?? 0)
            let written = LocalRecord(payload: clean, key: key, eventTimeMs: clock.next(after: after), deleted: false,
                                      dirty: true, synced: existing?.synced ?? false)
            record = written
            var next = current
            next.records[id] = written
            return SyncMerge.applyCaps(next)
        }
        emitLocal(clean.kind)
        return record
    }

    /// Writes a tombstone for one record.
    ///
    /// 为一条记录写入删除标记.
    func remove(_ kind: SyncKind, key: String) {
        let normalized = normalizeSyncKey(key)
        guard !normalized.isEmpty else { return }
        let id = syncRecordID(kind, normalized)
        update { current in
            let existing = current.records[id]
            var next = current
            next.records[id] = LocalRecord(payload: existing?.payload ?? .empty(kind), key: normalized,
                                           eventTimeMs: clock.next(after: existing?.eventTimeMs ?? 0), deleted: true,
                                           dirty: true, synced: existing?.synced ?? false)
            return next
        }
        emitLocal(kind)
    }

    /// Removes local records of one kind and records a pending clear later than all of them.
    ///
    /// 删除某类数据的本地记录, 并记录一个晚于它们全部的待推送清空.
    func clear(_ kind: SyncKind) {
        update { current in
            var latest = current.pendingClears[kind] ?? 0
            for record in current.records.values where record.kind == kind {
                latest = max(latest, record.eventTimeMs)
            }
            var next = current
            next.records = current.records.filter { $0.value.kind != kind }
            next.pendingClears[kind] = clock.next(after: latest)
            return next
        }
        emitLocal(kind)
    }

    /// Replaces the state and writes the row diff to SwiftData.
    ///
    /// 替换状态并将行级差异写入 SwiftData.
    func update(_ transform: (SyncState) -> SyncState) {
        let next = transform(state)
        for (id, row) in rows where next.records[id] == nil {
            context.delete(row)
            rows.removeValue(forKey: id)
        }
        for (id, record) in next.records where state.records[id] != record || rows[id] == nil {
            if let row = rows[id] {
                row.apply(record)
            } else {
                let row = SyncRecord(scopeKey: scopeKey, record: record)
                context.insert(row)
                rows[id] = row
            }
        }
        scopeRow.username = next.username
        scopeRow.epoch = next.epoch
        scopeRow.cursor = next.cursor
        scopeRow.clockOffsetMs = next.clockOffsetMs
        scopeRow.setPendingClears(next.pendingClears)
        do {
            try context.save()
        } catch {
            logger.error("sync store save failed: \(error.localizedDescription, privacy: .public)")
        }
        state = next
    }

    /// Subscribes to local writes (upsert, remove, clear); returns a cancel closure.
    ///
    /// 订阅本地写入 (upsert, remove, clear); 返回取消订阅的闭包.
    func onLocalChange(_ listener: @escaping (SyncKind) -> Void) -> () -> Void {
        let token = UUID()
        localListeners[token] = listener
        return { [weak self] in self?.localListeners.removeValue(forKey: token) }
    }

    private func emitLocal(_ kind: SyncKind) {
        for listener in localListeners.values { listener(kind) }
    }
}
