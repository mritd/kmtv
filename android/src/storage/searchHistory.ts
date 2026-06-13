// MMKV-backed search history (max 20 entries, server-scoped, upsert by query string).
// 基于 MMKV 的搜索历史 (最多 20 条, 按服务器隔离, 按 query 文本 upsert).

import { getNamespacedStorage, readJSON, writeJSON } from "./mmkv";

const KEY = "kmtv:searchHistory";
const HARD_CAP = 20;

/**
 * Persisted history entry.
 * 持久化的历史条目.
 */
export interface SearchHistoryItem {
  query: string;
  searchedAt: number;
}

let lastStamp = 0;
function nextStamp(): number {
  const now = Date.now();
  lastStamp = now > lastStamp ? now : lastStamp + 1;
  return lastStamp;
}

/**
 * Load history entries for a server, newest first. Returns [] when none.
 * 读取某服务器的历史条目, 按最新在前; 无数据时返回 [].
 */
export function loadSearchHistory(serverURL: string): SearchHistoryItem[] {
  const storage = getNamespacedStorage(serverURL);
  return readJSON<SearchHistoryItem[]>(storage, KEY, []);
}

/**
 * Upsert a query: trim, drop empty input, move existing match to the front, cap at HARD_CAP.
 * upsert 一次查询: trim, 丢弃空字符串, 已存在的条目移到首位, 末尾按 HARD_CAP 截断.
 */
export function addSearchHistory(serverURL: string, raw: string): void {
  const query = raw.trim();
  if (!query) return;
  const storage = getNamespacedStorage(serverURL);
  const current = readJSON<SearchHistoryItem[]>(storage, KEY, []);
  const without = current.filter((item) => item.query !== query);
  const next: SearchHistoryItem[] = [{ query, searchedAt: nextStamp() }, ...without];
  if (next.length > HARD_CAP) next.length = HARD_CAP;
  writeJSON(storage, KEY, next);
}

/**
 * Erase every history entry for a server.
 * 清空指定服务器的全部历史.
 */
export function clearSearchHistory(serverURL: string): void {
  const storage = getNamespacedStorage(serverURL);
  writeJSON<SearchHistoryItem[]>(storage, KEY, []);
}
