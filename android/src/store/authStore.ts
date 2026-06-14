// authStore orchestrates server connection, login, logout, and 401 recovery.
// authStore 协调服务器连接、登录、登出与 401 恢复.

import { create } from "zustand";

import type { APIError } from "../api/apiError";
import { createAuthAPI, type AuthAPI } from "../api/auth";
import { createAPIClient, type APIClient } from "../api/client";
import type { User } from "../api/types";
import { clearToken, loadToken, saveToken } from "../storage/secureStore";
import { useServerStore } from "./serverStore";

/**
 * Authentication lifecycle state mirrored from iOS AppState.
 * 镜像 iOS AppState 的认证生命周期状态.
 */
export type AuthStatus = "loading" | "serverSetup" | "authenticated" | "incompatibleServer";

/**
 * Factory used to inject a fake AuthAPI in tests.
 * 测试中注入伪 AuthAPI 的工厂.
 */
export type AuthAPIFactory = (client: APIClient) => AuthAPI;

interface AuthState {
  status: AuthStatus;
  user: User | null;
  token: string | null;
  serverVersion: string;

  bootstrap: (factory?: AuthAPIFactory) => Promise<void>;
  connectServer: (
    url: string,
    username: string,
    password: string,
    factory?: AuthAPIFactory,
  ) => Promise<void>;
  logout: () => Promise<void>;
  handleAuthExpired: () => void;
  /**
   * Replace the in-memory user (used after profile/avatar mutations).
   * 替换内存中的 user (用于 profile / avatar 变更后).
   */
  updateUser: (user: User) => void;
}

/**
 * Build the APIClient that the auth flows talk to, wired to the current token + 401 callback.
 * 构造 auth 流程使用的 APIClient, 绑定当前 token 与 401 回调.
 */
function makeClient(baseURL: string, getToken: () => string | null): APIClient {
  return createAPIClient({
    baseURL,
    getToken,
    onUnauthorized: () => {
      useAuthStore.getState().handleAuthExpired();
    },
  });
}

/**
 * Zustand store exposing the auth lifecycle to screens and navigators.
 * 向页面与导航暴露 auth 生命周期的 zustand store.
 */
export const useAuthStore = create<AuthState>((set, get) => ({
  status: "loading",
  user: null,
  token: null,
  serverVersion: "",

  bootstrap: async (factory = (c) => createAuthAPI(c)) => {
    // Outer try wraps everything BEFORE the me() call so any throw in storage hydrate /
    // loadToken / makeClient / factory invocation still hands control back to ServerSetup
    // instead of leaving status pinned at "loading" (a forever-spinner). Programmer-level
    // failures (TypeError from a typo, ...) are surfaced via console.error so they remain
    // visible during development and via the diagnostics ring buffer in production.
    // 外层 try 包住 me() 之前的所有代码, 任何异常都把控制权交回 ServerSetup, 而不是把 status 卡在 "loading".
    // 编程级错误 (typo 触发的 TypeError 等) 通过 console.error 暴露, 开发期可见, 生产期也会进入诊断环形缓冲.
    try {
      useServerStore.getState().hydrate();
      const serverURL = useServerStore.getState().serverURL;
      if (!serverURL) {
        set({ status: "serverSetup" });
        return;
      }
      const token = await loadToken();
      set({ token });
      const client = makeClient(serverURL, () => get().token);
      const auth = factory(client);
      try {
        const me = await auth.me();
        set({ user: me, status: "authenticated" });
      } catch (e) {
        const err = e as APIError;
        if (err.kind === "unauthorized") {
          await clearToken().catch(() => undefined);
          useServerStore.getState().clearServerURL();
        }
        set({ status: "serverSetup", token: null, user: null });
      }
    } catch (e) {
      // Programmer / native-module errors land here. Log so they don't disappear
      // silently, then recover to ServerSetup so the UI is never stuck.
      // 编程错误或原生模块异常落到这里, 先打日志避免静默, 再恢复到 ServerSetup, 防止 UI 卡死.
      console.error("authStore.bootstrap unexpected error", e);
      set({ status: "serverSetup", token: null, user: null });
    }
  },

  connectServer: async (url, username, password, factory = (c) => createAuthAPI(c)) => {
    useServerStore.getState().setServerURL(url);
    const client = makeClient(url, () => get().token);
    const auth = factory(client);
    try {
      if (username.length > 0 && password.length > 0) {
        const resp = await auth.login(username, password);
        await saveToken(resp.access_token);
        // The server returns a flat object: id/username/role/avatar plus access_token/expires_at.
        // We split it back into User + token for in-memory state.
        // server 返回扁平对象: id/username/role/avatar 加 access_token/expires_at, 这里拆分为 User + token.
        const user: User = { id: resp.id, username: resp.username, role: resp.role, avatar: resp.avatar };
        set({ token: resp.access_token, user, status: "authenticated" });
      } else {
        const me = await auth.me();
        set({ user: me, status: "authenticated" });
      }
    } catch (e) {
      useServerStore.getState().clearServerURL();
      await clearToken();
      set({ token: null, user: null, status: "serverSetup" });
      throw e;
    }
  },

  logout: async () => {
    const baseURL = useServerStore.getState().serverURL;
    if (baseURL) {
      const client = makeClient(baseURL, () => get().token);
      const auth = createAuthAPI(client);
      try { await auth.logout(); } catch { /* best-effort */ }
    }
    await clearToken();
    useServerStore.getState().clearServerURL();
    set({ token: null, user: null, status: "serverSetup", serverVersion: "" });
  },

  handleAuthExpired: () => {
    void clearToken();
    useServerStore.getState().clearServerURL();
    set({ token: null, user: null, status: "serverSetup", serverVersion: "" });
  },

  updateUser: (user) => set({ user }),
}));
