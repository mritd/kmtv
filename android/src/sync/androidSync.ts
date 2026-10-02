// sync/androidSync.ts — Android glue for the shared sync engine: MMKV storage, transport, errors, cleanup.
//
// sync/androidSync.ts — 共享同步引擎的 Android 适配: MMKV 存储, 传输层, 错误分类和旧数据清理.

import type { MMKV } from "react-native-mmkv";

import { createAPIClient, type APIClient } from "@/api/client";
import type { SettingsResponse } from "@/api/types";
import { useAuthStore } from "@/store/authStore";

import type { SyncErrorKind, SyncTransport } from "./syncEngine";
import type { SyncStorage } from "./syncStore";
import type { SyncPullResponse, SyncPushResponse } from "./types";

/**
 * LEGACY_SYNC_KEYS are the pre-sync MMKV keys removed when a sync scope opens.
 *
 * LEGACY_SYNC_KEYS 是同步方案之前的 MMKV key, 打开同步作用域时删除.
 */
export const LEGACY_SYNC_KEYS = ["kmtv:watchHistory", "kmtv:favorites", "kmtv:searchHistory"] as const;

const LEGACY_USER_HISTORY_PREFIX = "kmtv:watchHistory:user:";

/**
 * MIN_SYNC_SERVER_VERSION is the first server release with the sync endpoints.
 *
 * MIN_SYNC_SERVER_VERSION 是第一个提供同步接口的服务端版本.
 */
export const MIN_SYNC_SERVER_VERSION = "v1.1.0";

/**
 * syncServerKey normalizes a server URL for the sync scope key, so "http://Host/" and "http://host"
 * share one scope.
 *
 * syncServerKey 规范化同步作用域 key 中的服务器 URL, 使 "http://Host/" 与 "http://host" 共用一个作用域.
 */
export function syncServerKey(serverURL: string): string {
  return serverURL.trim().replace(/\/+$/, "").toLowerCase();
}

function parseVersion(version: string): number[] | null {
  const core = version.trim().replace(/^v/, "").split("-")[0] ?? "";
  const parts = core.split(".");
  if (parts.length !== 3 || !parts.every((part) => /^\d+$/.test(part))) return null;
  return parts.map(Number);
}

/**
 * isSyncServerVersion reports whether a server version has the sync endpoints. A development build
 * (v0.0.0-dev) qualifies; an unparsable version does not.
 *
 * isSyncServerVersion 判断某个服务端版本是否提供同步接口. 开发版本 (v0.0.0-dev) 视为满足;
 * 无法解析的版本视为不满足.
 */
