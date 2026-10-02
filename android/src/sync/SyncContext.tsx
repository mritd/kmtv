// sync/SyncContext.tsx — React wiring for the sync store and engine of the active server and user.
//
// sync/SyncContext.tsx — 当前服务器与用户的同步存储和引擎的 React 接入层.
//
// Hook names and shapes match web/src/sync/SyncContext.tsx so useWatchResume.ts is shared verbatim.
//
// hook 名称与形态和 web/src/sync/SyncContext.tsx 一致, 因此 useWatchResume.ts 可以逐字共享.

import React, { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { AppState } from "react-native";

import { getNamespacedStorage } from "@/storage/mmkv";
import { useAuthStore } from "@/store/authStore";
import { useServerStore } from "@/store/serverStore";

import {
  checkSyncServer,
  classifySyncError,
  createDefaultSyncTransport,
  mmkvSyncStorage,
  removeLegacySyncKeys,
  syncServerKey,
} from "./androidSync";
import { clearActiveSyncEngine, isActiveSyncEngine, setActiveSyncEngine } from "./activeSyncEngine";
import { normalizeSyncKey } from "./normalizeKey";
import { createSyncEngine, type SyncEngine, type SyncTransport } from "./syncEngine";
import { listLive } from "./syncMerge";
import { createSyncStore, syncScopeKey, type SyncStore } from "./syncStore";
import { recordID, type LocalRecord, type SyncKind, type SyncState } from "./types";

/**
 * SyncContextValue is "probing" while auth loads, "disabled" without a session, else "ready".
 *
 * SyncContextValue 在认证加载时为 "probing", 没有会话时为 "disabled", 否则为 "ready".
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
 * SyncProviderProps lets the app surface favorite-cap rejections and a server too old to sync, and
 * lets tests replace the transport and the server check.
 *
 * SyncProviderProps 让应用提示收藏已满和服务器版本过旧, 也让测试替换传输层和服务器检查.
 */
export interface SyncProviderProps {
  children: ReactNode;
  onLimit?: () => void;
  onIncompatibleServer?: () => void;
  createTransport?: (serverURL: string, userID: number) => SyncTransport;
  checkServer?: (serverURL: string) => Promise<boolean>;
}

/**
 * SyncProvider creates the store and engine of the active session and drives lifecycle syncs.
 *
 * SyncProvider 为当前会话创建存储和引擎, 并驱动生命周期同步.
 */
export function SyncProvider({
  children,
  onLimit,
  onIncompatibleServer,
  createTransport = createDefaultSyncTransport,
  checkServer = checkSyncServer,
}: SyncProviderProps) {
  const serverURL = useServerStore((s) => s.serverURL);
  const status = useAuthStore((s) => s.status);
  const rawUserID = useAuthStore((s) => s.user?.id);
  const rawUsername = useAuthStore((s) => s.user?.username ?? "");
  const userID = status === "authenticated" && rawUserID !== undefined ? Math.max(0, rawUserID) : null;
  const username = userID !== null && userID > 0 ? rawUsername : "";
  const onLimitRef = useRef(onLimit);
  onLimitRef.current = onLimit;
  const onIncompatibleRef = useRef(onIncompatibleServer);
  onIncompatibleRef.current = onIncompatibleServer;
  const createTransportRef = useRef(createTransport);
  createTransportRef.current = createTransport;
  const checkServerRef = useRef(checkServer);
  checkServerRef.current = checkServer;

  const value = useMemo<SyncContextValue>(() => {
    if (status === "loading") return { status: "probing" };
    if (!serverURL || userID === null) return { status: "disabled" };
    const store = createSyncStore({
      storage: mmkvSyncStorage(getNamespacedStorage(serverURL)),
      scopeKey: syncScopeKey(syncServerKey(serverURL), userID),
      username,
    });
    const engine =
      userID > 0
        ? createSyncEngine({
            transport: createTransportRef.current(serverURL, userID),
            classifyError: classifySyncError,
            store,
            onLimit: () => onLimitRef.current?.(),
          })
        : null;
    // A new engine stays idle until start(), which runs only after the server check below.
    //
    // 新建的引擎在 start() 之前保持空闲, 而 start() 只在下面的服务器检查通过后调用.
    return { status: "ready", store, engine };
  }, [serverURL, status, userID, username]);

  useEffect(() => {
    if (value.status !== "ready" || !serverURL) return;
    removeLegacySyncKeys(getNamespacedStorage(serverURL));
    const { engine } = value;
    if (!engine) return;
    let active = true;
    let subscription: { remove(): void } | null = null;
    // Register the engine before the server check, so a logout during the check unregisters it and
    // the engine never starts.
    //
    // 在服务器检查之前登记引擎, 检查期间退出登录会清除登记, 引擎也就不会启动.
    setActiveSyncEngine(engine);
    // A server older than MIN_SYNC_SERVER_VERSION has no sync endpoints: keep the data local, and
    // stop the never-started engine so syncs requested while waiting for it settle at once.
    //
    // 低于 MIN_SYNC_SERVER_VERSION 的服务器没有同步接口: 数据只保存在本机, 并停止这个从未启动的
    // 引擎, 让等待它的同步请求立即结束.
    void Promise.resolve()
      .then(() => checkServerRef.current(serverURL))
      .catch(() => true)
      .then((compatible) => {
        if (!active || !isActiveSyncEngine(engine)) return;
        if (!compatible) {
          engine.stop();
          onIncompatibleRef.current?.();
          return;
        }
        engine.start();
        void engine.requestSync("launch");
        // Only a return from the background counts as a foreground; other transitions are transient.
        //
        // 只有从后台返回才算回到前台; 其他状态切换都是短暂的.
        let previous = AppState.currentState;
        subscription = AppState.addEventListener("change", (next) => {
          if (next === "active" && previous === "background") void engine.requestSync("foreground");
          else if (next === "background") void engine.flushNow();
          previous = next;
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
      subscription?.remove();
      clearActiveSyncEngine(engine);
      engine.stop();
    };
  }, [value, serverURL]);

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
