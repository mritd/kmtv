// English. 中文.
// Single-server mode: persist the currently selected server URL in a global MMKV root.
// 单服务器模式: 将当前选择的服务器 URL 存入全局 MMKV 根命名空间.

import { createMMKV } from "react-native-mmkv";

const root = createMMKV({ id: "kmtv-root" });
const KEY = "currentServerURL";

/**
 * Persist the currently selected server URL.
 * 持久化当前选择的服务器 URL.
 */
export function saveServerURL(url: string): void {
  root.set(KEY, url);
}

/**
 * Load the persisted server URL, null when unset.
 * 加载持久化的服务器 URL, 未设置时为 null.
 */
export function loadServerURL(): string | null {
  return root.getString(KEY) ?? null;
}

/**
 * Remove any persisted server URL.
 * 删除已持久化的服务器 URL.
 */
export function clearServerURL(): void {
  root.remove(KEY);
}
