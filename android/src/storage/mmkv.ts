// Namespaced MMKV wrapper — one instance per serverURL so data isolates across servers.
// 按 serverURL 命名空间的 MMKV 封装, 不同服务器之间数据彼此隔离.

import { createMMKV, type MMKV } from "react-native-mmkv";

const instances = new Map<string, MMKV>();

/**
 * Stable, filesystem-safe id derived from the server URL. The scheme is preserved so
 * `http://host` and `https://host` get separate namespaces (e.g. dev vs prod).
 * 由服务器地址派生的稳定、文件系统安全的 id. 保留 scheme 以便 `http://host` 与 `https://host`
 * 拥有独立命名空间 (例如 dev 与 prod).
 */
function namespaceId(serverURL: string): string {
  const normalised = serverURL
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalised.length > 0 ? normalised : "default";
}

/**
 * Return (and cache) the MMKV instance for a given serverURL.
 * 返回 (并缓存) 与 serverURL 对应的 MMKV 实例.
 */
export function getNamespacedStorage(serverURL: string): MMKV {
  const id = `kmtv-${namespaceId(serverURL)}`;
  const cached = instances.get(id);
  if (cached) return cached;
  const created = createMMKV({ id });
  instances.set(id, created);
  return created;
}

/**
 * Write any JSON-serialisable value under `key`.
 * 在 `key` 下写入任意可 JSON 序列化的值.
 */
export function writeJSON<T>(storage: MMKV, key: string, value: T): void {
  storage.set(key, JSON.stringify(value));
}

/**
 * Read a JSON value, falling back to `fallback` on missing or malformed data.
 * 读取 JSON 值, 在缺失或损坏时回退到 `fallback`.
 */
export function readJSON<T>(storage: MMKV, key: string, fallback: T): T {
  const raw = storage.getString(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Reset the in-process instance cache. Test-only helper — never call from app code.
 * 重置进程内实例缓存. 仅测试使用, 应用代码请勿调用.
 */
export function _resetForTests(): void {
  instances.clear();
}
