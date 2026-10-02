import Foundation

/// SyncKind names one synchronized collection. Raw values match the server, and `allCases`
/// order is the order pending clears are pushed in.
///
/// SyncKind 表示一类同步数据集合. 原始值与服务端一致, `allCases` 顺序即待推送清空的顺序.
enum SyncKind: String, Codable, CaseIterable, Sendable {
    case favorite
    case search
    case watch

    /// Local live-record cap; `nil` leaves the limit to the server.
    ///
    /// 本地有效记录上限; `nil` 表示由服务端限制.
    var cap: Int? {
        switch self {
        case .watch: 200
        case .search: 50
        case .favorite: nil
        }
    }
}

// Server payloads are untrusted (ADR-005): wrong types fall back to defaults instead of throwing.
//
// 服务端 payload 不可信 (ADR-005): 类型错误时回退为默认值, 而不是抛出错误.
extension KeyedDecodingContainer {
    fileprivate func syncText(_ key: Key, limit: Int) -> String {
        guard let value = try? decodeIfPresent(String.self, forKey: key) else { return "" }
        return clampSyncText(value, limit: limit)
    }

    fileprivate func syncIndex(_ key: Key) -> Int {
        guard let value = try? decodeIfPresent(Double.self, forKey: key),
              value.isFinite, value >= 0, value < 1e15 else { return 0 }
        return Int(value.rounded(.down))
    }

    fileprivate func syncSeconds(_ key: Key) -> Double {
        guard let value = try? decodeIfPresent(Double.self, forKey: key), value.isFinite, value >= 0 else { return 0 }
        return value
    }

    fileprivate func syncFlag(_ key: Key) -> Bool {
        (try? decodeIfPresent(Bool.self, forKey: key)) ?? false
    }
}

private func syncSecondsValue(_ value: Double) -> Double {
    value.isFinite && value >= 0 ? value : 0
}

/// Playback state stored for one title.
///
/// 某个标题保存的播放状态.
struct WatchPayload: Codable, Equatable, Sendable, Identifiable {
    var title: String
    var cover: String
    var sourceKey: String
    var videoId: String
    var episode: String
    var groupIndex: Int
    var episodeIndex: Int
    var progressSec: Double
    var durationSec: Double
    var completed: Bool

    /// Normalized title, stable across devices.
    ///
    /// 归一化后的标题, 在各设备间保持一致.
    var id: String { normalizeSyncKey(title) }

    enum CodingKeys: String, CodingKey {
        case title, cover, episode, completed
        case sourceKey = "source_key"
        case videoId = "video_id"
        case groupIndex = "group_index"
        case episodeIndex = "episode_index"
        case progressSec = "progress_sec"
        case durationSec = "duration_sec"
    }

    init(title: String, cover: String = "", sourceKey: String = "", videoId: String = "", episode: String = "",
         groupIndex: Int = 0, episodeIndex: Int = 0, progressSec: Double = 0, durationSec: Double = 0,
         completed: Bool = false) {
        self.title = title
        self.cover = cover
        self.sourceKey = sourceKey
        self.videoId = videoId
        self.episode = episode
        self.groupIndex = groupIndex
        self.episodeIndex = episodeIndex
        self.progressSec = progressSec
        self.durationSec = durationSec
        self.completed = completed
    }

    init(from decoder: Decoder) throws {
        guard let c = try? decoder.container(keyedBy: CodingKeys.self) else {
            self.init(title: "")
            return
        }
        self.init(title: c.syncText(.title, limit: SyncFieldLimit.title),
                  cover: c.syncText(.cover, limit: SyncFieldLimit.cover),
                  sourceKey: c.syncText(.sourceKey, limit: SyncFieldLimit.id),
                  videoId: c.syncText(.videoId, limit: SyncFieldLimit.id),
                  episode: c.syncText(.episode, limit: SyncFieldLimit.title),
                  groupIndex: c.syncIndex(.groupIndex), episodeIndex: c.syncIndex(.episodeIndex),
                  progressSec: c.syncSeconds(.progressSec), durationSec: c.syncSeconds(.durationSec),
                  completed: c.syncFlag(.completed))
    }

