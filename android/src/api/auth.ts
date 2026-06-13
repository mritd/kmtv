// Auth API surface used by AppViewModel / authStore.
// AppViewModel / authStore 使用的 Auth API 边界.

import type { APIClient } from "./client";
import type { LoginResponse, User } from "./types";

/**
 * Minimal auth API used by M1.
 * M1 使用的最小 Auth API.
 */
export interface AuthAPI {
  login(username: string, password: string): Promise<LoginResponse>;
  logout(): Promise<void>;
  me(): Promise<User>;
}

/**
 * Build an AuthAPI bound to an APIClient instance.
 * 基于 APIClient 实例构造 AuthAPI.
 */
export function createAuthAPI(client: APIClient): AuthAPI {
  return {
    login(username, password) {
      return client.post<LoginResponse>("/auth/login", { username, password });
    },
    async logout() {
      try {
        await client.post<void>("/auth/logout");
      } catch {
        // Best-effort: server may already be unreachable.
        // 尽力而为, 服务器可能已不可达.
      }
    },
    me() {
      return client.get<User>("/auth/me");
    },
  };
}
