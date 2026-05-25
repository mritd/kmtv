/**
 * types — shared domain types for all API request and response shapes.
 * types — 所有 API 请求和响应形态的共享领域类型.
 *
 * Responsibilities / 职责:
 *   - Define the wire types returned by /api/v1 endpoints — 定义 /api/v1 端点返回的线格式类型
 *   - Define composite frontend types (AuthSnapshot, SearchStreamEvent) — 定义前端复合类型
 *   - Pure type declarations — no runtime code — 纯类型声明, 无运行时代码
 *
 * Key exports / 主要导出:
 *   UserRole, User, LoginResponse, AuthSnapshot, APIErrorBody, MessageResponse,
 *   SettingsResponse, Source, SourcePayload, SourcesResponse, SourceHealthResponse,
 *   ImportSourcesResponse, Subscription, SubscriptionPayload, SubscriptionsResponse,
 *   AdminUser, CreateUserPayload, UpdateUserPayload, UsersResponse,
 *   Episode, SourceResult, SearchResult, SearchResponse,
 *   SearchProgressPhase, SearchProgress, SearchStreamEvent,
 *   DetailResponse, PlaybackURLResponse, DoubanItem, DoubanHomeSection, DoubanHomeResponse
 *
 * Callers / 调用方:
 *   client.ts, tokenStore.ts, searchStream.ts, adminHooks.ts, viewerHooks.ts,
 *   and downstream components throughout auth/, admin/, account/, viewer/
 *
 * TIER 4 LOCKED — field names and types mirror the Go backend JSON tags.
 * Do not rename or remove fields without a coordinated backend change.
 * Tier 4 锁定 — 字段名和类型与 Go 后端 JSON tag 一一对应.
 * 不得在未与后端同步更改的情况下重命名或删除字段.
 */

/**
 * UserRole is the set of valid user permission levels.
 * UserRole
 * 是有效用户权限级别的集合.
 *
 * "admin" has access to all admin panels; "user" sees viewer-only pages.
 * "admin" 可访问所有管理面板; "user" 仅能访问观看者页面.
 */
export type UserRole = "admin" | "user";

/**
 * User is the authenticated user profile returned by /auth/me and /auth/login.
 * User
 * 是 /auth/me 和 /auth/login 返回的已认证用户档案.
 */
export interface User {
  id: number;
  username: string;
  role: UserRole;
  avatar?: string;
}

/**
 * LoginResponse extends User with the bearer token fields returned on successful login.
 * LoginResponse
 * 在 User 基础上添加登录成功时返回的 Bearer token 字段.
 *
 * access_token is the base58 opaque token (ADR-012); expires_at is an ISO-8601 timestamp.
 * access_token 是 base58 不透明 token (ADR-012); expires_at 为 ISO-8601 时间戳.
 */
export interface LoginResponse extends User {
  access_token: string;
  expires_at: string;
}

/**
 * AuthSnapshot is the frontend representation of the current auth session.
 * AuthSnapshot
 * 是当前认证会话的前端表示.
 *
 * Stored in localStorage under the "kmtv.auth" key (see tokenStore.ts/authStorageKey).
 * Shape is validated by isAuthSnapshot before trusting persisted data.
 * 存储在 localStorage 的 "kmtv.auth" key 下; 持久化数据由 isAuthSnapshot 验证后方可信任.
 */
export interface AuthSnapshot {
  accessToken: string;
  expiresAt: string;
  user: User;
}

/**
 * APIErrorBody is the optional JSON payload returned alongside non-2xx responses.
 * APIErrorBody
 * 是随非 2xx 响应一起返回的可选 JSON 负载.
 *
 * code is a backend-specific numeric error code for programmatic handling.
 * error is the human-readable message shown to the user.
 * code 是后端特定的数字错误码, 用于程序化处理; error 是展示给用户的可读错误信息.
 */
export interface APIErrorBody {
  code?: number;
  error?: string;
}

/**
 * MessageResponse is the generic success body for mutation endpoints that return no entity.
 * MessageResponse
 * 是不返回实体的写操作端点使用的通用成功响应体.
 */
