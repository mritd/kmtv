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
 * createWebSyncTransport adapts the web API client to the engine transport.
 *
 * createWebSyncTransport 将 Web API 客户端适配为引擎的传输层.
 */
export function createWebSyncTransport(api: Pick<APIClient, "syncPush" | "syncPull">): SyncTransport {
  return {
    push: (body, options) => api.syncPush(body, options),
    pull: (params) => api.syncPull(params),
  };
}

/**
 * classifyWebSyncError maps 401 to unauthorized, 409 (epoch mismatch or cursor ahead) to conflict,
 * and the rest to retry.
 *
 * classifyWebSyncError 将 401 映射为未授权, 409 (epoch 不一致或游标超前) 映射为冲突, 其余为重试.
 */
export function classifyWebSyncError(error: unknown): SyncErrorKind {
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