    /// Returns a copy with trimmed, length-limited text and non-negative finite numbers.
    ///
    /// 返回文本已去除首尾空白并截断到上限, 数值为非负有限数的副本.
    func coerced() -> WatchPayload {
        WatchPayload(title: clampSyncText(title, limit: SyncFieldLimit.title),
                     cover: clampSyncText(cover, limit: SyncFieldLimit.cover),
                     sourceKey: clampSyncText(sourceKey, limit: SyncFieldLimit.id),
                     videoId: clampSyncText(videoId, limit: SyncFieldLimit.id),
                     episode: clampSyncText(episode, limit: SyncFieldLimit.title),
                     groupIndex: max(0, groupIndex), episodeIndex: max(0, episodeIndex),
                     progressSec: syncSecondsValue(progressSec), durationSec: syncSecondsValue(durationSec),
                     completed: completed)
    }
}

/// Display data stored for one favorite title.
///
/// 某个收藏标题保存的展示数据.
struct FavoritePayload: Codable, Equatable, Sendable, Identifiable {
    var title: String
    var cover: String
    var type: String
    var year: String
    var rate: String
    var desc: String
    var sourceKey: String
    var videoId: String

    /// Normalized title, stable across devices.
    ///
    /// 归一化后的标题, 在各设备间保持一致.
    var id: String { normalizeSyncKey(title) }

    enum CodingKeys: String, CodingKey {
        case title, cover, type, year, rate, desc
        case sourceKey = "source_key"
        case videoId = "video_id"
    }

    init(title: String, cover: String = "", type: String = "", year: String = "", rate: String = "",
         desc: String = "", sourceKey: String = "", videoId: String = "") {
        self.title = title
        self.cover = cover
        self.type = type
        self.year = year
        self.rate = rate
        self.desc = desc
        self.sourceKey = sourceKey
        self.videoId = videoId
    }

    init(from decoder: Decoder) throws {
        guard let c = try? decoder.container(keyedBy: CodingKeys.self) else {
            self.init(title: "")
            return
        }
        self.init(title: c.syncText(.title, limit: SyncFieldLimit.title),
                  cover: c.syncText(.cover, limit: SyncFieldLimit.cover),
                  type: c.syncText(.type, limit: SyncFieldLimit.short),
                  year: c.syncText(.year, limit: SyncFieldLimit.short),
                  rate: c.syncText(.rate, limit: SyncFieldLimit.short),
                  desc: c.syncText(.desc, limit: SyncFieldLimit.desc),
                  sourceKey: c.syncText(.sourceKey, limit: SyncFieldLimit.id),
                  videoId: c.syncText(.videoId, limit: SyncFieldLimit.id))
    }

    /// Returns a copy with trimmed, length-limited text.
    ///
    /// 返回文本已去除首尾空白并截断到上限的副本.
    func coerced() -> FavoritePayload {
        FavoritePayload(title: clampSyncText(title, limit: SyncFieldLimit.title),
                        cover: clampSyncText(cover, limit: SyncFieldLimit.cover),
                        type: clampSyncText(type, limit: SyncFieldLimit.short),
                        year: clampSyncText(year, limit: SyncFieldLimit.short),
                        rate: clampSyncText(rate, limit: SyncFieldLimit.short),
                        desc: clampSyncText(desc, limit: SyncFieldLimit.desc),
                        sourceKey: clampSyncText(sourceKey, limit: SyncFieldLimit.id),
                        videoId: clampSyncText(videoId, limit: SyncFieldLimit.id))
    }
}

/// One search history entry.
///
/// 一条搜索历史.
struct SearchPayload: Codable, Equatable, Sendable, Identifiable {
    var query: String

    /// Normalized query, stable across devices.
    ///
    /// 归一化后的搜索词, 在各设备间保持一致.
    var id: String { normalizeSyncKey(query) }

    enum CodingKeys: String, CodingKey { case query }

    init(query: String) {
        self.query = query
    }

    init(from decoder: Decoder) throws {
        guard let c = try? decoder.container(keyedBy: CodingKeys.self) else {
            self.init(query: "")
            return
        }
        self.init(query: c.syncText(.query, limit: SyncFieldLimit.title))
    }

