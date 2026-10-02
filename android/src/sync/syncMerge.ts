/**
 * sync/syncMerge.ts — pure state transitions for the client side of the sync protocol.
 *
 * sync/syncMerge.ts — 同步协议客户端部分的纯状态转换.
 *
 * Mirrors simDevice in server/internal/handler/sync_e2e_test.go. Keep both in step.
 *
 * 与 server/internal/handler/sync_e2e_test.go 中的 simDevice 保持一致, 两边需同步修改.
 *
 * Shared verbatim with android/src/sync/. Import only sibling modules here.
 *
 * 与 android/src/sync/ 逐字共享. 这里只能导入同目录模块.
 */
import { syncAdapter } from "./kinds";
import {
  SYNC_KINDS,
  emptySyncState,
  isSyncKind,
  recordID,
  type LocalRecord,
  type SyncChangeWire,
  type SyncKind,
  type SyncPullResponse,
  type SyncPushResponse,
  type SyncRecordWire,
  type SyncState,
} from "./types";

/**
 * SYNC_PUSH_BATCH is the most changes sent in one push request.
 *
 * SYNC_PUSH_BATCH 是一次推送请求最多携带的变更数.
 */
export const SYNC_PUSH_BATCH = 200;

/**
 * SYNC_PUSH_MAX_BYTES bounds the encoded changes of one push, below the server's 256 KiB body limit.
 *
 * SYNC_PUSH_MAX_BYTES 限制一次推送中变更编码后的大小, 低于服务端 256 KiB 的请求体上限.
 */
export const SYNC_PUSH_MAX_BYTES = 192 * 1024;

/**
 * CollectOptions bounds one batch by change count and encoded size; newestFirst serves a
 * keepalive flush that may only get one small request.
 *
 * CollectOptions 按变更条数和编码大小限制一批推送; newestFirst 用于只能发送一个小请求的
 * keepalive 补写.
 */
export interface CollectOptions {
  limit?: number;
  maxBytes?: number;
  newestFirst?: boolean;
}

/**
 * PushInvalid is a change the server refused as invalid, kept for diagnostics.
 *
 * PushInvalid 是被服务端判定为无效的变更, 保留用于诊断.
 */
export interface PushInvalid {
  record: LocalRecord;
  reason: string;
}

/**
 * PushBatch pairs pushed changes with the local record IDs they came from (null for clears).
 *
 * PushBatch 将推送的变更与其来源的本地记录 ID 对应起来 (清空操作为 null).
 */
export interface PushBatch {
  changes: SyncChangeWire[];
  targets: Array<string | null>;
}

// compareCodePoints orders strings by code point, which matches the server's UTF-8 byte order.
// The `<` operator compares UTF-16 units and disagrees for characters above U+FFFF.
//
// compareCodePoints 按码点比较字符串, 与服务端的 UTF-8 字节序一致. `<` 运算符比较的是
// UTF-16 码元, 对 U+FFFF 以上的字符结果不同.
function compareCodePoints(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const x = a.codePointAt(i) ?? 0;
    const y = b.codePointAt(i) ?? 0;
    if (x !== y) return x < y ? -1 : 1;
    if (x > 0xffff) i += 1;
  }
  return a.length - b.length;
}

/**
 * compareRecords orders records newest first, then by key, matching the server's trim order.
 *
 * compareRecords 按最新优先, 再按 key 排序, 与服务端淘汰顺序一致.
 */
export function compareRecords(a: LocalRecord, b: LocalRecord): number {
  if (a.eventTimeMs !== b.eventTimeMs) return b.eventTimeMs - a.eventTimeMs;
  return compareCodePoints(a.key, b.key);
}

/**
 * listLive returns the non-deleted records of one kind, newest first.
 *
 * listLive 返回某类数据中未删除的记录, 最新的在前.
 */
export function listLive<K extends SyncKind>(state: SyncState, kind: K): LocalRecord<K>[] {
  return Object.values(state.records)
    .filter((record): record is LocalRecord<K> => record.kind === kind && !record.deleted)
    .sort(compareRecords);
}

/**
 * applyCaps trims kinds with a cap down to their newest records.
 *
 * applyCaps 将有上限的数据类型裁剪为最新的若干条.
 */
