/**
 * sync/types.ts — shared types for the offline-first sync store and the /sync protocol.
 *
 * sync/types.ts — 离线优先同步存储与 /sync 协议共用的类型.
 *
 * Key exports / 主要导出:
 *   SyncKind, SYNC_KINDS, isSyncKind, payload types, LocalRecord, SyncState, emptySyncState,
 *   recordID, wire types (SyncChangeWire, SyncRecordWire, SyncPushResponse, SyncPullResponse)
 *
 * Shared verbatim with android/src/sync/. Import only sibling modules here.
 *
 * 与 android/src/sync/ 逐字共享. 这里只能导入同目录模块.
 *
 * ADR refs: ADR-016 (unified offline-first sync)
 */

/**
 * SyncKind names one synchronized collection.
 *
 * SyncKind 表示一类同步数据集合.
 */
export type SyncKind = "watch" | "favorite" | "search";

/**
 * SYNC_KINDS lists every kind in the order pending clears are pushed.
 *
 * SYNC_KINDS 列出全部数据类型, 也是推送待清空操作的顺序.
 */
export const SYNC_KINDS: readonly SyncKind[] = ["favorite", "search", "watch"];

/**
 * isSyncKind narrows an untrusted server string to a known kind.
 *
 * isSyncKind 将不可信的服务端字符串收窄为已知数据类型.
 */
export function isSyncKind(value: unknown): value is SyncKind {
  return value === "watch" || value === "favorite" || value === "search";
}

/**
 * WatchPayload is the playback state stored for one title.
 *
 * WatchPayload 是某个标题保存的播放状态.
 */
export interface WatchPayload {
  title: string;
  cover: string;
  source_key: string;
  video_id: string;
  episode: string;
  group_index: number;
  episode_index: number;
  progress_sec: number;
  duration_sec: number;
  completed: boolean;
}

/**
 * FavoritePayload is the display data stored for one favorite title.
 *
 * FavoritePayload 是某个收藏标题保存的展示数据.
 */
export interface FavoritePayload {
  title: string;
  cover: string;
  type: string;
  year: string;
  rate: string;
  desc: string;
  source_key: string;
  video_id: string;
}

/**
 * SearchPayload is one search history entry.
 *
 * SearchPayload 是一条搜索历史.
 */
export interface SearchPayload {
  query: string;
}

/**
 * SyncPayloadMap maps each kind to its payload type.
 *
 * SyncPayloadMap 将每种数据类型映射到对应的 payload 类型.
 */
export interface SyncPayloadMap {
  watch: WatchPayload;
  favorite: FavoritePayload;
  search: SearchPayload;
}

/**
 * LocalRecord is one record in the local store, with its sync bookkeeping.
 *
 * LocalRecord 是本地存储中的一条记录, 附带同步状态.
 *
 * `dirty` marks an unacknowledged local change; `synced` marks a record the server has seen.
 *
 * dirty 表示尚未被服务端确认的本地修改; synced 表示服务端已经见过这条记录.
 */
export interface LocalRecord<K extends SyncKind = SyncKind> {
  kind: K;
  key: string;
  payload: SyncPayloadMap[K];
  eventTimeMs: number;
  deleted: boolean;
  dirty: boolean;
  synced: boolean;
}

/**
 * SyncState is everything one scope persists: records, pending clears, cursor, and epoch.
 *
 * SyncState 是一个作用域持久化的全部内容: 记录, 待推送清空, 游标和 epoch.
 */
export interface SyncState {
  version: 1;
  username: string;
  epoch: string;
  cursor: number;
  clockOffsetMs: number;
  records: Record<string, LocalRecord>;
  pendingClears: Partial<Record<SyncKind, number>>;
}

/**
 * emptySyncState returns a fresh state owned by the given username.
 *
 * emptySyncState 返回属于指定用户名的空状态.
 */
export function emptySyncState(username: string): SyncState {
  return { version: 1, username, epoch: "", cursor: 0, clockOffsetMs: 0, records: {}, pendingClears: {} };
}

/**
 * recordID builds the map key of a record inside SyncState.records.
 *
 * recordID 生成记录在 SyncState.records 中的 map key.
 */
export function recordID(kind: SyncKind, key: string): string {
  return `${kind}|${key}`;
}

/**
 * SyncChangeWire is one change sent to POST /sync/push.
 *
 * SyncChangeWire 是发送给 POST /sync/push 的一条变更.
 */
export interface SyncChangeWire {
  kind: SyncKind;
  op: "upsert" | "delete" | "clear";
  key?: string;
  payload?: unknown;
  event_time_ms: number;
}

/**
 * SyncRecordWire is a record as returned by the server.
 *
 * SyncRecordWire 是服务端返回的记录.
 */
export interface SyncRecordWire {
  kind: SyncKind;
  key: string;
  payload: unknown;
  event_time_ms: number;
  deleted: boolean;
  rev: number;
}

/**
 * SyncClearWire is a clear watermark as returned by the server.
 *
 * SyncClearWire 是服务端返回的清空时间点.
 */
export interface SyncClearWire {
  kind: SyncKind;
  cleared_at_ms: number;
  rev: number;
}

/**
 * SyncResultWire is the outcome of one pushed change.
 *
 * SyncResultWire 是一条推送变更的处理结果.
 */
export interface SyncResultWire {
  index: number;
  status: "applied" | "stale" | "invalid" | "limit";
  record: SyncRecordWire | null;
  clear?: SyncClearWire;
  reason?: string;
}

/**
 * SyncPushRequest is the body of POST /sync/push.
 *
 * SyncPushRequest 是 POST /sync/push 的请求体.
 */
export interface SyncPushRequest {
  epoch: string;
  cursor: number;
  changes: SyncChangeWire[];
}

/**
 * SyncPushResponse is the success body of POST /sync/push.
 *
 * SyncPushResponse 是 POST /sync/push 的成功响应体.
 */
export interface SyncPushResponse {
  epoch: string;
  rev: number;
  server_time_ms: number;
  results: SyncResultWire[];
}

/**
 * SyncPullResponse is the success body of GET /sync/pull.
 *
 * SyncPullResponse 是 GET /sync/pull 的成功响应体.
 */
export interface SyncPullResponse {
  epoch: string;
  server_time_ms: number;
  rev: number;
  reset: boolean;
  has_more: boolean;
  clears: SyncClearWire[];
  records: SyncRecordWire[];
}
