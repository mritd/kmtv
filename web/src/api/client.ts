/**
 * API client — typed HTTP wrapper for all /api/v1 endpoints.
 * API 客户端 — 覆盖所有 /api/v1 端点的类型化 HTTP 封装.
 *
 * Responsibilities / 职责:
 *   - Build request headers (Bearer token, Content-Type, multipart) — 构建请求头
 *   - Parse JSON responses and surface typed APIError on non-2xx — 解析 JSON, 非 2xx 抛出 APIError
 *   - Coordinate token lifecycle: set on login, clear on logout/401 — 协调 token 生命周期
 *   - Delegate SSE search to searchStream without leaking tokenStore — 将 SSE 搜索委托给 searchStream
 *
 * Key exports / 主要导出:
 *   APIError, APIClientOptions, APIClient, createAPIClient
 *
 * Callers / 调用方:
 *   App.tsx (creates the singleton client)
 *   APIContext (makes client available via useAPI hook)
 *
 * ADR refs: ADR-012 (base58 bearer tokens, stale-401 guard)
 */

import type {
  AdminUser,
  CreateUserPayload,
  DetailResponse,
  DoubanCategoriesResponse,
  DoubanHomeResponse,
  DoubanListResponse,
  DoubanRecommendFilter,
  ImportSourcesResponse,
  LoginResponse,
  MessageResponse,
  PlaybackURLResponse,
  SearchResponse,
  SettingsResponse,
  Source,
  SourceHealthResponse,
  SourcePayload,
  SourcesResponse,
  Subscription,
  SubscriptionPayload,
  SubscriptionsResponse,
  UpdateUserPayload,
  User,
  UsersResponse,
} from "./types";
import { searchStream as runSearchStream, type SearchStreamOptions } from "./searchStream";
import type { TokenStore } from "./tokenStore";

/**
 * APIError is thrown for every non-2xx HTTP response.
 * APIError
 * 每个非 2xx HTTP 响应都会抛出此错误.
 *
 * `status` carries the HTTP status code; `code` is the optional backend error code from the JSON body.
 * status 包含 HTTP 状态码; code 是 JSON 响应体中可选的后端错误码.
 */
export class APIError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = "APIError";
  }
}

/**
 * APIClientOptions configures a new client instance.
 * APIClientOptions
 * 配置新 client 实例.
 *
 * `baseURL` defaults to "" (same-origin); pass a full origin for dev proxy or tests.
 * fetcher is injectable for testing without real network.
 * baseURL 默认为 ""（同源）; 测试或开发代理时传入完整 origin.
 * fetcher 可注入, 便于在测试中绕过真实网络.
 */
export interface APIClientOptions {
  baseURL?: string;
  tokenStore: TokenStore;
  fetcher?: typeof fetch;
}

/**
 * APIClient is the primary contract for all API operations.
 * APIClient
 * 是所有 API 操作的主要契约接口.
 *
 * The interface is separated from the implementation so the test helper
 * `createTestAPI` (src/test/testAPI.ts) can provide a minimal in-memory stub
 * for component tests without touching real HTTP.
 * 接口与实现分离, 让 createTestAPI 无需触碰真实 HTTP 即可为组件测试提供最小内存存根.
 *
 * All paths are relative to /api/v1 and are Tier 4 locked — never change them here.
 * 所有路径均相对于 /api/v1, 属于 Tier 4 锁定 — 不得在此修改.
 */