export function applyCaps(state: SyncState): SyncState {
  let records: Record<string, LocalRecord> | null = null;
  for (const kind of SYNC_KINDS) {
    const cap = syncAdapter(kind).cap;
    if (cap === null) continue;
    const live = listLive(state, kind);
    if (live.length <= cap) continue;
    records ??= { ...state.records };
    for (const record of live.slice(cap)) delete records[recordID(record.kind, record.key)];
  }
  return records ? { ...state, records } : state;
}

function utf8Length(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/**
 * collectChanges builds the next push batch: pending clears first, then dirty records (oldest
 * first unless newestFirst). The batch stops at `limit` changes or `maxBytes` of encoded changes;
 * the first change is always taken so one large record cannot block the queue.
 *
 * collectChanges 构造下一批推送: 先待推送的清空, 再是待推送记录 (默认从旧到新, newestFirst
 * 时从新到旧). 达到 limit 条或变更编码达到 maxBytes 时停止; 第一条总会放入, 单条大记录不会
 * 卡住队列.
 */
export function collectChanges(state: SyncState, options: CollectOptions = {}): PushBatch {
  const { limit = SYNC_PUSH_BATCH, maxBytes = SYNC_PUSH_MAX_BYTES, newestFirst = false } = options;
  const changes: SyncChangeWire[] = [];
  const targets: Array<string | null> = [];
  let bytes = 0;
  const take = (change: SyncChangeWire, target: string | null): boolean => {
    if (changes.length >= limit) return false;
    const size = utf8Length(JSON.stringify(change)) + 1;
    if (changes.length > 0 && bytes + size > maxBytes) return false;
    bytes += size;
    changes.push(change);
    targets.push(target);
    return true;
  };
  for (const kind of SYNC_KINDS) {
    const clearedAt = state.pendingClears[kind];
    if (clearedAt !== undefined && !take({ kind, op: "clear", event_time_ms: clearedAt }, null)) {
      return { changes, targets };
    }
  }
  const dirty = Object.entries(state.records)
    .filter(([, record]) => record.dirty)
    .sort(([, a], [, b]) => (newestFirst ? b.eventTimeMs - a.eventTimeMs : a.eventTimeMs - b.eventTimeMs));
  for (const [id, record] of dirty) {
    const change: SyncChangeWire = record.deleted
      ? { kind: record.kind, op: "delete", key: record.key, event_time_ms: record.eventTimeMs }
      : { kind: record.kind, op: "upsert", payload: record.payload, event_time_ms: record.eventTimeMs };
    if (!take(change, id)) break;
  }
  return { changes, targets };
}

function fromWire(remote: SyncRecordWire): LocalRecord {
  return {
    kind: remote.kind,
    key: remote.key,
    payload: syncAdapter(remote.kind).coerce(remote.payload),
    eventTimeMs: remote.event_time_ms,
    deleted: false,
    dirty: false,
    synced: true,
  } as LocalRecord;
}

function adopt(records: Record<string, LocalRecord>, id: string, remote: SyncRecordWire | null): void {
  delete records[id];
  if (!remote || !isSyncKind(remote.kind)) return;
  const remoteID = recordID(remote.kind, remote.key);
  if (remote.deleted) {
    delete records[remoteID];
    return;
  }
  records[remoteID] = fromWire(remote);
}

/**
 * applyPushResults applies per-change push outcomes. It returns favorites rejected by the cap and
 * changes the server refused as invalid; the engine logs the latter.
 *
 * applyPushResults 应用逐条推送结果. 返回因上限被拒绝的收藏, 以及被服务端判定为无效的变更;
 * 后者由引擎记录日志.
 */
export function applyPushResults(
  state: SyncState,
  batch: PushBatch,
  response: SyncPushResponse,
): { state: SyncState; rejected: LocalRecord[]; invalid: PushInvalid[] } {
  const records = { ...state.records };
  const pendingClears = { ...state.pendingClears };
  const rejected: LocalRecord[] = [];
  const invalid: PushInvalid[] = [];
  for (const result of response.results ?? []) {
    const change = batch.changes[result.index];
    if (!change) continue;
    if (change.op === "clear") {
      if (pendingClears[change.kind] === change.event_time_ms) delete pendingClears[change.kind];
      continue;
    }
    const id = batch.targets[result.index];
    const local = id ? records[id] : undefined;
    if (!id || !local || local.eventTimeMs !== change.event_time_ms) continue;
    switch (result.status) {
      case "applied": {
        if (local.deleted) {
          delete records[id];
          break;
        }
        const remote = result.record;
        if (!remote) {
          records[id] = { ...local, dirty: false, synced: true };
          break;
        }
        delete records[id];
        records[recordID(local.kind, remote.key)] = {
          ...local,
          key: remote.key,
          eventTimeMs: remote.event_time_ms,
          dirty: false,
          synced: true,
        };
        break;
      }
      case "stale":
        adopt(records, id, result.record);
        break;
      case "invalid":
        records[id] = { ...local, dirty: false };
        invalid.push({ record: local, reason: result.reason ?? "" });
        break;
      case "limit":
        delete records[id];
        rejected.push(local);
        break;
    }
  }
  return {
    state: applyCaps({ ...state, epoch: response.epoch || state.epoch, records, pendingClears }),
    rejected,
    invalid,
  };
}

/**
 * applyPullPage merges one pull page: clears first, then records. Live remote IDs are added to `seen`.
 * Remote records at or before a pending local clear of their kind are skipped: the clear has not
 * reached the server yet, but it already removed them here.
 *
 * applyPullPage 合并一页拉取结果: 先清空再记录. 远端有效记录的 ID 会加入 seen.
 * 时间不晚于本地待推送清空的远端记录会被跳过: 清空尚未到达服务端, 但本地已经删除了它们.
 */
export function applyPullPage(state: SyncState, response: SyncPullResponse, seen: Set<string>): SyncState {
  const records = { ...state.records };
  for (const clear of response.clears ?? []) {
    for (const [id, record] of Object.entries(records)) {
      if (record.kind === clear.kind && record.eventTimeMs <= clear.cleared_at_ms) delete records[id];
    }
  }
  for (const remote of response.records ?? []) {
    if (!isSyncKind(remote.kind)) continue;
    const pendingClear = state.pendingClears[remote.kind];
    if (pendingClear !== undefined && remote.event_time_ms <= pendingClear) continue;
    const id = recordID(remote.kind, remote.key);
    if (!remote.deleted) seen.add(id);
    const local = records[id];
    if (!local) {
      if (!remote.deleted) records[id] = fromWire(remote);
      continue;
    }
    if (!local.dirty || remote.event_time_ms > local.eventTimeMs) adopt(records, id, remote);
  }
  return applyCaps({ ...state, epoch: response.epoch, cursor: response.rev, records });
}

/**
 * finishFullResync drops synced, clean records that a full pull from revision 0 did not return.
 *
 * finishFullResync 删除从版本 0 全量拉取后未出现的, 已同步且无本地修改的记录.
 */
export function finishFullResync(state: SyncState, seen: Set<string>): SyncState {
  const records = { ...state.records };
  for (const [id, record] of Object.entries(records)) {
    if (record.synced && !record.dirty && !seen.has(id)) delete records[id];
  }
  return { ...state, records };
}

/**
 * markForReupload marks every record for upload and restarts pulling from revision 0. It serves a
 * server that lost data this device has: a new epoch, or a restore from an older copy (a reset
 * whose rev is below the local cursor).
 *
 * markForReupload 把所有记录标记为待上传, 并从版本 0 重新拉取. 用于服务端丢失了本设备已有数据
 * 的情况: 新 epoch, 或从旧副本恢复 (reset 返回的 rev 低于本地游标).
 */
export function markForReupload(state: SyncState): SyncState {
  const records: Record<string, LocalRecord> = {};
  for (const [id, record] of Object.entries(state.records)) {
    records[id] = { ...record, dirty: true, synced: false };
  }
  return { ...state, cursor: 0, records };
}

/**
 * resetForNewEpoch handles a server database reset. If the local data belongs to another username,
 * the user ID was reused by someone else and the data is dropped. Otherwise every record is marked
 * for re-upload.
 *
 * resetForNewEpoch 处理服务端数据库重置. 如果本地数据属于其他用户名, 说明该用户 ID 已被他人
 * 复用, 本地数据会被丢弃. 否则所有记录都标记为需要重新上传.
 */
export function resetForNewEpoch(state: SyncState, epoch: string, username: string): SyncState {
  if (state.username !== "" && state.username !== username) {
    return { ...emptySyncState(username), epoch, clockOffsetMs: state.clockOffsetMs };
  }
  return { ...markForReupload(state), username, epoch };
}
