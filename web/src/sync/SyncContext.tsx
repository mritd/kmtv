/**
 * sync/SyncContext.tsx — React wiring for the sync store and engine of the current identity.
 *
 * sync/SyncContext.tsx — 当前身份的同步存储与引擎的 React 接入层.
 *
 * Responsibilities / 职责:
 *   - Create one store per (origin, user) and an engine only for signed-in users — 每个 (origin, 用户) 一个存储, 仅登录用户有引擎
 *   - Sync on launch, foreground, and reconnect; flush with keepalive when hidden — 启动, 回到前台, 恢复网络时同步; 页面隐藏时 keepalive 补写
 *   - Expose read hooks; pages never call sync endpoints directly — 提供读取 hook; 页面不直接调用同步接口
 *
 * Callers / 调用方:
 *   app/AppShell.tsx (mounts SyncProvider inside AuthProvider)
 *   viewer pages (useSync, useSyncList, useSyncRecord)
 *
 * ADR refs: ADR-016 (unified offline-first sync)
 */
import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useAPI } from "@/api/context";
import { useAuth } from "@/auth/AuthContext";
import { toast } from "@/shared/ui/Toast";

import { normalizeSyncKey } from "./normalizeKey";
import { createSyncEngine, type SyncEngine } from "./syncEngine";
import { listLive } from "./syncMerge";
import { createSyncStore, syncScopeKey, type SyncStore } from "./syncStore";
import { recordID, type LocalRecord, type SyncKind, type SyncState } from "./types";
import { classifyWebSyncError, createWebSyncTransport, removeLegacySyncStorage, webRunExclusive } from "./webSync";

/**
 * SyncContextValue is "probing" until auth settles, "disabled" without an identity, else "ready".
 *
 * SyncContextValue 在认证确定前为 "probing", 没有身份时为 "disabled", 否则为 "ready".
 */
export type SyncContextValue =
  | { status: "probing" }
  | { status: "disabled" }
  | { status: "ready"; store: SyncStore; engine: SyncEngine | null };

const SyncContext = createContext<SyncContextValue>({ status: "disabled" });

/**
 * SyncValueProvider supplies a prepared context value; tests use it to inject stores.
 *
 * SyncValueProvider 直接提供准备好的上下文值; 测试用它注入存储.
 */
export const SyncValueProvider = SyncContext.Provider;

/**
 * SyncProvider creates the store and engine of the current identity and drives lifecycle syncs.
 *
 * SyncProvider 为当前身份创建存储和引擎, 并驱动生命周期同步.
 */
export function SyncProvider({ children, storage }: { children: ReactNode; storage?: Storage }) {
  const auth = useAuth();
  const api = useAPI();
  const { t } = useTranslation("viewer");
  const limitMessage = useRef(t("favorites.full"));
  limitMessage.current = t("favorites.full");
  const kind = auth.status.kind;
  const userID = kind === "authenticated" ? auth.status.user.id : kind === "anonymous" ? 0 : null;
  const username = kind === "authenticated" ? auth.status.user.username : "";
  const currentUserID = auth.currentUserID;

  const value = useMemo<SyncContextValue>(() => {
    if (kind === "probing") return { status: "probing" };
    if (userID === null) return { status: "disabled" };
    const store = createSyncStore({
      storage: storage ?? window.localStorage,
      scopeKey: syncScopeKey(window.location.origin, userID),
      username,
    });
    const engine =
      userID > 0
        ? createSyncEngine({
            transport: createWebSyncTransport(api, { userID, currentUserID }),
            classifyError: classifyWebSyncError,
            store,
            runExclusive: webRunExclusive(store.scopeKey),
            onLimit: () => toast.error({ title: limitMessage.current }),
          })
        : null;
    return { status: "ready", store, engine };
  }, [api, kind, userID, username, storage, currentUserID]);

  useEffect(() => {
    if (value.status !== "ready") return;
    const { store, engine } = value;
    removeLegacySyncStorage(storage ?? window.localStorage);
    // Another tab wrote this scope; reload so both tabs show the same data.
    //
    // 其他标签页写入了当前作用域; 重新加载, 让两个标签页显示一致的数据.
    const onStorage = (event: StorageEvent) => {
      if (event.key === store.scopeKey || event.key === null) store.reload();
    };
    window.addEventListener("storage", onStorage);
    engine?.start();
    void engine?.requestSync("launch");
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void engine?.flushNow({ keepalive: true });
      else void engine?.requestSync("foreground");
    };
    const onOnline = () => void engine?.requestSync("online");
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("storage", onStorage);
      engine?.stop();
    };
  }, [value, storage]);

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

/**
 * useSync returns the current sync context value.
 *
 * useSync 返回当前的同步上下文值.
 */
export function useSync(): SyncContextValue {
  return useContext(SyncContext);
}

const noopSubscribe = () => () => undefined;
const nullState = () => null;

function useSyncState(): SyncState | null {
  const sync = useSync();
  const store = sync.status === "ready" ? sync.store : null;
  return useSyncExternalStore(store ? store.subscribe : noopSubscribe, store ? store.state : nullState);
}

/**
 * useSyncList returns the live records of one kind, newest first.
 *
 * useSyncList 返回某类数据的有效记录, 最新的在前.
 */
export function useSyncList<K extends SyncKind>(kind: K): LocalRecord<K>[] {
  const state = useSyncState();
  return useMemo(() => (state ? listLive(state, kind) : []), [state, kind]);
}

/**
 * useSyncRecord returns one live record by raw title or query, or null.
 *
 * useSyncRecord 按原始标题或搜索词返回一条有效记录, 不存在时返回 null.
 */
export function useSyncRecord<K extends SyncKind>(kind: K, key: string): LocalRecord<K> | null {
  const state = useSyncState();
  return useMemo(() => {
    const normalized = normalizeSyncKey(key);
    if (!state || !normalized) return null;
    const record = state.records[recordID(kind, normalized)] as LocalRecord<K> | undefined;
    return record && !record.deleted ? record : null;
  }, [state, kind, key]);
}