export interface APIClient {
  login(username: string, password: string): Promise<User>;
  logout(): Promise<void>;
  me(signal?: AbortSignal): Promise<User>;
  updateProfile(username: string): Promise<User>;
  changePassword(oldPassword: string, newPassword: string): Promise<void>;
  uploadAvatar(file: File): Promise<User>;
  deleteAvatar(): Promise<User>;
  getSettings(): Promise<SettingsResponse>;
  updateSettings(settings: Record<string, string>): Promise<void>;
  search(query: string, page?: number): Promise<SearchResponse>;
  // searchStream exposes protected SSE search without leaking token storage to UI code.
  // searchStream
  // 暴露受保护的 SSE 搜索, 但不把 token 存储泄露给 UI 层.
  searchStream(
    query: string,
    onEvent: SearchStreamOptions["onEvent"],
    options?: Pick<SearchStreamOptions, "page" | "signal">,
  ): Promise<void>;
  detail(source: string, id: string): Promise<DetailResponse>;
  doubanHome(): Promise<DoubanHomeResponse>;
  // doubanCategories fetches the browse category metadata (groups + sub-categories + regions).
  // doubanCategories
  // 获取浏览分类元数据 (分组 + 子分类 + 地区).
  doubanCategories(): Promise<DoubanCategoriesResponse>;
  // doubanRecommendFilter fetches one filtered, paginated recommendation page.
  // doubanRecommendFilter
  // 获取一页经筛选的分页推荐结果.
  doubanRecommendFilter(filter: DoubanRecommendFilter): Promise<DoubanListResponse>;
  playbackURL(url: string, source: string): Promise<PlaybackURLResponse>;
  listSources(): Promise<SourcesResponse>;
  createSource(source: SourcePayload): Promise<Source>;
  updateSource(id: number, source: SourcePayload): Promise<void>;
  bulkSetSourcesEnabled(ids: number[], enabled: boolean): Promise<void>;
  deleteSource(id: number): Promise<void>;
  checkSource(id: number): Promise<SourceHealthResponse>;
  checkAllSources(): Promise<void>;
  importSources(data: Record<string, unknown>): Promise<ImportSourcesResponse>;
  listSubscriptions(): Promise<SubscriptionsResponse>;
  createSubscription(subscription: SubscriptionPayload): Promise<Subscription>;
  updateSubscription(id: number, subscription: SubscriptionPayload): Promise<void>;
  deleteSubscription(id: number): Promise<void>;
  syncSubscription(id: number): Promise<void>;
  listUsers(): Promise<UsersResponse>;
  createUser(user: CreateUserPayload): Promise<AdminUser>;
  updateUser(id: number, user: UpdateUserPayload): Promise<void>;
  deleteUser(id: number): Promise<void>;
}

// RequestBody covers the two payload shapes the client serialises: plain objects and absent bodies.
// RequestBody
// 覆盖 client 序列化的两种负载类型: 普通对象 和 无 body.
type RequestBody = object | undefined;

// normalizeBaseURL strips trailing slashes and treats "/" as same-origin ("").
// normalizeBaseURL
// 去掉末尾斜杠并将 "/" 视为同源 ("").
function normalizeBaseURL(baseURL: string | undefined): string {
  if (!baseURL || baseURL === "/") {
    return "";
  }

  return baseURL.replace(/\/+$/, "");
}

// toAPIURL assembles the full request URL including the /api/v1 prefix and optional query string.
// toAPIURL
// 拼接包含 /api/v1 前缀和可选查询字符串的完整请求 URL.
function toAPIURL(baseURL: string, path: string, query?: URLSearchParams): string {
  const url = `${baseURL}/api/v1${path}`;
  const qs = query?.toString();
  return qs ? `${url}?${qs}` : url;
}

// parseJSON decodes JSON only when the Content-Type header confirms it.
// Returning undefined as T for non-JSON bodies is intentional — the callers
// of void-returning methods never inspect the body.
// parseJSON
// 仅在 Content-Type 确认时解码 JSON.
// 对非 JSON body 返回 undefined as T 是故意的 — 返回 void 的方法调用方从不检查 body.
async function parseJSON<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

/**
 * createAPIClient constructs a fully configured APIClient bound to the given token store.
 * createAPIClient
 * 构造一个绑定到指定 token store 的完整 APIClient.
 *
 * The returned object is a plain object implementing APIClient — no class, no prototype chain.
 * 返回对象是实现 APIClient 的普通对象 — 无类, 无原型链.
 */
