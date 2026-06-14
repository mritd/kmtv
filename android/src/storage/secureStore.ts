// SecureStore wrapper for the bearer token. Uses EncryptedSharedPreferences on Android,
// localStorage on every non-native platform (web, future Expo macOS/Windows targets);
// expo-secure-store only ships native modules for android + ios so anything else would crash.
// In-memory fallback covers SSR / Node test environments where localStorage is also missing,
// so a missing localStorage cannot fall through to the broken native module.
// 用于 bearer token 的 SecureStore 封装, Android 用 EncryptedSharedPreferences,
// 其它非原生平台 (web 以及未来的 Expo macOS / Windows) 回退到 localStorage,
// expo-secure-store 只在 android + ios 提供原生模块, 其它平台直接调用会崩.
// SSR / Node 测试环境无 localStorage 时使用内存兜底, 不会再回落到那条会崩的原生路径.

import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "kmtv.bearer.token";

/**
 * `Platform.OS` only safely maps to `expo-secure-store` native modules for android + ios.
 * Anything else (web / windows / macos / ssr) must use a non-native storage to avoid
 * `ExpoSecureStore.default.getValueWithKeyAsync is not a function`-style crashes.
 * 仅 android + ios 安全映射到 expo-secure-store 原生模块, 其它平台必须用非原生存储.
 */
function isNativePlatform(): boolean {
  return Platform.OS === "android" || Platform.OS === "ios";
}

// Process-local fallback so SSR / Node test environments without `localStorage` still round-trip.
// 无 localStorage 的 SSR / Node 测试环境下进程内兜底, 保证 token 仍可往返.
const memoryStore = new Map<string, string>();

interface SyncStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function nonNativeStorage(): SyncStorage {
  const ls = (globalThis as { localStorage?: Storage }).localStorage;
  if (ls && typeof ls.getItem === "function") return ls;
  return {
    getItem: (k) => (memoryStore.has(k) ? memoryStore.get(k)! : null),
    setItem: (k, v) => { memoryStore.set(k, v); },
    removeItem: (k) => { memoryStore.delete(k); },
  };
}

/**
 * Persist the bearer token to encrypted storage.
 * 将 bearer token 持久化到加密存储.
 */
export async function saveToken(token: string): Promise<void> {
  if (!isNativePlatform()) {
    nonNativeStorage().setItem(TOKEN_KEY, token);
    return;
  }
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

/**
 * Load the persisted bearer token, returning null when absent.
 * 加载持久化的 bearer token, 不存在时返回 null.
 */
export async function loadToken(): Promise<string | null> {
  if (!isNativePlatform()) {
    return nonNativeStorage().getItem(TOKEN_KEY);
  }
  return SecureStore.getItemAsync(TOKEN_KEY);
}

/**
 * Remove any persisted bearer token.
 * 删除已持久化的 bearer token.
 */
export async function clearToken(): Promise<void> {
  if (!isNativePlatform()) {
    nonNativeStorage().removeItem(TOKEN_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
