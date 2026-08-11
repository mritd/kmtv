/**
 * storage/anonymousWatchHistory.ts — ordered local watch history for anonymous viewer identity 0.
 *
 * storage/anonymousWatchHistory.ts — 匿名观看者身份 0 的有序本地观看历史.
 *
 * Responsibilities / 职责:
 *   - Persist complete anonymous WatchHistoryPayload records under a versioned localStorage state
 *
 *     — 在版本化 localStorage state 中持久化完整匿名 WatchHistoryPayload 记录
 *
 *   - Preserve clear tombstones so older in-flight writes cannot resurrect cleared history
 *
 *     — 保留清空墓碑, 防止旧的在途写入复活已清空历史
 *
 *   - Expose a stable useSyncExternalStore-compatible snapshot and same-tab/cross-tab subscription
 *
 *     — 暴露适配 useSyncExternalStore 的稳定快照以及同 tab/跨 tab 订阅
 *
 * Key exports / 主要导出:
 *   anonymousWatchHistoryKey, AnonymousWatchHistoryItem, getAnonymousWatchHistory,
 *   getAnonymousWatchHistorySnapshot,
 *   subscribeAnonymousWatchHistory, upsertAnonymousWatchHistory, clearAnonymousWatchHistory
 *
 * Callers / 调用方:
 *   viewer/home/HomePage.tsx, viewer/detail/DetailPage.tsx, tests
 *
 * ADR locks / ADR 约束:
 *   ADR-014 requires bilingual module headers and JSDoc for exports.
 *   ADR-015 assigns anonymous watch history to local user ID 0 with ordered event_time_ms writes.
 *
 *   ADR-014 要求导出符号具备双语模块头和 JSDoc.
 *   ADR-015 将匿名观看历史分配给本地用户 ID 0, 并要求 event_time_ms 有序写入.
 */

import type { WatchHistoryPayload } from "@/api/types";

import { nextWatchHistoryEventTime } from "./watchHistoryClock";

/**
 * anonymousWatchHistoryKey is the versioned localStorage key for anonymous user ID 0 history.
 *
 * 是匿名用户 ID 0 观看历史的版本化 localStorage key.
 */
export const anonymousWatchHistoryKey = "kmtv.anonymousWatchHistory.v1";

/**
 * AnonymousWatchHistoryItem is the local presentation-compatible watch-history entry.
 *
 * 是本地的, 兼容展示层的观看历史条目.
 *
 * `id` is stable and string-based because local anonymous entries do not have server row IDs.
 *
 * id 是稳定字符串, 因为本地匿名条目没有服务端行 ID.
 */
export interface AnonymousWatchHistoryItem extends WatchHistoryPayload {
  id: string;
}

interface AnonymousWatchHistoryState {
  version: 1;
  cleared_at_ms: number;
  entries: Record<string, WatchHistoryPayload>;
}

const maxStoredItems = 100;
const snapshotLimit = 10;
const emptyState: AnonymousWatchHistoryState = { version: 1, cleared_at_ms: 0, entries: {} };
const emptySnapshot: readonly AnonymousWatchHistoryItem[] = Object.freeze([]);

let cachedState: AnonymousWatchHistoryState | null = null;
let cachedSnapshot: readonly AnonymousWatchHistoryItem[] | null = null;
let storageListenerInstalled = false;
const listeners = new Set<() => void>();

/**
 * getAnonymousWatchHistory returns one local anonymous history item by normalized title.
 *
 * 根据归一化标题返回一条本地匿名观看历史.
 *
 * Missing, blank, completed, stale, or invalid entries return null so callers can fall back safely.
 *
 * 缺失, 空白, 已完成, 陈旧或非法条目返回 null, 调用方可安全回退.
 */
export function getAnonymousWatchHistory(title: string): AnonymousWatchHistoryItem | null {
  const key = titleKey(title);
  if (!key) return null;
  const state = ensureState();
  const payload = state.entries[key];
  if (!payload || payload.completed || payload.event_time_ms <= state.cleared_at_ms || !isValidPayload(payload)) {
    return null;
  }
  return { ...payload, id: itemID(key) };
}

/**
 * getAnonymousWatchHistorySnapshot returns the stable incomplete anonymous history snapshot for HomePage.
 *
 * 返回 HomePage 使用的稳定未完成匿名观看历史快照.
 *
 * The same array reference is reused until storage materially changes, which satisfies useSyncExternalStore.
 *
 * 在存储实际变化前复用同一数组引用, 以满足 useSyncExternalStore.
 */
export function getAnonymousWatchHistorySnapshot(): readonly AnonymousWatchHistoryItem[] {
  ensureState();
  return cachedSnapshot ?? emptySnapshot;
}

/**
 * subscribeAnonymousWatchHistory subscribes to same-tab and cross-tab anonymous history changes.
 *
 * 订阅同 tab 和跨 tab 的匿名观看历史变化.
 *
 * The browser storage listener is installed only while subscribers exist.
 *
 * 浏览器 storage 监听器仅在存在订阅者时安装.
 */