export function createAPIClient(options: APIClientOptions): APIClient {
  const baseURL = normalizeBaseURL(options.baseURL);
  const fetcher = options.fetcher ?? fetch;
  const tokenStore = options.tokenStore;

  async function request<T>(
    path: string,
    init: RequestInit & { bodyJSON?: RequestBody } = {},
  ): Promise<T> {
    const headers = new Headers(init.headers);
    const snapshot = tokenStore.get();
    // sentAccessToken captures the specific token this request carried, so a 401
    // can only clear the store when the live snapshot still matches. A stale 401
    // from an old token must not wipe a newer login.
    // sentAccessToken
    // 捕获本次请求使用的具体 token, 401 仅在当前快照仍然匹配时才清除, 避免陈旧 401 抹掉新登录.
    const sentAccessToken = snapshot?.accessToken ?? null;

    if (sentAccessToken) {
      headers.set("Authorization", `Bearer ${sentAccessToken}`);
    }

    let body = init.body;
    if (init.bodyJSON !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(init.bodyJSON);
    }

    const response = await fetcher(toAPIURL(baseURL, path), {
      ...init,
      headers,
      body,
    });

    if (!response.ok) {
      const errorBody = await parseJSON<{ code?: number; error?: string }>(response);
      if (
        response.status === 401 &&
        sentAccessToken &&
        tokenStore.get()?.accessToken === sentAccessToken
      ) {
        tokenStore.clear("unauthorized");
      }
      throw new APIError(response.status, errorBody?.code, errorBody?.error ?? response.statusText);
    }

    return parseJSON<T>(response);
  }

  return {
    async login(username, password) {
      const response = await request<LoginResponse>("/auth/login", {
        method: "POST",
        bodyJSON: { username, password },
      });

      const user: User = {
        id: response.id,
        username: response.username,
        role: response.role,
        avatar: response.avatar,
      };

      tokenStore.set({
        accessToken: response.access_token,
        expiresAt: response.expires_at,
        user,
      });

      return user;
    },
    async logout() {
      try {
        await request<MessageResponse>("/auth/logout", { method: "POST" });
      } finally {
        tokenStore.clear("logout");
      }
    },
    me: (signal?: AbortSignal) => request<User>("/auth/me", { signal }),
    updateProfile: (username) => request<User>("/auth/profile", { method: "PUT", bodyJSON: { username } }),
    async changePassword(oldPassword, newPassword) {
      await request<MessageResponse>("/auth/password", {
        method: "PUT",
        bodyJSON: { old_password: oldPassword, new_password: newPassword },
      });
    },
    uploadAvatar(file) {
      const body = new FormData();
      body.set("avatar", file);
      return request<User>("/auth/avatar", { method: "PUT", body });
    },
    deleteAvatar: () => request<User>("/auth/avatar", { method: "DELETE" }),
    getSettings: () => request<SettingsResponse>("/settings"),
    async updateSettings(settings) {
      await request<MessageResponse>("/admin/settings", { method: "PUT", bodyJSON: settings });
    },
    search: (query, page = 1) => {
      const params = new URLSearchParams({ q: query, page: String(page) });
      return request<SearchResponse>(`/search?${params.toString()}`);
    },
    // Reuse this API client's base URL, fetcher, and auth snapshot for streaming search.
    // Capture the access token at call time so a stale 401 cannot wipe a newer token.
    // 复用当前 API client 的 baseURL, fetcher 和认证快照执行流式搜索.
    // 在调用时锁定 accessToken, 防止陈旧 401 抹掉更新后的 token.
    searchStream: (query, onEvent, streamOptions = {}) => {
      const sentAccessToken = tokenStore.get()?.accessToken ?? null;
      return runSearchStream({
        query,
        page: streamOptions.page,
        signal: streamOptions.signal,
        baseURL,
        fetcher,
        accessToken: sentAccessToken ?? undefined,
        onUnauthorized: sentAccessToken
          ? () => {
              if (tokenStore.get()?.accessToken === sentAccessToken) {
                tokenStore.clear("unauthorized");
              }
            }
          : undefined,
        onEvent,
      });
    },
    detail: (source, id) => {
      const params = new URLSearchParams({ source, id });
      return request<DetailResponse>(`/detail?${params.toString()}`);
    },
    doubanHome: () => request<DoubanHomeResponse>("/douban/home"),
    doubanCategories: () => request<DoubanCategoriesResponse>("/douban/categories"),
    async doubanRecommendFilter(filter) {
      // `kind` is the only required parameter; optional filters are appended only when
      // non-empty so the backend reads them identically to an omitted value ("" === absent).
      // start/count are always sent to make pagination explicit.
      // kind 是唯一必填参数; 可选筛选项仅在非空时附加, 此时后端读取结果与缺省值一致 ("" 等同缺省);
      // start/count 始终发送, 使分页显式化.
      const params = new URLSearchParams({ kind: filter.kind });
      if (filter.tag) params.set("tag", filter.tag);
      if (filter.format) params.set("format", filter.format);
      if (filter.region) params.set("region", filter.region);
      params.set("start", String(filter.start ?? 0));
      params.set("count", String(filter.count ?? 20));
      const data = await request<DoubanListResponse>(`/douban/recommend/filter?${params.toString()}`);
      // Normalize items to []: unlike the server-normalized list endpoints, the Douban
      // recommend/filter handler returns a nil slice as JSON `null` for empty upstream results.
      // Doing it once here keeps every consumer (pagination, render-time dedup) array-safe (ADR-005).
      // 将 items 归一化为 []: 与已在服务端归一化的列表端点不同, Douban recommend/filter 处理器
      // 在上游结果为空时会把 nil slice 序列化为 JSON `null`. 在此统一处理一次, 让所有消费者
      // (分页、渲染期去重) 都对数组安全 (ADR-005).
      return { items: data?.items ?? [] };
    },
    playbackURL: (url, source) =>
      request<PlaybackURLResponse>("/playback/url", {
        method: "POST",
        bodyJSON: { url, source },
      }),
    listSources: () => request<SourcesResponse>("/admin/sources"),
    createSource: (source) => request<Source>("/admin/sources", { method: "POST", bodyJSON: source }),
    async updateSource(id, source) {
      await request<MessageResponse>(`/admin/sources/${id}`, { method: "PUT", bodyJSON: source });
    },
    async bulkSetSourcesEnabled(ids, enabled) {
      await request<MessageResponse>("/admin/sources/bulk-enabled", {
        method: "POST",
        bodyJSON: { ids, enabled },
      });
    },
    async deleteSource(id) {
      await request<MessageResponse>(`/admin/sources/${id}`, { method: "DELETE" });
    },
    checkSource: (id) => request<SourceHealthResponse>(`/admin/sources/${id}/check`, { method: "POST" }),
    async checkAllSources() {
      await request<MessageResponse>("/admin/sources/check-all", { method: "POST" });
    },
    importSources: (data) => request<ImportSourcesResponse>("/admin/sources/import", { method: "POST", bodyJSON: data }),
    listSubscriptions: () => request<SubscriptionsResponse>("/admin/subscriptions"),
    createSubscription: (subscription) =>
      request<Subscription>("/admin/subscriptions", { method: "POST", bodyJSON: subscription }),
    async updateSubscription(id, subscription) {
      await request<MessageResponse>(`/admin/subscriptions/${id}`, { method: "PUT", bodyJSON: subscription });
    },
    async deleteSubscription(id) {
      await request<MessageResponse>(`/admin/subscriptions/${id}`, { method: "DELETE" });
    },
    async syncSubscription(id) {
      await request<MessageResponse>(`/admin/subscriptions/${id}/sync`, { method: "POST" });
    },
    listUsers: () => request<UsersResponse>("/admin/users"),
    createUser: (user) => request<AdminUser>("/admin/users", { method: "POST", bodyJSON: user }),
    async updateUser(id, user) {
      await request<MessageResponse>(`/admin/users/${id}`, { method: "PUT", bodyJSON: user });
    },
    async deleteUser(id) {
      await request<MessageResponse>(`/admin/users/${id}`, { method: "DELETE" });
    },
  };
}