    /// Returns a copy with trimmed, length-limited text.
    ///
    /// 返回文本已去除首尾空白并截断到上限的副本.
    func coerced() -> SearchPayload {
        SearchPayload(query: clampSyncText(query, limit: SyncFieldLimit.title))
    }
}

/// A payload of any kind; the case decides the kind and the key.
///
/// 任意类型的 payload; 枚举分支决定数据类型和 key.
enum SyncPayload: Equatable, Sendable, Encodable {
    case watch(WatchPayload)
    case favorite(FavoritePayload)
    case search(SearchPayload)

    /// Kind of this payload.
    ///
    /// payload 的数据类型.
    var kind: SyncKind {
        switch self {
        case .watch: .watch
        case .favorite: .favorite
        case .search: .search
        }
    }

    /// Normalized record key: the title, or the query for search history.
    ///
    /// 归一化的记录 key: 标题, 搜索历史则为搜索词.
    var key: String {
        switch self {
        case .watch(let payload): normalizeSyncKey(payload.title)
        case .favorite(let payload): normalizeSyncKey(payload.title)
        case .search(let payload): normalizeSyncKey(payload.query)
        }
    }

    /// Returns the payload with trimmed text and valid numbers.
    ///
    /// 返回文本已去除首尾空白, 数值有效的 payload.
    func coerced() -> SyncPayload {
        switch self {
        case .watch(let payload): .watch(payload.coerced())
        case .favorite(let payload): .favorite(payload.coerced())
        case .search(let payload): .search(payload.coerced())
        }
    }

    /// The watch payload, if this is one.
    ///
    /// 若为观看记录则返回其 payload.
    var watch: WatchPayload? {
        if case .watch(let payload) = self { return payload }
        return nil
    }

    /// The favorite payload, if this is one.
    ///
    /// 若为收藏则返回其 payload.
    var favorite: FavoritePayload? {
        if case .favorite(let payload) = self { return payload }
        return nil
    }

    /// The search payload, if this is one.
    ///
    /// 若为搜索历史则返回其 payload.
    var search: SearchPayload? {
        if case .search(let payload) = self { return payload }
        return nil
    }

    /// Empty payload of one kind, used for tombstones that have no local row.
    ///
    /// 某类数据的空 payload, 用于没有本地行的删除标记.
    static func empty(_ kind: SyncKind) -> SyncPayload {
        switch kind {
        case .watch: .watch(WatchPayload(title: ""))
        case .favorite: .favorite(FavoritePayload(title: ""))
        case .search: .search(SearchPayload(query: ""))
        }
    }

    /// Decodes stored or remote bytes leniently; unreadable bytes give an empty payload.
    ///
    /// 宽松地解码存储或远端的字节; 无法读取时返回空 payload.
    static func decode(_ kind: SyncKind, from data: Data) -> SyncPayload {
        let decoder = JSONDecoder()
        switch kind {
        case .watch: return .watch((try? decoder.decode(WatchPayload.self, from: data)) ?? WatchPayload(title: ""))
        case .favorite: return .favorite((try? decoder.decode(FavoritePayload.self, from: data)) ?? FavoritePayload(title: ""))
        case .search: return .search((try? decoder.decode(SearchPayload.self, from: data)) ?? SearchPayload(query: ""))
        }
    }

    fileprivate static func decode<K: CodingKey>(_ kind: SyncKind, from container: KeyedDecodingContainer<K>, forKey key: K) -> SyncPayload {
        switch kind {
        case .watch: return .watch((try? container.decodeIfPresent(WatchPayload.self, forKey: key)) ?? WatchPayload(title: ""))
        case .favorite: return .favorite((try? container.decodeIfPresent(FavoritePayload.self, forKey: key)) ?? FavoritePayload(title: ""))
        case .search: return .search((try? container.decodeIfPresent(SearchPayload.self, forKey: key)) ?? SearchPayload(query: ""))
        }
    }

    /// JSON bytes for SwiftData storage.
    ///
    /// 用于 SwiftData 存储的 JSON 字节.
    func encodedData() -> Data {
        (try? JSONEncoder().encode(self)) ?? Data("{}".utf8)
    }

    func encode(to encoder: Encoder) throws {
        switch self {
        case .watch(let payload): try payload.encode(to: encoder)
        case .favorite(let payload): try payload.encode(to: encoder)
        case .search(let payload): try payload.encode(to: encoder)
        }
    }
}

