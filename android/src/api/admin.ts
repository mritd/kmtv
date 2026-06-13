// AdminAPI factory — wraps APIClient to expose the /admin/* endpoints used by the M6 UI.
// AdminAPI 工厂, 包装 APIClient 暴露 M6 UI 使用的 /admin/* 接口.
//
// NOTE: APIClient auto-prepends "/api/v1" to all paths (see client.ts:6,143). Paths here are bare.
// 注意: APIClient 会自动为所有路径加上 "/api/v1" 前缀, 此处使用裸路径.
//
// Deferred (server endpoints intentionally NOT exposed in M6 — iOS does not surface them either):
//   POST /admin/sources       (create source) — admin UI relies on bulk import + subscription sync
//   PUT  /admin/subscriptions/:id (update subscription) — recreate-then-delete is the usable flow
//   PUT  /admin/users/:id     (update user) — re-create or password reset is the usable flow
// 故意未在 M6 暴露的服务端接口 (iOS 也未提供 UI): 创建源、更新订阅、更新用户.

import type { APIClient } from "./client";
import type {
  AdminUser,
  BulkSetSourcesEnabledRequest,
  CreateSubscriptionRequest,
  CreateUserRequest,
  HealthCheckResponse,
  ImportSourcesResponse,
  SettingsResponse,
  Source,
  SourcesResponse,
  Subscription,
  SubscriptionsResponse,
  UpdateSourceRequest,
  UsersResponse,
} from "./types";

/**
 * AdminAPI — typed admin endpoint surface.
 * AdminAPI — 类型化的管理端接口集合.
 */
export interface AdminAPI {
  listSources(): Promise<Source[]>;
  updateSource(id: number, payload: UpdateSourceRequest): Promise<void>;
  deleteSource(id: number): Promise<void>;
  checkSource(id: number): Promise<HealthCheckResponse>;
  checkAllSources(): Promise<void>;
  bulkSetSourcesEnabled(payload: BulkSetSourcesEnabledRequest): Promise<void>;
  importSources(rawJSON: string): Promise<ImportSourcesResponse>;

  listSubscriptions(): Promise<Subscription[]>;
  createSubscription(payload: CreateSubscriptionRequest): Promise<Subscription>;
  syncSubscription(id: number): Promise<void>;
  deleteSubscription(id: number): Promise<void>;

  listUsers(): Promise<AdminUser[]>;
  createUser(payload: CreateUserRequest): Promise<AdminUser>;
  deleteUser(id: number): Promise<void>;

  getSettings(): Promise<Record<string, string>>;
  updateSettings(patch: Record<string, string>): Promise<void>;
}

/**
 * createAdminAPI binds an AdminAPI to a concrete APIClient.
 * createAdminAPI 将 AdminAPI 绑定到具体的 APIClient.
 */
export function createAdminAPI(client: APIClient): AdminAPI {
  return {
    async listSources() {
      const res = await client.get<SourcesResponse>("/admin/sources");
      return res.sources;
    },
    async updateSource(id, payload) {
      await client.put<void>(`/admin/sources/${id}`, payload);
    },
    async deleteSource(id) {
      await client.del(`/admin/sources/${id}`);
    },
    async checkSource(id) {
      return client.post<HealthCheckResponse>(`/admin/sources/${id}/check`);
    },
    async checkAllSources() {
      await client.post<void>("/admin/sources/check-all");
    },
    async bulkSetSourcesEnabled(payload) {
      await client.post<void>("/admin/sources/bulk-enabled", payload);
    },
    async importSources(rawJSON) {
      return client.post<ImportSourcesResponse>("/admin/sources/import", JSON.parse(rawJSON));
    },

    async listSubscriptions() {
      const res = await client.get<SubscriptionsResponse>("/admin/subscriptions");
      return res.subscriptions;
    },
    async createSubscription(payload) {
      return client.post<Subscription>("/admin/subscriptions", payload);
    },
    async syncSubscription(id) {
      await client.post<void>(`/admin/subscriptions/${id}/sync`);
    },
    async deleteSubscription(id) {
      await client.del(`/admin/subscriptions/${id}`);
    },

    async listUsers() {
      const res = await client.get<UsersResponse>("/admin/users");
      return res.users;
    },
    async createUser(payload) {
      return client.post<AdminUser>("/admin/users", payload);
    },
    async deleteUser(id) {
      await client.del(`/admin/users/${id}`);
    },

    async getSettings() {
      const res = await client.get<SettingsResponse>("/settings");
      return res.settings;
    },
    async updateSettings(patch) {
      await client.put<void>("/admin/settings", patch);
    },
  };
}
