/**
 * sync/syncStore.ts — persistent sync store for one (server, user) scope over a key-value storage.
 *
 * sync/syncStore.ts — 基于键值存储的同步存储, 每个 (服务器, 用户) 作用域一份.
 *
 * Every write re-reads storage first so two writers sharing the storage do not drop each other's
 * changes. The platform calls reload() when another writer changed the scope (a browser tab).
 *
 * 每次写入前都会重新读取存储, 避免共享存储的两个写入方互相覆盖. 其他写入方 (如浏览器的
 * 另一个标签页) 修改作用域后, 由平台层调用 reload().
 *
 * Shared verbatim with android/src/sync/. Import only sibling modules here.
 *
 * 与 android/src/sync/ 逐字共享. 这里只能导入同目录模块.
 *
 * ADR refs: ADR-016 (unified offline-first sync)
 */
import { syncAdapter } from "./kinds";
import { normalizeSyncKey } from "./normalizeKey";
import { createSyncClock, type SyncClock } from "./syncClock";
import { applyCaps, listLive } from "./syncMerge";
import {
  SYNC_KINDS,
  emptySyncState,
  isSyncKind,
  recordID,
  type LocalRecord,
  type SyncKind,
  type SyncPayloadMap,
  type SyncState,
} from "./types";

/**
 * SyncStorage is the key-value storage a sync store persists into.
 *
 * SyncStorage 是同步存储用于持久化的键值存储.
 */
export interface SyncStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * syncScopeKey returns the storage key of one server and user scope; anonymous is user 0.
 *
 * syncScopeKey 返回某个服务器与用户作用域的存储 key; 匿名用户为 0.
 */
export function syncScopeKey(origin: string, userID: number): string {
  return `kmtv.sync.v1:${origin}:${Math.max(0, userID)}`;
}

// readRecords keeps only well-formed records from stored JSON, so one damaged entry (an old
// version, a manual edit) cannot break the screens or the push of every other record.
//
// readRecords 只保留存储 JSON 中格式正确的记录, 单条损坏的数据 (旧版本或手动修改) 不会影响页面
// 显示, 也不会阻塞其他记录的推送.
function readRecords(value: unknown): Record<string, LocalRecord> {
  const records: Record<string, LocalRecord> = {};
  if (!value || typeof value !== "object") return records;
  for (const [id, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== "object") continue;
    const { kind, key, eventTimeMs, payload, deleted, dirty, synced } = raw as Record<string, unknown>;
    if (!isSyncKind(kind) || typeof key !== "string" || key === "" || id !== recordID(kind, key)) continue;
    if (typeof eventTimeMs !== "number" || !Number.isSafeInteger(eventTimeMs) || eventTimeMs <= 0) continue;
    if (!payload || typeof payload !== "object") continue;
    records[id] = {
      kind,
      key,
      payload: syncAdapter(kind).coerce(payload),
      eventTimeMs,
      deleted: deleted === true,
      dirty: dirty === true,
      synced: synced === true,
    } as LocalRecord;
  }
  return records;
}

function readPendingClears(value: unknown): SyncState["pendingClears"] {
  const clears: SyncState["pendingClears"] = {};
  if (!value || typeof value !== "object") return clears;
  for (const kind of SYNC_KINDS) {
    const at = (value as Record<string, unknown>)[kind];
    if (typeof at === "number" && Number.isSafeInteger(at) && at > 0) clears[kind] = at;
  }
  return clears;
}

/**
 * SyncStore is the only place screens read and write synchronized data.
 *
 * SyncStore 是页面读写同步数据的唯一入口.
 */
export interface SyncStore {
  readonly scopeKey: string;
  readonly username: string;
  readonly clock: SyncClock;
  state(): SyncState;
  list<K extends SyncKind>(kind: K): LocalRecord<K>[];
  get<K extends SyncKind>(kind: K, key: string): LocalRecord<K> | null;
  upsert<K extends SyncKind>(kind: K, payload: SyncPayloadMap[K]): LocalRecord<K> | null;
  remove(kind: SyncKind, key: string): void;
  clear(kind: SyncKind): void;
  update(updater: (state: SyncState) => SyncState): void;
  reload(): void;
  subscribe(listener: () => void): () => void;
  onLocalChange(listener: (kind: SyncKind) => void): () => void;
}

/**
 * SyncStoreOptions configures one store instance.
 *
 * SyncStoreOptions 配置一个存储实例.
 */
export interface SyncStoreOptions {
  storage: SyncStorage;
  scopeKey: string;
  username: string;
  clock?: SyncClock;
}

/**
 * createSyncStore opens the store of one scope. `username` is the current name of the scope's user;
 * state saved under an older name is kept (a rename), and the engine drops it only when the server
 * epoch changes too (see resetForNewEpoch).
 *
 * createSyncStore 打开某个作用域的存储. username 是该作用域用户当前的用户名; 旧用户名下保存的
 * 状态会保留 (改名), 只有服务端 epoch 也变化时引擎才会丢弃它 (见 resetForNewEpoch).
 */