export function isSyncServerVersion(version: string): boolean {
  if (version.trim() === "v0.0.0-dev") return true;
  const have = parseVersion(version);
  const need = parseVersion(MIN_SYNC_SERVER_VERSION);
  if (!have || !need) return false;
  for (let i = 0; i < 3; i += 1) {
    const a = have[i] ?? 0;
    const b = need[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

/**
 * checkSyncServer resolves false only when the server reports a version older than
 * MIN_SYNC_SERVER_VERSION. A failed request or a missing version resolves true: the engine's retry
 * backoff already covers an unreachable server.
 *
 * checkSyncServer 仅在服务端报告的版本低于 MIN_SYNC_SERVER_VERSION 时返回 false. 请求失败或没有
 * 版本信息时返回 true: 引擎的重试退避已经能处理暂时无法访问的服务器.
 */
export async function checkSyncServer(
  serverURL: string,
  // The check never signs the user out; the engine handles a 401 itself.
  //
  // 检查本身从不退出登录; 401 由引擎自行处理.
  client: Pick<APIClient, "get"> = createAPIClient({
    baseURL: serverURL,
    getToken: () => useAuthStore.getState().token,
    onUnauthorized: () => undefined,
  }),
): Promise<boolean> {
  try {
    const version = (await client.get<SettingsResponse>("/settings")).settings?.version;
    return typeof version !== "string" || version === "" || isSyncServerVersion(version);
  } catch {
    return true;
  }
}

/**
 * mmkvSyncStorage adapts one MMKV instance to the shared SyncStorage interface.
 *
 * mmkvSyncStorage 将一个 MMKV 实例适配为共享的 SyncStorage 接口.
 */
export function mmkvSyncStorage(storage: MMKV): SyncStorage {
  return {
    getItem: (key) => storage.getString(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
}

/**
 * removeLegacySyncKeys deletes the watch history, favorites, and search history keys the sync store replaced.
 *
 * removeLegacySyncKeys 删除已被同步存储取代的观看历史, 收藏和搜索历史 key.
 */
export function removeLegacySyncKeys(storage: MMKV): void {
  const legacy: readonly string[] = LEGACY_SYNC_KEYS;
  for (const key of storage.getAllKeys()) {
    if (legacy.includes(key) || key.startsWith(LEGACY_USER_HISTORY_PREFIX)) storage.remove(key);
  }
}

/**
 * SyncIdentityChangedError rejects a sync request whose signed-in user is no longer the user of the
 * engine's scope; the engine treats it like a 401 and stops.
 *
 * SyncIdentityChangedError 表示当前登录用户已不是引擎作用域的用户, 同步请求被拒绝; 引擎将其
 * 视同 401 并停止.
 */
export class SyncIdentityChangedError extends Error {
  constructor() {
    super("sync identity changed");
    this.name = "SyncIdentityChangedError";
  }
}

/**
 * SyncIdentity binds a transport to one user. `currentUserID` reads the live auth state, which can
 * change before React stops the old engine.
 *
 * SyncIdentity 将传输层绑定到一个用户. currentUserID 读取当前的认证状态; 在 React 停止旧引擎之前
 * 它就可能已经变化.
 */
export interface SyncIdentity {
  userID: number;
  currentUserID(): number | null;
}

/**
 * createSyncTransport sends sync requests through an APIClient. With an identity, every request first
 * checks that the signed-in user is still the scope's user, so no request carries another user's
 * token. Native requests need no keepalive.
 *
 * createSyncTransport 通过 APIClient 发送同步请求. 传入 identity 时, 每个请求先确认当前登录用户
 * 仍是作用域的用户, 因此不会有请求携带其他用户的 token. 原生请求不需要 keepalive.
 */
export function createSyncTransport(client: Pick<APIClient, "get" | "post">, identity?: SyncIdentity): SyncTransport {
  const checkIdentity = () => {
    if (identity && identity.currentUserID() !== identity.userID) throw new SyncIdentityChangedError();
  };
  return {
    push: async (body) => {
      checkIdentity();
      return client.post<SyncPushResponse>("/sync/push", body);
    },
    pull: async ({ since, epoch, limit, full }) => {
      checkIdentity();
      // Build the query from a record: React Native's URLSearchParams lacks set().
      //
      // 用对象构造查询参数: React Native 的 URLSearchParams 没有 set().
      const query: Record<string, string> = { since: String(since), limit: String(limit) };
      if (epoch) query.epoch = epoch;
      if (full) query.full = "1";
      return client.get<SyncPullResponse>(`/sync/pull?${new URLSearchParams(query).toString()}`);
    },
  };
}

/**
 * createDefaultSyncTransport builds the transport for a server with the signed-in token, bound to
 * the scope's user.
 *
 * createDefaultSyncTransport 使用当前登录 token 为某个服务器创建传输层, 并绑定到作用域的用户.
 */
export function createDefaultSyncTransport(serverURL: string, userID: number): SyncTransport {
  return createSyncTransport(
    createAPIClient({
      baseURL: serverURL,
      getToken: () => useAuthStore.getState().token,
      onUnauthorized: () => useAuthStore.getState().handleAuthExpired(),
    }),
    {
      userID,
      currentUserID: () => {
        const auth = useAuthStore.getState();
        return auth.status === "authenticated" ? auth.user?.id ?? null : null;
      },
    },
  );
}

/**
 * classifySyncError maps unauthorized and a changed identity to "unauthorized", HTTP 409 (epoch
 * mismatch or cursor ahead) to "conflict", and the rest to "retry".
 *
 * classifySyncError 将未授权和身份变化映射为 "unauthorized", HTTP 409 (epoch 不一致或游标超前)
 * 映射为 "conflict", 其余为 "retry".
 */
export function classifySyncError(error: unknown): SyncErrorKind {
  if (error instanceof SyncIdentityChangedError) return "unauthorized";
  const value = (typeof error === "object" && error !== null ? error : {}) as { kind?: unknown; status?: unknown };
  if (value.kind === "unauthorized") return "unauthorized";
  if (value.kind === "server" && value.status === 409) return "conflict";
  return "retry";
}
