/**
 * tokenStore — ADR-012-compliant auth token storage with observer pattern.
 * tokenStore — 符合 ADR-012 的认证令牌存储, 支持观察者模式.
 *
 * Responsibilities / 职责:
 *   - Hold the current AuthSnapshot (accessToken + expiresAt + user) — 持有当前 AuthSnapshot
 *   - Persist snapshot to a StorageLike (localStorage in production) — 持久化到 StorageLike
 *   - Notify subscribers on set/clear for reactive UI updates — set/clear 时通知订阅者
 *   - Cross-tab sync via window "storage" events (local store only) — 通过 storage 事件跨 Tab 同步
 *   - Track the clear reason so auth/Toast can surface the correct message — 记录清除原因
 *
 * Key exports / 主要导出:
 *   StorageLike, AuthClearReason, TokenStore, authStorageKey,
 *   createMemoryTokenStore, createLocalTokenStore, LocalTokenStoreOptions
 *
 * Callers / 调用方:
 *   App.tsx (creates createLocalTokenStore with window.localStorage)
 *   client.ts (reads/clears snapshot on 401 and logout)
 *   auth/AuthContext.tsx (subscribes for reactive login/logout state)
 *   auth/authLifecycle.ts (handles session-expired toast via lastClearReason)
 *
 * ADR refs: ADR-012 (base58 opaque tokens, localStorage key lock)
 *
 * TIER 4 LOCKED — do NOT rename authStorageKey ("kmtv.auth"),
 * change AuthSnapshot shape, or modify token validation semantics.
 * Tier 4 锁定 — 不得重命名 authStorageKey, 修改 AuthSnapshot 形态, 或更改 token 校验语义.
 */

import type { AuthSnapshot } from "./types";

/**
 * StorageLike abstracts the browser Storage API for dependency injection in tests.
 * StorageLike
 * 抽象浏览器 Storage API, 便于在测试中注入依赖.
 *
 * Use `createMemoryStorage()` in tests; pass `window.localStorage` in production.
 * 测试中使用 createMemoryStorage(); 生产中传入 window.localStorage.
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// AuthClearReason classifies why the token snapshot was cleared so the UI can react.
// AuthClearReason
// 标识清除认证快照的原因, 便于 UI 区分提示.
export type AuthClearReason = "logout" | "unauthorized" | "expired" | "external";

/**
 * TokenStore is the public contract for token read/write/observe operations.
 * TokenStore
 * 是 token 读写与观察操作的公开契约接口.
 *
 * Both memory and local-storage variants implement this same interface so callers
 * (client.ts, AuthContext.tsx) never need to know which backend is active.
 * 内存版和 localStorage 版均实现此接口, 调用方无需感知后端类型.
 *
 * `subscribe` returns an unsubscribe function — call it in cleanup to avoid memory leaks.
 * subscribe 返回取消订阅函数 — 请在清理阶段调用以避免内存泄漏.
 */
export interface TokenStore {
  get(): AuthSnapshot | null;
  set(snapshot: AuthSnapshot): void;
  clear(reason?: AuthClearReason): void;
  subscribe(listener: () => void): () => void;
  lastClearReason(): AuthClearReason | null;
}

/**
 * authStorageKey is the localStorage key used to persist the auth snapshot.
 * authStorageKey
 * 是持久化认证快照所用的 localStorage key.
 *
 * TIER 4 LOCKED — renaming breaks existing sessions for all deployed users.
 * Tier 4 锁定 — 重命名会使所有已部署用户的 session 失效.
 */
export const authStorageKey = "kmtv.auth";

// isAuthSnapshot is a runtime type guard that rejects structurally invalid payloads read from
// localStorage. A malformed stored value (e.g. from a schema migration or manual edit) is silently
// dropped and the key is removed, so the app falls back to unauthenticated state rather than crashing.
// isAuthSnapshot
// 对从 localStorage 读出的负载进行运行时类型检查.
// 格式错误的存储值 (如 schema 迁移后的旧数据或手动编辑) 会被静默丢弃并清除槽位, 让应用回退到未认证状态而非崩溃.
function isAuthSnapshot(value: unknown): value is AuthSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<AuthSnapshot>;
  return (
    typeof snapshot.accessToken === "string" &&
    typeof snapshot.expiresAt === "string" &&
    !!snapshot.user &&
    typeof snapshot.user.id === "number" &&
    typeof snapshot.user.username === "string" &&
    (snapshot.user.role === "admin" || snapshot.user.role === "user")
  );
}