export function createSyncStore(options: SyncStoreOptions): SyncStore {
  const { storage, scopeKey, username } = options;
  const listeners = new Set<() => void>();
  const localListeners = new Set<(kind: SyncKind) => void>();
  let cache: SyncState = emptySyncState(username);
  let writable = true;
  // lastRaw is the stored JSON this store last read or wrote; reload() skips when it is unchanged.
  //
  // lastRaw 是本存储最近一次读取或写入的 JSON; 未变化时 reload() 直接跳过.
  let lastRaw: string | null = null;

  // readState falls back to the in-memory cache when storage cannot be read or the last write
  // failed, so a refused or full storage keeps working for the session instead of dropping writes.
  //
  // 存储不可读或上次写入失败时 readState 回退到内存缓存, 存储被拒绝或已满时本次会话仍可正常
  // 使用, 不会丢失写入.
  function readState(): SyncState {
    if (!writable) return cache;
    let raw: string | null;
    try {
      raw = storage.getItem(scopeKey);
    } catch {
      return cache;
    }
    // While storage is writable the cache always holds what lastRaw encodes, so an unchanged value
    // (the common case for every write) skips the parse and the per-record validation.
    //
    // 存储可写时缓存始终对应 lastRaw 的内容, 因此值未变化 (每次写入的常见情况) 时跳过解析和
    // 逐条记录校验.
    if (raw === lastRaw) return cache;
    lastRaw = raw;
    if (!raw) return emptySyncState(username);
    try {
      const parsed = JSON.parse(raw) as Partial<SyncState> | null;
      if (!parsed || parsed.version !== 1 || !parsed.records || typeof parsed.records !== "object") {
        return emptySyncState(username);
      }
      return {
        ...emptySyncState(username),
        username: typeof parsed.username === "string" ? parsed.username : username,
        epoch: typeof parsed.epoch === "string" ? parsed.epoch : "",
        cursor: typeof parsed.cursor === "number" ? parsed.cursor : 0,
        clockOffsetMs: typeof parsed.clockOffsetMs === "number" ? parsed.clockOffsetMs : 0,
        records: readRecords(parsed.records),
        pendingClears: readPendingClears(parsed.pendingClears),
      };
    } catch {
      return emptySyncState(username);
    }
  }

  cache = readState();
  const clock = options.clock ?? createSyncClock(cache.clockOffsetMs);

  function notify(): void {
    for (const listener of listeners) listener();
  }

  function emitLocal(kind: SyncKind): void {
    for (const listener of localListeners) listener(kind);
  }

  function update(updater: (state: SyncState) => SyncState): void {
    const next = updater(readState());
    try {
      const raw = JSON.stringify(next);
      storage.setItem(scopeKey, raw);
      lastRaw = raw;
      writable = true;
    } catch (error) {
      if (writable) console.warn("sync store write failed", error);
      writable = false;
    }
    cache = next;
    notify();
  }

  return {
    scopeKey,
    username,
    clock,
    state: () => cache,
    list: (kind) => listLive(cache, kind),
    get<K extends SyncKind>(kind: K, key: string): LocalRecord<K> | null {
      const record = cache.records[recordID(kind, normalizeSyncKey(key))] as LocalRecord<K> | undefined;
      return record && !record.deleted ? record : null;
    },
    upsert<K extends SyncKind>(kind: K, payload: SyncPayloadMap[K]): LocalRecord<K> | null {
      const adapter = syncAdapter(kind);
      const clean = adapter.coerce(payload);
      const key = adapter.keyOf(clean);
      if (!key) return null;
      const id = recordID(kind, key);
      let record: LocalRecord<K> | null = null;
      update((state) => {
        const existing = state.records[id];
        record = {
          kind,
          key,
          payload: clean,
          eventTimeMs: clock.next(Math.max(existing?.eventTimeMs ?? 0, state.pendingClears[kind] ?? 0)),
          deleted: false,
          dirty: true,
          synced: existing?.synced ?? false,
        };
        return applyCaps({ ...state, records: { ...state.records, [id]: record as LocalRecord } });
      });
      emitLocal(kind);
      return record;
    },
    remove(kind, key) {
      const normalized = normalizeSyncKey(key);
      if (!normalized) return;
      const id = recordID(kind, normalized);
      update((state) => {
        const existing = state.records[id];
        const tombstone = {
          kind,
          key: normalized,
          payload: existing?.payload ?? syncAdapter(kind).coerce({}),
          eventTimeMs: clock.next(existing?.eventTimeMs ?? 0),
          deleted: true,
          dirty: true,
          synced: existing?.synced ?? false,
        } as LocalRecord;
        return { ...state, records: { ...state.records, [id]: tombstone } };
      });
      emitLocal(kind);
    },
    clear(kind) {
      update((state) => {
        let latest = state.pendingClears[kind] ?? 0;
        for (const record of Object.values(state.records)) {
          if (record.kind === kind) latest = Math.max(latest, record.eventTimeMs);
        }
        const clearedAt = clock.next(latest);
        const records = { ...state.records };
        for (const [id, record] of Object.entries(records)) {
          if (record.kind === kind) delete records[id];
        }
        return { ...state, records, pendingClears: { ...state.pendingClears, [kind]: clearedAt } };
      });
      emitLocal(kind);
    },
    update,
    reload() {
      if (writable) {
        let raw: string | null;
        try {
          raw = storage.getItem(scopeKey);
        } catch {
          return;
        }
        if (raw === lastRaw) return;
      }
      cache = readState();
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onLocalChange(listener) {
      localListeners.add(listener);
      return () => {
        localListeners.delete(listener);
      };
    },
  };
}