/// Map key of a record inside `SyncState.records`.
///
/// 记录在 `SyncState.records` 中的 map key.
func syncRecordID(_ kind: SyncKind, _ key: String) -> String {
    "\(kind.rawValue)|\(key)"
}

/// One record in the local store, with its sync bookkeeping. `dirty` marks an unacknowledged
/// local change; `synced` marks a record the server has seen.
///
/// 本地存储中的一条记录及其同步状态. dirty 表示尚未被服务端确认的本地修改;
/// synced 表示服务端已经见过这条记录.
struct LocalRecord: Equatable, Sendable {
    var payload: SyncPayload
    var key: String
    var eventTimeMs: Int64
    var deleted: Bool
    var dirty: Bool
    var synced: Bool

    /// Kind of the record.
    ///
    /// 记录的数据类型.
    var kind: SyncKind { payload.kind }

    /// Map key inside `SyncState.records`.
    ///
    /// 在 `SyncState.records` 中的 map key.
    var id: String { syncRecordID(kind, key) }
}

/// Everything one scope persists: records, pending clears, cursor, epoch, and clock offset.
///
/// 一个作用域持久化的全部内容: 记录, 待推送清空, 游标, epoch 和时钟偏移.
struct SyncState: Equatable, Sendable {
    var username: String
    var epoch = ""
    var cursor: Int64 = 0
    var clockOffsetMs: Int64 = 0
    var records: [String: LocalRecord] = [:]
    var pendingClears: [SyncKind: Int64] = [:]
}

/// One change sent to POST /sync/push.
///
/// 发送给 POST /sync/push 的一条变更.
struct SyncChangeWire: Encodable, Equatable, Sendable {
    /// Operation of a pushed change.
    ///
    /// 推送变更的操作类型.
    enum Op: String, Encodable, Sendable {
        case upsert, delete, clear
    }

    let kind: SyncKind
    let op: Op
    let key: String?
    let payload: SyncPayload?
    let eventTimeMs: Int64

    enum CodingKeys: String, CodingKey {
        case kind, op, key, payload
        case eventTimeMs = "event_time_ms"
    }
}

/// A record as returned by the server. `kind` and `payload` are nil for kinds this client does not know.
///
/// 服务端返回的记录. 对于本客户端不认识的数据类型, kind 和 payload 为 nil.
struct SyncRecordWire: Decodable, Equatable, Sendable {
    let kind: SyncKind?
    let key: String
    let payload: SyncPayload?
    let eventTimeMs: Int64
    let deleted: Bool
    let rev: Int64

    enum CodingKeys: String, CodingKey {
        case kind, key, payload, deleted, rev
        case eventTimeMs = "event_time_ms"
    }

    init(kind: SyncKind?, key: String, payload: SyncPayload?, eventTimeMs: Int64, deleted: Bool = false, rev: Int64 = 0) {
        self.kind = kind
        self.key = key
        self.payload = payload
        self.eventTimeMs = eventTimeMs
        self.deleted = deleted
        self.rev = rev
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let kind = SyncKind(rawValue: (try? c.decode(String.self, forKey: .kind)) ?? "")
        self.kind = kind
        key = (try? c.decode(String.self, forKey: .key)) ?? ""
        eventTimeMs = (try? c.decode(Int64.self, forKey: .eventTimeMs)) ?? 0
        deleted = (try? c.decode(Bool.self, forKey: .deleted)) ?? false
        rev = (try? c.decode(Int64.self, forKey: .rev)) ?? 0
        payload = kind.map { SyncPayload.decode($0, from: c, forKey: .payload) }
    }
}

/// A clear watermark as returned by the server.
///
/// 服务端返回的清空时间点.
struct SyncClearWire: Decodable, Equatable, Sendable {
    let kind: SyncKind?
    let clearedAtMs: Int64
    let rev: Int64

    enum CodingKeys: String, CodingKey {
        case kind, rev
        case clearedAtMs = "cleared_at_ms"
    }

