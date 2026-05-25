/**
 * localStorage-backed ThemeStore implementation.
 * Reads and writes the user's theme preference under the locked key "kmtv.theme".
 * Corrupted JSON is silently discarded and the default preference is returned.
 *
 * 基于 localStorage 的 ThemeStore 实现.
 * 在锁定 key "kmtv.theme" 下读写用户主题偏好.
 * 损坏的 JSON 将被静默丢弃并返回默认偏好.
 *
 * Exports: ThemeStorageLike, themeStorageKey, createLocalThemeStore.
 *
 * Callers / 调用方:
 *   - ThemeProvider.tsx — uses createLocalThemeStore() as the default store prop
 *
 * IMPORTANT: The localStorage key "kmtv.theme" is Tier-4 locked — do not rename.
 * Renaming would cause every existing user to lose their saved theme preference.
 *
 * 重要: localStorage key "kmtv.theme" 为 Tier-4 锁定 — 不得重命名.
 * 重命名将导致所有已有用户丢失其保存的主题偏好.
 */

import { defaultThemePreference, normalizeThemePreference, type ThemePreference, type ThemeStore } from "./themes";

// ---------------------------------------------------------------------------
// Storage abstraction
// ---------------------------------------------------------------------------

/**
 * Minimal subset of the Storage interface required by createLocalThemeStore.
 * Allows test-time injection of an in-memory store instead of window.localStorage.
 *
 * createLocalThemeStore 所需的 Storage 接口最小子集.
 * 允许在测试时注入内存存储代替 window.localStorage.
 */
export interface ThemeStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// ---------------------------------------------------------------------------
// Locked storage key
// ---------------------------------------------------------------------------

/**
 * The localStorage key under which the user's theme preference is persisted.
 * Tier-4 locked: renaming breaks existing stored preferences for all users.
 *
 * 用户主题偏好持久化的 localStorage key.
 * Tier-4 锁定: 重命名将破坏所有用户已存储的偏好.
 */
export const themeStorageKey = "kmtv.theme";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a ThemeStore backed by the given StorageLike (defaults to window.localStorage).
 * - get(): reads from storage, falls back to defaultThemePreference on missing or corrupt data.
 * - set(): normalizes via normalizeThemePreference before writing, so invalid preferences are
 *          never persisted.
 *
 * 创建由给定 StorageLike (默认 window.localStorage) 支撑的 ThemeStore.
 * - get(): 从存储读取; 数据缺失或损坏时回退到 defaultThemePreference.
 * - set(): 写入前通过 normalizeThemePreference 规范化, 确保无效偏好不被持久化.
 *
 * @param storage - Injectable StorageLike; defaults to window.localStorage for production.
 *                  可注入的 StorageLike; 生产环境默认使用 window.localStorage.
 */
export function createLocalThemeStore(storage: ThemeStorageLike = window.localStorage): ThemeStore {
  return {
    get: () => {
      const raw = storage.getItem(themeStorageKey);
      if (!raw) {
        return defaultThemePreference;
      }

      try {
        return normalizeThemePreference(JSON.parse(raw) as unknown);
      } catch {
        storage.removeItem(themeStorageKey);
        return defaultThemePreference;
      }
    },
    set: (preference: ThemePreference) => {
      storage.setItem(themeStorageKey, JSON.stringify(normalizeThemePreference(preference)));
    },
  };
}
