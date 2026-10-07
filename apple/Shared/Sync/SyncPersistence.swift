import Foundation
import SwiftData

/// SwiftData row for one local sync record. `scopeKey` isolates server and user;
/// `recordID` is `kind|key`.
///
/// 一条本地同步记录的 SwiftData 行. scopeKey 隔离服务器与用户; recordID 为 `kind|key`.
@Model
final class SyncRecord {
    #Unique<SyncRecord>([\.scopeKey, \.recordID])

    var scopeKey: String
    var recordID: String
    var kind: String
    var key: String
    var payload: Data
    var eventTimeMs: Int64
    var tombstone: Bool
    var dirty: Bool
    var synced: Bool

    init(scopeKey: String, record: LocalRecord) {
        self.scopeKey = scopeKey
        self.recordID = record.id
        self.kind = record.kind.rawValue
        self.key = record.key
        self.payload = record.payload.encodedData()
        self.eventTimeMs = record.eventTimeMs
        self.tombstone = record.deleted
        self.dirty = record.dirty
        self.synced = record.synced
    }

    /// Copies a local record into this row.
    ///
    /// 将本地记录写入这一行.
    func apply(_ record: LocalRecord) {
        recordID = record.id
        kind = record.kind.rawValue
        key = record.key
        payload = record.payload.encodedData()
        eventTimeMs = record.eventTimeMs
        tombstone = record.deleted
        dirty = record.dirty
        synced = record.synced
    }

    /// The row as a local record. Like web's `readRecords`, a damaged row yields nil: an unknown
    /// kind, an empty key, a record ID that is not `kind|key`, or a non-positive event time.
    ///
    /// 将该行转换为本地记录. 与 web 的 `readRecords` 一致, 损坏的行返回 nil: 数据类型未知, key 为空,
    /// 记录 ID 不是 `kind|key`, 或事件时间不为正数.
    var localRecord: LocalRecord? {
        guard let recordKind = SyncKind(rawValue: self.kind), !key.isEmpty, eventTimeMs > 0,
              recordID == syncRecordID(recordKind, key) else { return nil }
        return LocalRecord(payload: SyncPayload.decode(recordKind, from: payload), key: key,
                           eventTimeMs: eventTimeMs, deleted: tombstone, dirty: dirty, synced: synced)
    }
}

/// SwiftData row for the per-scope sync bookkeeping.
///
/// 每个作用域同步状态的 SwiftData 行.
@Model
final class SyncScopeState {
    #Unique<SyncScopeState>([\.scopeKey])

    var scopeKey: String
    var username: String
    var epoch: String = ""
    var cursor: Int64 = 0
    var clockOffsetMs: Int64 = 0
    var pendingClears: Data = Data()

    init(scopeKey: String, username: String) {
        self.scopeKey = scopeKey
        self.username = username
    }

    /// Pending clears decoded from JSON; unknown kinds and non-positive times are dropped.
    ///
    /// 从 JSON 解码的待推送清空; 未知数据类型和不为正数的时间会被丢弃.
    var decodedPendingClears: [SyncKind: Int64] {
        guard let raw = try? JSONDecoder().decode([String: Int64].self, from: pendingClears) else { return [:] }
        var result: [SyncKind: Int64] = [:]
        for (name, value) in raw {
            if let kind = SyncKind(rawValue: name), value > 0 { result[kind] = value }
        }
        return result
    }

    /// Stores the pending clears as JSON.
    ///
    /// 以 JSON 形式保存待推送清空.
    func setPendingClears(_ value: [SyncKind: Int64]) {
        let raw = Dictionary(uniqueKeysWithValues: value.map { ($0.key.rawValue, $0.value) })
        pendingClears = (try? JSONEncoder().encode(raw)) ?? Data()
    }
}