export interface MessageResponse {
  message: string;
}

/**
 * SettingsResponse wraps the flat key-value settings map from /settings and /admin/settings.
 * SettingsResponse
 * 封装了来自 /settings 和 /admin/settings 的扁平键值配置映射.
 */
export interface SettingsResponse {
  settings: Record<string, string>;
}

/**
 * Source is the full video source record as stored and returned by the backend.
 * Source
 * 是后端存储并返回的完整视频源记录.
 *
 * health is a string union; "checking" is emitted transiently while probe is in-flight.
 * health 是字符串联合; "checking" 在探测进行中时短暂出现.
 * The | string tail keeps the type open for forward-compatible backend additions.
 * | string 尾部保持类型开放, 兼容后端未来添加的新状态.
 */
export interface Source {
  id: number;
  key: string;
  name: string;
  api: string;
  detail: string;
  enabled: boolean;
  is_adult: boolean;
  searchable: boolean;
  comment: string;
  health: "healthy" | "unhealthy" | "unknown" | string;
  last_check: string;
  created_at: string;
  updated_at: string;
}

/**
 * SourcePayload is the create/update body for a video source.
 * SourcePayload
 * 是创建/更新视频源时使用的请求体.
 *
 * Server-generated fields (id, health, timestamps) are excluded.
 * 不包含服务端生成的字段 (id, health, 时间戳).
 */
export type SourcePayload = Omit<Source, "id" | "health" | "last_check" | "created_at" | "updated_at">;

/**
 * SourcesResponse wraps the list of all configured video sources.
 * SourcesResponse
 * 封装所有已配置视频源的列表.
 */
export interface SourcesResponse {
  sources: Source[];
}

/**
 * SourceHealthResponse is the result of a single-source health check probe.
 * SourceHealthResponse
 * 是单源健康检查探测的结果.
 */
export interface SourceHealthResponse {
  health: string;
}

/**
 * ImportSourcesResponse reports how many sources were created from a bulk import.
 * ImportSourcesResponse
 * 报告批量导入操作成功创建的源数量.
 */
export interface ImportSourcesResponse {
  imported: number;
}

/**
 * Subscription is a subscription record that auto-imports sources from a remote URL.
 * Subscription
 * 是从远程 URL 自动导入视频源的订阅记录.
 *
 * interval is in seconds. auto_update enables background polling.
 * interval 单位为秒; auto_update 启用后台轮询.
 */
export interface Subscription {
  id: number;
  url: string;
  auto_update: boolean;
  interval: number;
  last_sync: string;
  updated_at: string;
}

/**
 * SubscriptionPayload is the create/update body for a subscription.
 * SubscriptionPayload
 * 是创建/更新订阅时使用的请求体.
 */
export type SubscriptionPayload = Pick<Subscription, "url" | "auto_update" | "interval">;

/**
 * SubscriptionsResponse wraps the list of all active subscriptions.
 * SubscriptionsResponse
 * 封装所有有效订阅的列表.
 */
export interface SubscriptionsResponse {
  subscriptions: Subscription[];
}

/**
 * AdminUser is the user record as seen by admins (includes timestamps, no password).
 * AdminUser
 * 是管理员视角下的用户记录 (含时间戳, 不含密码).
 */
export interface AdminUser {
  id: number;
  username: string;
  role: UserRole;
  allow_adult_content: boolean;
  created_at?: string;
  updated_at?: string;
}

/**
 * CreateUserPayload is the admin request body for creating a new user.
 * CreateUserPayload
 * 是管理员创建新用户时使用的请求体.
 */
export interface CreateUserPayload {
  username: string;
  password: string;
  role: UserRole;
  allow_adult_content?: boolean;
}

/**
 * UpdateUserPayload is the admin request body for updating an existing user.
 * UpdateUserPayload
 * 是管理员更新现有用户时使用的请求体.
 *
 * password is optional; omit to keep the existing password unchanged.
 * password 可选; 省略则保留现有密码不变.
 *
 * allow_adult_content is optional; omit to keep the existing policy unchanged.
 * allow_adult_content 可选; 省略则保留现有策略不变.
 */