export function subscribeAnonymousWatchHistory(listener: () => void): () => void {
  syncCacheFromState(readMergedState());
  listeners.add(listener);
  installStorageListener();
  return () => {
    listeners.delete(listener);
    uninstallStorageListenerIfIdle();
  };
}

/**
 * upsertAnonymousWatchHistory validates and stores one ordered anonymous history checkpoint.
 *
 * 校验并存储一个有序匿名观看历史检查点.
 *
 * Returns the accepted payload, including completed payloads; returns null only for rejected writes.
 *
 * 返回已接受的 payload, 包括已完成 payload; 仅对拒绝写入返回 null.
 */
export function upsertAnonymousWatchHistory(payload: WatchHistoryPayload): AnonymousWatchHistoryItem | null {
  if (!isValidPayload(payload)) return null;
  const key = titleKey(payload.title);
  if (!key) return null;
  const base = readMergedState();
  const previous = base.entries[key];
  if (payload.event_time_ms <= base.cleared_at_ms || (previous && payload.event_time_ms <= previous.event_time_ms)) {
    syncCacheFromState(base);
    return null;
  }
  const next: AnonymousWatchHistoryState = pruneState({
    ...base,
    entries: { ...base.entries, [key]: normalizePayload(payload) },
  });
  if (!writeState(next)) return null;
  syncCacheFromState(next);
  notifyListeners();
  return { ...normalizePayload(payload), id: itemID(key) };
}

/**
 * clearAnonymousWatchHistory clears anonymous entries and persists a new ordered tombstone.
 *
 * 清空匿名条目并持久化新的有序墓碑.
 *
 * The key is retained with empty entries so stale tabs cannot restore pre-clear events.
 *
 * key 会以空 entries 形式保留, 防止陈旧 tab 恢复清空前事件.
 */
export function clearAnonymousWatchHistory(): boolean {
  const base = readMergedState();
  const next: AnonymousWatchHistoryState = {
    version: 1,
    cleared_at_ms: Math.max(nextWatchHistoryEventTime(), base.cleared_at_ms),
    entries: {},
  };
  if (!writeState(next)) return false;
  syncCacheFromState(next);
  notifyListeners();
  return true;
}

function titleKey(title: string): string {
  return title.trim().toLowerCase();
}

function itemID(key: string): string {
  return `anonymous:${key}`;
}

function storageAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function freshEmptyState(clearedAt = 0): AnonymousWatchHistoryState {
  return { version: 1, cleared_at_ms: clearedAt, entries: {} };
}

function ensureState(): AnonymousWatchHistoryState {
  if (cachedState && listeners.size > 0) return cachedState;
  const state = readMergedState();
  syncCacheFromState(state);
  return cachedState ?? emptyState;
}

function readMergedState(): AnonymousWatchHistoryState {
  const hasPersistedState = storedStatePresent();
  const persisted = readStoredState();
  const cached = cachedState;
  if (!hasPersistedState) {
    return freshEmptyState(cached?.cleared_at_ms ?? 0);
  }
  const tombstone = Math.max(persisted.cleared_at_ms, cached?.cleared_at_ms ?? 0);
  const entries: Record<string, WatchHistoryPayload> = {};
  mergeEntries(entries, persisted.entries, tombstone);
  if (cached) {
    mergeEntries(entries, cached.entries, tombstone);
  }
  return pruneState({ version: 1, cleared_at_ms: tombstone, entries });
}

function storedStatePresent(): boolean {
  if (!storageAvailable()) return false;
  try {
    return window.localStorage.getItem(anonymousWatchHistoryKey) !== null;
  } catch {
    return false;
  }
}

function mergeEntries(
  target: Record<string, WatchHistoryPayload>,
  source: Record<string, WatchHistoryPayload>,
  tombstone: number,
): void {
  for (const [key, entry] of Object.entries(source)) {
    if (isValidPayload(entry) && entry.event_time_ms > tombstone) {
      const existing = target[key];
      if (!existing || entry.event_time_ms > existing.event_time_ms) {
        target[key] = normalizePayload(entry);
      }
    }
  }
}

function readStoredState(): AnonymousWatchHistoryState {
  if (!storageAvailable()) return freshEmptyState();
  try {
    const raw = window.localStorage.getItem(anonymousWatchHistoryKey);
    if (!raw) return freshEmptyState();
    return parseState(JSON.parse(raw) as unknown);
  } catch {
    return freshEmptyState();
  }
}

