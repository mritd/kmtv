// Bounded ring buffer of recent JS errors persisted in MMKV.
// 持久化在 MMKV 中的近期 JS 错误环形缓冲.

import { getNamespacedStorage, readJSON, writeJSON } from "../storage/mmkv";

const STORAGE = "settings";
const KEY = "kmtv:errorLog";

export const MAX_ERROR_ENTRIES = 50;
export const MAX_MESSAGE_CHARS = 500;
export const MAX_STACK_CHARS = 2000;

export type ErrorSource = "global" | "console";

/**
 * One captured error entry. `ts` is `Date.now()` at write time; message and stack are truncated.
 * 单条错误记录. ts 为写入时的 Date.now(); message / stack 已截断.
 */
export interface ErrorEntry {
  ts: number;
  source: ErrorSource;
  message: string;
  stack?: string;
}

function truncate(s: string, max: number): string {
  // Slice to max - 1 then append `…` so the total length is at most `max`.
  // 切到 max - 1 再追加 `…`, 总长度严格 ≤ max.
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Append an entry. Oldest is evicted once buffer exceeds MAX_ERROR_ENTRIES.
 * Message + stack are truncated so a burst of errors cannot blow the per-key size budget.
 * 追加一条; 超出 MAX_ERROR_ENTRIES 时淘汰最旧条目.
 * message / stack 截断, 突发写入下缓冲整体大小可控.
 */
export function appendErrorEntry(entry: ErrorEntry): void {
  const storage = getNamespacedStorage(STORAGE);
  const current = readJSON<ErrorEntry[]>(storage, KEY, []);
  current.push({
    ts: entry.ts,
    source: entry.source,
    message: truncate(entry.message, MAX_MESSAGE_CHARS),
    ...(entry.stack ? { stack: truncate(entry.stack, MAX_STACK_CHARS) } : {}),
  });
  while (current.length > MAX_ERROR_ENTRIES) current.shift();
  writeJSON(storage, KEY, current);
}

/**
 * Read entries newest-first.
 * 读取条目, 最新在前.
 */
export function loadErrorEntries(): ErrorEntry[] {
  const storage = getNamespacedStorage(STORAGE);
  const current = readJSON<ErrorEntry[]>(storage, KEY, []);
  return [...current].reverse();
}

/**
 * Wipe the buffer.
 * 清空缓冲.
 */
export function clearErrorLog(): void {
  const storage = getNamespacedStorage(STORAGE);
  writeJSON(storage, KEY, []);
}
