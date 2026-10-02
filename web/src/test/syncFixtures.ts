/**
 * test/syncFixtures.ts — helpers for seeding sync stores and building sync responses in tests.
 *
 * test/syncFixtures.ts — 测试中预置同步存储和构造同步响应的辅助函数.
 */
import { createSyncStore, syncScopeKey, type SyncStore } from "@/sync/syncStore";
import type { SyncPullResponse, SyncPushRequest, SyncPushResponse } from "@/sync/types";

/**
 * openSyncStore opens the real localStorage store of one test identity.
 *
 * openSyncStore 打开某个测试身份对应的真实 localStorage 存储.
 */
export function openSyncStore(userID: number, username: string): SyncStore {
  return createSyncStore({
    storage: window.localStorage,
    scopeKey: syncScopeKey(window.location.origin, userID),
    username,
  });
}

/**
 * seedSyncStore writes records into one identity's store before a component renders.
 *
 * seedSyncStore 在组件渲染前向某个身份的存储写入记录.
 */
export function seedSyncStore(userID: number, username: string, seed: (store: SyncStore) => void): SyncStore {
  const store = openSyncStore(userID, username);
  seed(store);
  return store;
}

/**
 * emptyPullResponse builds a pull page with no changes.
 *
 * emptyPullResponse 构造一页没有变更的拉取结果.
 */
export function emptyPullResponse(overrides: Partial<SyncPullResponse> = {}): SyncPullResponse {
  return {
    epoch: "test-epoch",
    server_time_ms: Date.now(),
    rev: 0,
    reset: false,
    has_more: false,
    clears: [],
    records: [],
    ...overrides,
  };
}

/**
 * appliedPushResponse acknowledges every change of a push without returning records.
 *
 * appliedPushResponse 确认推送中的每条变更, 不返回记录.
 */
export function appliedPushResponse(body: SyncPushRequest): SyncPushResponse {
  return {
    epoch: "test-epoch",
    rev: body.changes.length,
    server_time_ms: Date.now(),
    results: body.changes.map((_change, index) => ({ index, status: "applied", record: null })),
  };
}
