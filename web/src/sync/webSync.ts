/**
 * sync/webSync.ts — browser glue for the shared sync engine: transport, errors, tab lock, cleanup.
 *
 * sync/webSync.ts — 共享同步引擎的浏览器适配: 传输层, 错误分类, 标签页锁和旧数据清理.
 *
 * ADR refs: ADR-016 (unified offline-first sync)
 */
import { APIError, type APIClient } from "@/api/client";

import type { SyncErrorKind, SyncTransport } from "./syncEngine";

/**
 * LEGACY_SYNC_STORAGE_KEYS are the pre-sync localStorage keys removed on startup.
 *
 * LEGACY_SYNC_STORAGE_KEYS 是同步方案之前的 localStorage key, 启动时删除.
 */
export const LEGACY_SYNC_STORAGE_KEYS = ["kmtv.favorites", "kmtv.playback.v1", "kmtv.anonymousWatchHistory.v1"] as const;

/**
 * removeLegacySyncStorage deletes the localStorage keys replaced by the sync store.
 *
 * removeLegacySyncStorage 删除已被同步存储取代的 localStorage key.
 */
export function removeLegacySyncStorage(storage: Storage): void {
  for (const key of LEGACY_SYNC_STORAGE_KEYS) {
    try {
      storage.removeItem(key);
    } catch {
      // Storage can be unavailable in private modes; leftover keys are harmless.
      //
      // 隐私模式下存储可能不可用; 残留的旧 key 不影响功能.
    }
  }
}

/**
 * SyncIdentityChangedError rejects a sync request whose live token no longer belongs to the user of
 * the engine's scope; the engine treats it like a 401 and stops.
 *
 * SyncIdentityChangedError 表示当前 token 已不属于引擎作用域的用户, 同步请求被拒绝; 引擎将其
 * 视同 401 并停止.
 */
export class SyncIdentityChangedError extends Error {
  constructor() {
    super("sync identity changed");
    this.name = "SyncIdentityChangedError";
  }
}

/**
 * WebSyncIdentity binds a transport to one user. `currentUserID` reads the live token snapshot,
 * which can change (another tab switched accounts) before React stops the old engine.
 *
 * WebSyncIdentity 将传输层绑定到一个用户. currentUserID 读取当前的 token 快照; 在 React 停止旧
 * 引擎之前它就可能已经变化 (例如另一个标签页切换了账号).
 */
export interface WebSyncIdentity {
  userID: number;
  currentUserID(): number | null;
}

/**
 * createWebSyncTransport adapts the web API client to the engine transport. Every request first
 * checks that the live token still belongs to the scope's user, so no request carries another
 * user's token. The API client reads the token synchronously in the same call, so the check and
 * the request see the same token.
 *
 * createWebSyncTransport 将 Web API 客户端适配为引擎的传输层. 每个请求先确认当前 token 仍属于
 * 作用域的用户, 因此不会有请求携带其他用户的 token. API 客户端在同一次调用中同步读取 token,
 * 检查和请求看到的是同一个 token.
 */
export function createWebSyncTransport(
  api: Pick<APIClient, "syncPush" | "syncPull">,
  identity: WebSyncIdentity,
): SyncTransport {
  const checkIdentity = () => {
    if (identity.currentUserID() !== identity.userID) throw new SyncIdentityChangedError();
  };
  return {
    push: async (body, options) => {
      checkIdentity();
      return api.syncPush(body, options);
    },
    pull: async (params) => {
      checkIdentity();
      return api.syncPull(params);
    },
  };
}

/**
 * classifyWebSyncError maps 401 and a changed identity to unauthorized, 409 (epoch mismatch or
 * cursor ahead) to conflict, and the rest to retry.
 *
 * classifyWebSyncError 将 401 和身份变化映射为未授权, 409 (epoch 不一致或游标超前) 映射为冲突,
 * 其余为重试.
 */
export function classifyWebSyncError(error: unknown): SyncErrorKind {
  if (error instanceof SyncIdentityChangedError) return "unauthorized";
  if (error instanceof APIError && error.status === 401) return "unauthorized";
  if (error instanceof APIError && error.status === 409) return "conflict";
  return "retry";
}

/**
 * webRunExclusive serializes sync cycles across tabs with a Web Lock when the browser has one.
 *
 * webRunExclusive 在浏览器支持时用 Web Lock 让多个标签页的同步流程串行执行.
 */
export function webRunExclusive(name: string): (task: () => Promise<void>) => Promise<void> {
  return async (task) => {
    const locks = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { locks?: LockManager }).locks;
    if (!locks) {
      await task();
      return;
    }
    await locks.request(name, task);
  };
}