export interface UpdateUserPayload {
  username: string;
  password?: string;
  role: UserRole;
  allow_adult_content?: boolean;
}

/**
 * UsersResponse wraps the list of all users returned by the admin API.
 * UsersResponse
 * 封装管理员 API 返回的所有用户列表.
 */
export interface UsersResponse {
  users: AdminUser[];
}

/**
 * Episode is a single playable episode with a name and a raw playback URL.
 * Episode
 * 是带有名称和原始播放 URL 的单个可播放剧集.
 *
 * url is an un-proxied source URL; the backend wraps it via /playback/url.
 * url 是未经代理的源地址; 后端通过 /playback/url 封装.
 */
export interface Episode {
  name: string;
  url: string;
}

/**
 * SourceResult groups a video's episodes from a single video source.
 * SourceResult
 * 将来自单个视频源的视频剧集分组.
 *
 * duration_ms is present only for sources that report it; callers should treat it as a hint.
 * duration_ms 仅在视频源提供时存在; 调用方应将其视为参考值.
 */
export interface SourceResult {
  source_key: string;
  source_name: string;
  video_id: string;
  duration_ms?: number;
  episodes?: Episode[];
}

/**
 * SearchResult is one title match from the aggregated search response.
 * SearchResult
 * 是聚合搜索响应中的单条标题匹配结果.
 *
 * A result may have sources from multiple video sources (consolidated by title match).
 * 一条结果可能包含来自多个视频源的 sources (按标题合并).
 */
export interface SearchResult {
  title: string;
  type?: string;
  year?: string;
  cover?: string;
  desc?: string;
  rate?: string;
  sources: SourceResult[];
}

/**
 * SearchResponse is the final aggregated results payload for a completed search.
 * SearchResponse
 * 是完成搜索后的最终聚合结果负载.
 */
export interface SearchResponse {
  results: SearchResult[];
}

// SearchProgressPhase names the backend SSE progress stage.
// 搜索进度阶段名称来自后端 SSE.
export type SearchProgressPhase = "searching" | "probing" | string;

// SearchProgress carries anonymous phase counts;
// source names are not part of SSE.
// 搜索进度只包含匿名阶段计数, SSE 不包含站点名.
export interface SearchProgress {
  phase: SearchProgressPhase;
  completed: number;
  total: number;
}

// SearchStreamEvent is the normalized browser-side event union.
// SearchStreamEvent
// 是浏览器端归一化后的 SSE 事件联合类型.
export type SearchStreamEvent =
  | { type: "progress"; progress: SearchProgress }
  | { type: "result"; response: SearchResponse }
  | { type: "error"; message: string };

/**
 * DetailResponse is the full detail payload for a single video title from /detail.
 * DetailResponse
 * 是来自 /detail 端点的单个视频标题的完整详情负载.
 *
 * episodes is a 2D array: outer dimension = episode groups (e.g. seasons), inner = episodes.
 * episodes 是二维数组: 外层为剧集组 (如季), 内层为单集.
 */
export interface DetailResponse {
  id: string;
  title: string;
  type?: string;
  year?: string;
  cover?: string;
  desc?: string;
  director?: string;
  actor?: string;
  area?: string;
  episodes: Episode[][];
}

/**
 * PlaybackURLResponse is the resolved playback URL from /playback/url.
 * PlaybackURLResponse
 * 是 /playback/url 返回的已解析播放 URL.
 *
 * mode "proxy" means the URL goes through the backend proxy;
 * "direct" means the browser plays it directly.
 * mode "proxy" 表示 URL 通过后端代理; "direct" 表示浏览器直接播放.
 */
export interface PlaybackURLResponse {
  mode: "proxy" | "direct";
  url: string;
}

/**
 * DoubanItem is a single item in a Douban recommendation section.
 * DoubanItem
 * 是豆瓣推荐分区中的单个条目.
 */
export interface DoubanItem {
  id: string;
  title: string;
  cover?: string;
  rate?: string;
  year?: string;
  desc?: string;
}

