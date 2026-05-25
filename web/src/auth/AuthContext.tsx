/**
 * AuthContext — reactive auth state for the entire React tree.
 * AuthContext — 为整个 React 树提供响应式的认证状态.
 *
 * Responsibilities / 职责:
 *   - Derive AuthStatus from TokenStore snapshot + boot-probe result — 从 token 快照与启动探测结果派生 AuthStatus
 *   - Run /auth/me boot probe with abort + timeout on every unauthenticated start — 启动时用 abort+超时探测 /auth/me
 *   - Clear user-scoped caches on identity change via authLifecycle — 通过 authLifecycle 在身份变更时清空用户缓存
 *   - Expose login / logout / updateUser surface to the entire component tree — 向组件树暴露 login/logout/updateUser
 *
 * Key exports / 主要导出:
 *   AuthStatus, AuthContextValue, AuthProvider, useAuth
 *
 * Callers / 调用方:
 *   App.tsx (wraps the tree in AuthProvider)
 *   BootGate (reads status.kind to gate route rendering)
 *   LoginPage (calls login(); reacts to status.kind)
 *   AdminPage, AccountPage (reads user, isAuthenticated)
 *
 * ADR refs: ADR-012 (base58 bearer tokens, locked auth model)
 *
 * TIER 4 LOCKED — do NOT change AuthStatus variants, boot-probe semantics,
 * AuthClearReason values, or anonymous-access logic.
 * Tier 4 锁定 — 不得修改 AuthStatus 变体、启动探测语义、AuthClearReason 值或匿名访问逻辑.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { QueryClient } from "@tanstack/react-query";

import type { APIClient } from "@/api/client";
import type { AuthSnapshot, User } from "@/api/types";
import type { TokenStore, AuthClearReason } from "@/api/tokenStore";

import { resetUserScopedState } from "./authLifecycle";

// PROBE_TIMEOUT_MS bounds how long the boot probe spinner can be visible before
// we give up and route to LoginPage.
// PROBE_TIMEOUT_MS
// 限制启动探测旋转图标的最长可见时间, 超时后落到 LoginPage.
const PROBE_TIMEOUT_MS = 1500;

/**
 * AuthStatus is the discriminated union the entire app reads to decide what to render.
 * AuthStatus 是整个应用读取以决定渲染内容的判别联合类型.
 *
 * - "probing"       — no token; waiting for /auth/me to resolve. Render a spinner.
 *                     无 token; 等待 /auth/me 返回, 应展示加载动画.
 * - "anonymous"     — server responded with id=0 (anonymous-access enabled).
 *                     服务器返回 id=0 (已启用匿名访问模式).
 * - "authenticated" — token present and valid.
 *                     token 存在且有效.
 * - "unauthenticated" — probe failed or returned a non-zero authenticated user without a stored token.
 *                       探测失败或返回非零 id 但没有已存储的 token.
 *
 * TIER 4 LOCKED — variant names and fields are consumed by BootGate and AppRoutes.
 * Tier 4 锁定 — 变体名和字段被 BootGate 和 AppRoutes 消费.
 */
export type AuthStatus =
  | { kind: "probing" }
  | { kind: "anonymous"; user: User }
  | { kind: "authenticated"; user: User; snapshot: AuthSnapshot }
  | { kind: "unauthenticated" };

// ProbeResult records the post-probe verdict so status stays a pure derivation of
// (snapshot, probeResult). This avoids overlapping setState calls when a suspending
// subtree might delay commits.
// ProbeResult 记录探测结果, 让 status 成为 (snapshot, probeResult) 的纯派生,
// 避免子树挂起时多个 setState 互相错过提交.
type ProbeResult =
  | { kind: "pending" }
  | { kind: "anonymous"; user: User }
  | { kind: "unauthenticated" };

/**
 * AuthContextValue is the shape every consumer receives from useAuth().
 * AuthContextValue 是每个消费者通过 useAuth() 获得的数据结构.
 *
 * Stable helpers (login / logout / updateUser) are memoised in AuthProvider
 * and safe to pass directly as effect or event-handler dependencies.
 * 稳定的辅助方法 (login/logout/updateUser) 在 AuthProvider 中被 memo 化,
 * 可以直接作为 effect 或事件处理器的依赖项传递.
 */
export interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  isAnonymous: boolean;
  isAuthenticated: boolean;
  lastClearReason: AuthClearReason | null;
  login(username: string, password: string): Promise<void>;
  logout(): Promise<void>;
  updateUser(user: User): void;
}

// AuthContext is null-initialised so the missing-provider guard in useAuth can throw a
// helpful message rather than silently yielding undefined values.
// AuthContext 初始化为 null, 让 useAuth 的缺失 provider 检测能抛出有意义的错误.
const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * AuthProvider mounts the auth state machine at the top of the React tree.
 * AuthProvider 在 React 树顶部挂载认证状态机.
 *
 * Props are stable references that must not change across renders — treat them as
 * constructor arguments injected once at app startup.
 * Props 应为稳定引用, 在渲染间不变 — 视为应用启动时一次性注入的构造参数.
 */