/**
 * LocalTokenStoreOptions configures the observable localStorage-backed store.
 * LocalTokenStoreOptions
 * 配置可观察的 localStorage 支持存储.
 *
 * Set `observeWindowStorage: false` in tests to avoid attaching window event listeners.
 * 测试中设置 observeWindowStorage: false 以避免挂载 window 事件监听.
 * Override `storageKey` only to avoid key collisions in multi-instance tests.
 * 仅在多实例测试中需要避免 key 冲突时才覆盖 storageKey.
 */
export interface LocalTokenStoreOptions {
  // observeWindowStorage controls cross-tab sync. In tests we pass false to avoid touching window.
  // observeWindowStorage
  // 控制跨标签同步, 测试中关闭以避免触碰 window.
  observeWindowStorage?: boolean;
  storageKey?: string;
}

/**
 * createMemoryTokenStore returns an in-memory token store with no persistence.
 * createMemoryTokenStore
 * 返回无持久化的内存 token store.
 *
 * Used in unit tests and as the base pattern for the local store.
 * 用于单元测试, 也是本地 store 的基础模式.
 */
export function createMemoryTokenStore(initial: AuthSnapshot | null = null): TokenStore {
  let current = initial;
  let lastReason: AuthClearReason | null = null;
  const listeners = new Set<() => void>();
  const notify = () => { for (const l of listeners) l(); };
  return {
    get: () => current,
    set: (snapshot) => { current = snapshot; lastReason = null; notify(); },
    clear: (reason = "logout") => { current = null; lastReason = reason; notify(); },
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    lastClearReason: () => lastReason,
  };
}

// createLocalTokenStore preserves the StorageLike contract and adds observable + cross-tab sync.
// createLocalTokenStore
// 保留 StorageLike 契约, 新增订阅与跨标签同步.
export function createLocalTokenStore(
  storage: StorageLike = window.localStorage,
  options: LocalTokenStoreOptions = {},
): TokenStore {
  const key = options.storageKey ?? authStorageKey;
  const observeWindow = options.observeWindowStorage !== false;
  const listeners = new Set<() => void>();
  let lastReason: AuthClearReason | null = null;
  let cached: AuthSnapshot | null = readFromStorage();

  function readFromStorage(): AuthSnapshot | null {
    const raw = storage.getItem(key);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isAuthSnapshot(parsed)) return parsed;
    } catch {
      // Invalid auth cache must not block app startup.
      // 无效认证缓存不能阻塞应用启动.
    }
    storage.removeItem(key);
    return null;
  }

  function notify() { for (const listener of listeners) listener(); }

  function onStorageEvent(event: StorageEvent) {
    // Same-tab writes do NOT dispatch storage events;
    // this only fires from other tabs.
    // 同 tab 写入不会触发 storage, 此处只处理跨 tab.
    if (event.storageArea !== window.localStorage) return;
    if (event.key !== key && event.key !== null) return;
    const next = readFromStorage();
    const changed = JSON.stringify(next) !== JSON.stringify(cached);
    if (!changed) return;
    cached = next;
    if (!next) lastReason = "external";
    notify();
  }

  if (observeWindow && typeof window !== "undefined") {
    window.addEventListener("storage", onStorageEvent);
  }

  return {
    get: () => cached,
    set: (snapshot) => {
      cached = snapshot;
      lastReason = null;
      storage.setItem(key, JSON.stringify(snapshot));
      notify();
    },
    clear: (reason = "logout") => {
      cached = null;
      lastReason = reason;
      storage.removeItem(key);
      notify();
    },
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    lastClearReason: () => lastReason,
  };
}
