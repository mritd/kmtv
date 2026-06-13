// MMKV-backed favorites mirroring apple/Shared/Storage/Favorites.swift.
// 基于 MMKV 的收藏存储, 对应 apple/Shared/Storage/Favorites.swift.

import { getNamespacedStorage, readJSON, writeJSON } from "./mmkv";

const KEY = "kmtv:favorites";

/**
 * Persisted favorite entry. `addedAt` is a monotonic ms timestamp matching watchHistory's contract.
 * 持久化的收藏条目. addedAt 为单调递增的毫秒时间戳, 与 watchHistory 行为一致.
 */
export interface FavoriteItem {
  sourceKey: string;
  videoId: string;
  title: string;
  cover: string;
  type: string;
  year: string;
  addedAt: number;
}

let lastStamp = 0;
function nextStamp(): number {
  const now = Date.now();
  lastStamp = now > lastStamp ? now : lastStamp + 1;
  return lastStamp;
}

function loadAll(serverURL: string): FavoriteItem[] {
  return readJSON<FavoriteItem[]>(getNamespacedStorage(serverURL), KEY, []);
}

function saveAll(serverURL: string, list: FavoriteItem[]): void {
  writeJSON(getNamespacedStorage(serverURL), KEY, list);
}

/**
 * Sorted (newest first) list of favorites for the given server.
 * 该服务器下按 addedAt 倒序返回的收藏列表.
 */
export function listFavorites(serverURL: string): FavoriteItem[] {
  return [...loadAll(serverURL)].sort((a, b) => b.addedAt - a.addedAt);
}

/**
 * True iff the (sourceKey, videoId) tuple is in the favorites list.
 * 当 (sourceKey, videoId) 元组已在收藏列表中时返回 true.
 */
export function isFavorited(serverURL: string, sourceKey: string, videoId: string): boolean {
  return loadAll(serverURL).some((f) => f.sourceKey === sourceKey && f.videoId === videoId);
}

/**
 * Add a favorite. No-op if the (sourceKey, videoId) tuple is already present.
 * 添加收藏. 若 (sourceKey, videoId) 已存在则忽略.
 */
export function addFavorite(serverURL: string, item: Omit<FavoriteItem, "addedAt">): void {
  const list = loadAll(serverURL);
  if (list.some((f) => f.sourceKey === item.sourceKey && f.videoId === item.videoId)) return;
  list.push({ ...item, addedAt: nextStamp() });
  saveAll(serverURL, list);
}

/**
 * Remove the favorite matching (sourceKey, videoId). No-op if absent.
 * 移除匹配 (sourceKey, videoId) 的收藏, 不存在则忽略.
 */
export function removeFavorite(serverURL: string, sourceKey: string, videoId: string): void {
  const list = loadAll(serverURL);
  const filtered = list.filter((f) => !(f.sourceKey === sourceKey && f.videoId === videoId));
  if (filtered.length !== list.length) saveAll(serverURL, filtered);
}

/**
 * Toggle the favorite for (sourceKey, videoId) and return the new is-favorited state.
 * 切换 (sourceKey, videoId) 的收藏状态并返回切换后的 is-favorited 值.
 */
export function toggleFavorite(serverURL: string, item: Omit<FavoriteItem, "addedAt">): boolean {
  if (isFavorited(serverURL, item.sourceKey, item.videoId)) {
    removeFavorite(serverURL, item.sourceKey, item.videoId);
    return false;
  }
  addFavorite(serverURL, item);
  return true;
}
