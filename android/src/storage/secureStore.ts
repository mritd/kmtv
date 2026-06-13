// SecureStore wrapper for the bearer token. Uses EncryptedSharedPreferences on Android.
// 用于 bearer token 的 SecureStore 封装, 在 Android 上使用 EncryptedSharedPreferences.

import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "kmtv.bearer.token";

/**
 * Persist the bearer token to encrypted storage.
 * 将 bearer token 持久化到加密存储.
 */
export async function saveToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

/**
 * Load the persisted bearer token, returning null when absent.
 * 加载持久化的 bearer token, 不存在时返回 null.
 */
export async function loadToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

/**
 * Remove any persisted bearer token.
 * 删除已持久化的 bearer token.
 */
export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