/**
 * DoubanHomeSection is a named section in the Douban home recommendations page.
 * DoubanHomeSection
 * 是豆瓣首页推荐中的一个命名分区.
 */
export interface DoubanHomeSection {
  name: string;
  tag?: string;
  type?: string;
  items: DoubanItem[];
}

/**
 * DoubanHomeResponse is the top-level response from /douban/home.
 * DoubanHomeResponse
 * 是 /douban/home 的顶层响应.
 */
export interface DoubanHomeResponse {
  sections: DoubanHomeSection[];
}

/**
 * DoubanListResponse is the paginated item payload returned by /douban/recommend/filter
 * (and /douban/list, /douban/recommend). It is intentionally a thin wrapper around items
 * so all Douban list endpoints share one response shape.
 * DoubanListResponse
 * 是 /douban/recommend/filter (以及 /douban/list、/douban/recommend) 返回的分页条目负载,
 * 刻意只对 items 做一层薄封装, 让所有豆瓣列表端点共用同一响应结构.
 */
export interface DoubanListResponse {
  items: DoubanItem[];
}

/**
 * SubCategory is one sub-category filter option inside a CategoryGroup (e.g. a genre or ranking tag).
 * SubCategory
 * 是 CategoryGroup 内的一个子分类筛选项 (如题材或排行标签).
 *
 * `kind` and `format` are optional overrides: when `kind` is present the sub-category drives
 * both the Douban kind and format; when absent, the parent group's douban_kind/format apply.
 * This mirrors the iOS CategoriesViewModel filter-resolution contract — see store/categoriesStore.ts.
 * kind 和 format 为可选覆盖项: 当 kind 存在时, 由子分类同时决定 Douban kind 与 format;
 * 缺失时回退到父分组的 douban_kind/format. 该规则与 iOS CategoriesViewModel 的筛选解析契约一致,
 * 详见 store/categoriesStore.ts.
 */
export interface SubCategory {
  name: string;
  tag: string;
  kind?: string;
  format?: string;
}

/**
 * Region is one region filter option inside a CategoryGroup.
 * Region
 * 是 CategoryGroup 内的一个地区筛选项.
 *
 * `value` is the query value sent to the backend; `name` is the display label (may differ).
 * value 是发送给后端的查询值; name 是展示用标签 (二者可能不同).
 */
export interface Region {
  name: string;
  value: string;
}

/**
 * CategoryGroup is one top-level browse category (e.g. 电影 / 剧集) with its filter options.
 * CategoryGroup
 * 是一个顶层浏览分类 (如 电影 / 剧集) 及其筛选项.
 *
 * `douban_kind` and `format` are the group-level defaults applied when the selected
 * sub-category does not override them. `regions` may be empty for groups without region filters.
 * douban_kind 和 format 是分组级默认值, 当所选子分类未覆盖时生效.
 * 对于没有地区筛选的分组, regions 可能为空.
 */
export interface CategoryGroup {
  key: string;
  name: string;
  douban_kind: string;
  format: string;
  subcategories: SubCategory[];
  regions: Region[];
}

/**
 * DoubanCategoriesResponse is the top-level response from /douban/categories.
 * DoubanCategoriesResponse
 * 是 /douban/categories 的顶层响应.
 */
export interface DoubanCategoriesResponse {
  categories: CategoryGroup[];
}

/**
 * DoubanRecommendFilter carries the resolved query parameters for /douban/recommend/filter.
 * DoubanRecommendFilter
 * 承载 /douban/recommend/filter 的已解析查询参数.
 *
 * `kind` is required by the backend; `tag`, `format`, and `region` are optional filters.
 * `start`/`count` drive pagination (count is capped at 50 server-side).
 * kind 为后端必填; tag、format、region 为可选筛选项.
 * start/count 驱动分页 (count 在服务端上限为 50).
 */
export interface DoubanRecommendFilter {
  kind: string;
  tag?: string;
  format?: string;
  region?: string;
  start?: number;
  count?: number;
}
