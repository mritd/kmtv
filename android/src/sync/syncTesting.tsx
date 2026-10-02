// sync/syncTesting.tsx — test helpers: in-memory sync stores and a provider that injects them.
//
// sync/syncTesting.tsx — 测试辅助: 内存同步存储以及注入它们的 provider.

import React, { type ReactNode } from "react";

import { SyncValueProvider } from "./SyncContext";
import { createSyncClock } from "./syncClock";
import type { SyncEngine } from "./syncEngine";
import { createSyncStore, syncScopeKey, type SyncStorage, type SyncStore } from "./syncStore";

/**
 * memorySyncStorage returns a SyncStorage backed by a Map.
 *
 * memorySyncStorage 返回由 Map 支撑的 SyncStorage.
 */
export function memorySyncStorage(): SyncStorage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

// tickingNow advances one millisecond per call. Event times are monotonic per record only, so
// records written one after another in a test need distinct wall times to sort newest first.
//
// tickingNow 每次调用前进一毫秒. 事件时间只按记录单调递增, 因此测试中依次写入的记录需要
// 不同的时间才能按最新优先排序.
function tickingNow(start = 1_790_000_000_000): () => number {
  let now = start;
  return () => (now += 1);
}

/**
 * memorySyncStore opens an in-memory store for one test identity, with a clock that ticks per write.
 *
 * memorySyncStore 为某个测试身份打开一个内存存储, 其时钟每次写入前进一毫秒.
 */
export function memorySyncStore(userID = 0, username = ""): SyncStore {
  return createSyncStore({
    storage: memorySyncStorage(),
    scopeKey: syncScopeKey("http://test", userID),
    username,
    clock: createSyncClock(0, tickingNow()),
  });
}

/**
 * SyncTestProvider exposes a prepared store (and optional engine) to the component under test.
 *
 * SyncTestProvider 将准备好的存储 (以及可选的引擎) 提供给被测组件.
 */
export function SyncTestProvider({ store, engine = null, children }: { store: SyncStore; engine?: SyncEngine | null; children: ReactNode }) {
  return <SyncValueProvider value={{ status: "ready", store, engine }}>{children}</SyncValueProvider>;
}