function parseState(value: unknown): AnonymousWatchHistoryState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return freshEmptyState();
  const candidate = value as Partial<AnonymousWatchHistoryState>;
  if (candidate.version !== 1 || !isNonNegativeFinite(candidate.cleared_at_ms) || typeof candidate.entries !== "object" || candidate.entries === null || Array.isArray(candidate.entries)) {
    return freshEmptyState();
  }
  const clearedAt = Math.floor(candidate.cleared_at_ms);
  const entries: Record<string, WatchHistoryPayload> = {};
  for (const [key, entry] of Object.entries(candidate.entries)) {
    if (isValidPayload(entry) && entry.event_time_ms > clearedAt) {
      entries[key] = normalizePayload(entry);
    }
  }
  return pruneState({ version: 1, cleared_at_ms: clearedAt, entries });
}

function writeState(state: AnonymousWatchHistoryState): boolean {
  if (!storageAvailable()) return false;
  try {
    window.localStorage.setItem(anonymousWatchHistoryKey, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

function syncCacheFromState(state: AnonymousWatchHistoryState): void {
  const nextState = pruneState(state);
  const nextSignature = stateSignature(nextState);
  const currentSignature = cachedState ? stateSignature(cachedState) : "";
  if (nextSignature === currentSignature && cachedSnapshot) {
    cachedState = nextState;
    return;
  }
  cachedState = nextState;
  cachedSnapshot = buildSnapshot(nextState);
}

function buildSnapshot(state: AnonymousWatchHistoryState): readonly AnonymousWatchHistoryItem[] {
  const items = Object.entries(state.entries)
    .filter(([, entry]) => !entry.completed && entry.event_time_ms > state.cleared_at_ms && isValidPayload(entry))
    .sort(([, a], [, b]) => b.event_time_ms - a.event_time_ms)
    .slice(0, snapshotLimit)
    .map(([key, entry]) => ({ ...entry, id: itemID(key) }));
  return items.length === 0 ? emptySnapshot : Object.freeze(items);
}

function pruneState(state: AnonymousWatchHistoryState): AnonymousWatchHistoryState {
  const sorted = Object.entries(state.entries)
    .filter(([, entry]) => isValidPayload(entry) && entry.event_time_ms > state.cleared_at_ms)
    .sort(([, a], [, b]) => b.event_time_ms - a.event_time_ms)
    .slice(0, maxStoredItems);
  return { version: 1, cleared_at_ms: Math.floor(state.cleared_at_ms), entries: Object.fromEntries(sorted) };
}

function stateSignature(state: AnonymousWatchHistoryState): string {
  return JSON.stringify(state);
}

function normalizePayload(payload: WatchHistoryPayload): WatchHistoryPayload {
  return {
    source_key: payload.source_key,
    video_id: payload.video_id,
    title: payload.title,
    cover: payload.cover,
    episode: payload.episode,
    group_index: Math.floor(payload.group_index),
    episode_index: Math.floor(payload.episode_index),
    progress_sec: payload.progress_sec,
    duration_sec: payload.duration_sec,
    completed: payload.completed,
    event_time_ms: Math.floor(payload.event_time_ms),
  };
}

function isValidPayload(value: unknown): value is WatchHistoryPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entry = value as Partial<WatchHistoryPayload>;
  return (
    typeof entry.title === "string" &&
    titleKey(entry.title).length > 0 &&
    typeof entry.source_key === "string" &&
    entry.source_key.trim().length > 0 &&
    typeof entry.video_id === "string" &&
    entry.video_id.trim().length > 0 &&
    typeof entry.cover === "string" &&
    typeof entry.episode === "string" &&
    isNonNegativeFinite(entry.progress_sec) &&
    isNonNegativeFinite(entry.duration_sec) &&
    typeof entry.group_index === "number" &&
    Number.isInteger(entry.group_index) &&
    entry.group_index >= 0 &&
    typeof entry.episode_index === "number" &&
    Number.isInteger(entry.episode_index) &&
    entry.episode_index >= 0 &&
    typeof entry.completed === "boolean" &&
    typeof entry.event_time_ms === "number" &&
    Number.isInteger(entry.event_time_ms) &&
    Number.isFinite(entry.event_time_ms) &&
    entry.event_time_ms > 0
  );
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function notifyListeners(): void {
  for (const listener of Array.from(listeners)) {
    listener();
  }
}

function installStorageListener(): void {
  if (storageListenerInstalled || typeof window === "undefined") return;
  window.addEventListener("storage", handleStorageEvent);
  storageListenerInstalled = true;
}

function uninstallStorageListenerIfIdle(): void {
  if (!storageListenerInstalled || listeners.size > 0 || typeof window === "undefined") return;
  window.removeEventListener("storage", handleStorageEvent);
  storageListenerInstalled = false;
}

function handleStorageEvent(event: StorageEvent): void {
  if (event.key !== anonymousWatchHistoryKey) return;
  const persistedPresent = storedStatePresent();
  const persisted = readStoredState();
  const merged = readMergedState();
  if (!persistedPresent || stateSignature(persisted) !== stateSignature(merged)) {
    writeState(merged);
  }
  syncCacheFromState(merged);
  notifyListeners();
}
