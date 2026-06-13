// Auth API surface used by AppViewModel / authStore.
// AppViewModel / authStore 使用的 Auth API 边界.

import type { APIClient } from "./client";
import type { LoginResponse, PasswordRequest, ProfileRequest, User } from "./types";

/**
 * Auth API used by M1 (login/logout/me) and extended in M5 with profile mutation methods.
 * M1 使用的 Auth API (login/logout/me), M5 扩展个人资料变更方法.
 */
export interface AuthAPI {
  login(username: string, password: string): Promise<LoginResponse>;
  logout(): Promise<void>;
  me(): Promise<User>;
  /**
   * Update the authenticated user's username.
   * 更新已认证用户的用户名.
   */
  updateProfile(username: string): Promise<User>;
  /**
   * Change the authenticated user's password.
   * 修改已认证用户的密码.
   */
  changePassword(oldPassword: string, newPassword: string): Promise<void>;
  /**
   * Upload a new avatar from a local file URI. Mirrors iOS `uploadAvatar(imageData:mimeType:)`.
   * 通过本地文件 URI 上传新头像, 对应 iOS `uploadAvatar(imageData:mimeType:)`.
   */
  uploadAvatar(uri: string, mimeType: string): Promise<User>;
  /**
   * Delete the authenticated user's avatar; returns the refreshed User.
   * 删除已认证用户的头像, 返回刷新后的 User.
   */
  deleteAvatar(): Promise<User>;
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
    updateProfile(username) {
      const body: ProfileRequest = { username };
      return client.put<User>("/auth/profile", body);
    },
    async changePassword(oldPassword, newPassword) {
      const body: PasswordRequest = { old_password: oldPassword, new_password: newPassword };
      await client.put<{ message: string }>("/auth/password", body);
    },
    uploadAvatar(uri, mimeType) {
      const form = new FormData();
      // React Native's FormData accepts `{uri, name, type}` for the file part; this is the
      // documented Expo + RN pattern. The Web's polyfilled FormData (used under jest) accepts
      // the same shape because it ignores extra fields and stages the object as the entry value.
      // RN 的 FormData 支持 `{uri, name, type}` 文件描述, 是 Expo + RN 官方推荐写法.
      // jest 下的 Web polyfilled FormData 也接受该形状, 多余字段会被忽略.
      form.append("avatar", { uri, name: "avatar.jpg", type: mimeType } as unknown as Blob);
      return client.putMultipart<User>("/auth/avatar", form);
    },
    deleteAvatar() {
      return client.delReturning<User>("/auth/avatar");
    },
  };
}