    init(kind: SyncKind?, clearedAtMs: Int64, rev: Int64 = 0) {
        self.kind = kind
        self.clearedAtMs = clearedAtMs
        self.rev = rev
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = SyncKind(rawValue: (try? c.decode(String.self, forKey: .kind)) ?? "")
        clearedAtMs = (try? c.decode(Int64.self, forKey: .clearedAtMs)) ?? 0
        rev = (try? c.decode(Int64.self, forKey: .rev)) ?? 0
    }
}

/// Outcome of one pushed change.
///
/// 一条推送变更的处理结果.
struct SyncResultWire: Decodable, Equatable, Sendable {
    /// Result status; unknown values decode as `.unknown` and are ignored.
    ///
    /// 结果状态; 未知值解码为 `.unknown` 并被忽略.
    enum Status: String, Decodable, Sendable {
        case applied, stale, invalid, limit, unknown

        init(from decoder: Decoder) throws {
            self = Status(rawValue: (try? decoder.singleValueContainer().decode(String.self)) ?? "") ?? .unknown
        }
    }

    let index: Int
    let status: Status
    let record: SyncRecordWire?
    let clear: SyncClearWire?
    let reason: String?

    init(index: Int, status: Status, record: SyncRecordWire? = nil, clear: SyncClearWire? = nil, reason: String? = nil) {
        self.index = index
        self.status = status
        self.record = record
        self.clear = clear
        self.reason = reason
    }
}

/// Body of POST /sync/push.
///
/// POST /sync/push 的请求体.
struct SyncPushRequest: Encodable, Equatable, Sendable {
    let epoch: String
    /// The client's pull cursor; a server restored from an older backup answers 409 when it is
    /// ahead of the server's revision.
    ///
    /// 客户端的拉取游标; 从旧备份恢复的服务端在游标超过其版本号时返回 409.
    let cursor: Int64
    let changes: [SyncChangeWire]
}

/// Success body of POST /sync/push.
///
/// POST /sync/push 的成功响应体.
struct SyncPushResponse: Decodable, Equatable, Sendable {
    let epoch: String
    let rev: Int64
    let serverTimeMs: Int64
    let results: [SyncResultWire]

    enum CodingKeys: String, CodingKey {
        case epoch, rev, results
        case serverTimeMs = "server_time_ms"
    }

    init(epoch: String, rev: Int64, serverTimeMs: Int64, results: [SyncResultWire]) {
        self.epoch = epoch
        self.rev = rev
        self.serverTimeMs = serverTimeMs
        self.results = results
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        epoch = try c.decode(String.self, forKey: .epoch)
        rev = try c.decode(Int64.self, forKey: .rev)
        serverTimeMs = try c.decode(Int64.self, forKey: .serverTimeMs)
        results = (try c.decodeIfPresent([SyncResultWire].self, forKey: .results)) ?? []
    }
}

/// Success body of GET /sync/pull.
///
/// GET /sync/pull 的成功响应体.
struct SyncPullResponse: Decodable, Equatable, Sendable {
    let epoch: String
    let serverTimeMs: Int64
    let rev: Int64
    let reset: Bool
    let hasMore: Bool
    let clears: [SyncClearWire]
    let records: [SyncRecordWire]

    enum CodingKeys: String, CodingKey {
        case epoch, rev, reset, clears, records
        case serverTimeMs = "server_time_ms"
        case hasMore = "has_more"
    }

    init(epoch: String, serverTimeMs: Int64 = 1, rev: Int64 = 0, reset: Bool = false, hasMore: Bool = false,
         clears: [SyncClearWire] = [], records: [SyncRecordWire] = []) {
        self.epoch = epoch
        self.serverTimeMs = serverTimeMs
        self.rev = rev
        self.reset = reset
        self.hasMore = hasMore
        self.clears = clears
        self.records = records
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        epoch = try c.decode(String.self, forKey: .epoch)
        serverTimeMs = try c.decode(Int64.self, forKey: .serverTimeMs)
        rev = try c.decode(Int64.self, forKey: .rev)
        reset = (try c.decodeIfPresent(Bool.self, forKey: .reset)) ?? false
        hasMore = (try c.decodeIfPresent(Bool.self, forKey: .hasMore)) ?? false
        clears = (try c.decodeIfPresent([SyncClearWire].self, forKey: .clears)) ?? []
        records = (try c.decodeIfPresent([SyncRecordWire].self, forKey: .records)) ?? []
    }
}
