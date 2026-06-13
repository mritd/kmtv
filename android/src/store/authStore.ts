// English. 中文.
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
        await clearToken();
        useServerStore.getState().clearServerURL();
      }
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
}));