export function AuthProvider({
  api,
  tokenStore,
  queryClient,
  children,
}: {
  api: APIClient;
  tokenStore: TokenStore;
  queryClient: QueryClient;
  children: ReactNode;
}) {
  // useSyncExternalStore tracks the tokenStore with React's concurrent-mode-safe
  // external store binding so snapshot changes always reach commit even when a child
  // subtree is suspending.
  // useSyncExternalStore 用 React 提供的外部 store hook 同步 token 快照,
  // 即便有子树挂起也能保证 snapshot 变更被提交.
  const snapshot = useSyncExternalStore(tokenStore.subscribe, tokenStore.get, tokenStore.get);
  const [probeResult, setProbeResult] = useState<ProbeResult>({ kind: "pending" });

  // Derived status: an active snapshot always wins. Otherwise the most recent probe
  // verdict drives the kind.
  // 派生 status: 有 snapshot 时必为 authenticated, 否则由最近一次探测结果决定.
  const status: AuthStatus = useMemo(() => {
    if (snapshot) return { kind: "authenticated", user: snapshot.user, snapshot };
    if (probeResult.kind === "anonymous") return { kind: "anonymous", user: probeResult.user };
    if (probeResult.kind === "unauthenticated") return { kind: "unauthenticated" };
    return { kind: "probing" };
  }, [snapshot, probeResult]);

  const previousUserID = useRef<number | null>(status.kind === "authenticated" ? status.user.id : null);
  const probeAbortRef = useRef<AbortController | null>(null);
  const probeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelProbe = useCallback(() => {
    if (probeAbortRef.current) {
      probeAbortRef.current.abort();
      probeAbortRef.current = null;
    }
    if (probeTimeoutRef.current) {
      clearTimeout(probeTimeoutRef.current);
      probeTimeoutRef.current = null;
    }
  }, []);

  // Snapshot regained: drop any stale probe result so the next snapshot-loss kicks
  // off a fresh probe instead of reusing a previous verdict.
  // snapshot 重新出现时清除旧的探测结果, 避免下次 snapshot 消失时复用上一轮结论.
  useEffect(() => {
    if (snapshot) {
      cancelProbe();
      setProbeResult((prev) => (prev.kind === "pending" ? prev : { kind: "pending" }));
    }
  }, [snapshot, cancelProbe]);

  // Boot probe: when status enters probing call /auth/me with abort + timeout so the
  // spinner cannot stall on slow/never networks.
  // 启动探测: status 进入 probing 时用 abort + 超时调 /auth/me, 防止网络慢或卡死时一直转圈.
  useEffect(() => {
    if (status.kind !== "probing") return;

    cancelProbe();
    const controller = new AbortController();
    probeAbortRef.current = controller;
    probeTimeoutRef.current = setTimeout(() => {
      controller.abort();
    }, PROBE_TIMEOUT_MS);

    let active = true;
    api
      .me(controller.signal)
      .then((user) => {
        if (!active) return;
        if (user.id === 0) {
          setProbeResult({ kind: "anonymous", user });
        } else {
          setProbeResult({ kind: "unauthenticated" });
        }
      })
      .catch(() => {
        if (!active) return;
        setProbeResult({ kind: "unauthenticated" });
      })
      .finally(() => {
        if (probeAbortRef.current === controller) {
          probeAbortRef.current = null;
        }
        if (probeTimeoutRef.current) {
          clearTimeout(probeTimeoutRef.current);
          probeTimeoutRef.current = null;
        }
      });

    return () => {
      active = false;
      controller.abort();
      if (probeTimeoutRef.current) {
        clearTimeout(probeTimeoutRef.current);
        probeTimeoutRef.current = null;
      }
    };
  }, [status.kind, api, cancelProbe]);

  // Identity-change side effect: clear user-scoped caches when user.id flips.
  // 身份变更副作用: user.id 变化时清空用户作用域缓存.
  useEffect(() => {
    const currentID =
      status.kind === "authenticated" || status.kind === "anonymous" ? status.user.id : null;
    if (currentID !== previousUserID.current) {
      resetUserScopedState(queryClient, { reason: tokenStore.lastClearReason() ?? "logout" }).catch((err) => {
        console.error("resetUserScopedState failed", err);
      });
      previousUserID.current = currentID;
    }
  }, [status, queryClient, tokenStore]);

  useEffect(() => cancelProbe, [cancelProbe]);

  const value = useMemo<AuthContextValue>(() => {
    const user =
      status.kind === "authenticated" || status.kind === "anonymous" ? status.user : null;
    return {
      status,
      user,
      isAnonymous: status.kind === "anonymous",
      isAuthenticated: status.kind === "authenticated",
      lastClearReason: tokenStore.lastClearReason(),
      async login(username, password) {
        cancelProbe();
        await api.login(username, password);
      },
      async logout() {
        cancelProbe();
        try {
          await api.logout();
        } finally {
          // After logout the tokenStore subscription drives status back to probing.
          // logout 之后 tokenStore 订阅会驱动状态回到 probing.
        }
      },
      updateUser(user) {
        const current = tokenStore.get();
        if (!current) return;
        tokenStore.set({ ...current, user });
      },
    };
  }, [status, api, tokenStore, cancelProbe]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * useAuth returns the current AuthContextValue from the nearest AuthProvider.
 * useAuth 从最近的 AuthProvider 返回当前 AuthContextValue.
 *
 * Throws if called outside an AuthProvider — this is intentional; a missing provider
 * is a programming error that must surface immediately, not silently degrade.
 * 在 AuthProvider 外部调用时抛出 — 这是故意的: 缺少 provider 是编程错误, 应立即暴露而非静默降级.
 */
export function useAuth(): AuthContextValue {
  const auth = useContext(AuthContext);
  if (!auth) {
    throw new Error("AuthProvider is missing");
  }
  return auth;
}
