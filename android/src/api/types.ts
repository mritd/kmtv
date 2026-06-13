// Wire-format types shared by every API module. Mirrors apple/Shared/API model files.
// 所有 API 模块共享的 wire 格式类型, 镜像 apple/Shared/API 的模型文件.

/**
 * Authenticated user representation.
 * 已认证用户的表示.
 */
export interface User {
  id: number;
  username: string;
  role: "admin" | "user" | "anonymous";
  avatar?: string;
}

/**
 * Bearer-token response from POST /api/v1/auth/login — flat shape with snake_case wire fields.
 * POST /api/v1/auth/login 返回的 bearer token 响应, 扁平结构, wire 字段使用 snake_case.
 *
 * The server returns a single object that extends the User shape with `access_token` and
 * `expires_at`; clients should NOT expect a nested `user` field.
 * 服务器返回单一对象, 在 User 之上追加 `access_token` 与 `expires_at`; 客户端不要预期 `user` 嵌套字段.
 */
export interface LoginResponse extends User {
  access_token: string;
  expires_at: string;
}

/**
 * Generic message response used by DELETE endpoints + auth/logout.
 * DELETE 接口与 auth/logout 共享的通用 message 响应.
 */
export interface MessageResponse {
  message: string;
}

/**
 * Server settings exposed through GET /api/v1/settings (subset used by M1).
 * GET /api/v1/settings 暴露的服务器设置 (M1 仅使用子集).
 */
export interface SettingsResponse {
  settings: Record<string, string>;
}

/**
 * One Douban discovery item, mirrors apple `DoubanItem`.
 * Douban 发现条目, 与 apple `DoubanItem` 一致.
 */
export interface DoubanItem {
  id: string;
  title: string;
  cover: string;
  rate: string;
  year: string;
}

/**
 * One section in the home discovery feed.
 * 首页发现信息流的单个分区.
 */
export interface HomeSection {
  name: string;
  tag: string;
  type: string;
  items: DoubanItem[];
}

/**
 * Response shape of GET /api/v1/douban/home.
 * GET /api/v1/douban/home 的响应形状.
 */
export interface DoubanHomeResponse {
  sections: HomeSection[];
}

/**
 * One sub-category option inside a CategoryGroup (e.g. a genre or ranking tag).
 * CategoryGroup 内的一个子分类筛选项 (如题材或排行标签).
 *
 * `kind` and `format` are optional overrides — see categoryFilter.resolveRecommendFilter for the
 * presence-test rule that decides when sub overrides the group-level format.
 * kind 和 format 为可选覆盖, 参见 categoryFilter.resolveRecommendFilter 关于子分类覆盖分组 format 的判定规则.
 */
export interface SubCategory {
  name: string;
  tag: string;
  kind?: string;
  format?: string;
}

/**
 * One region filter option inside a CategoryGroup.
 * CategoryGroup 内的一个地区筛选项.
 */
export interface Region {
  name: string;
  value: string;
}

/**
 * One top-level browse category (e.g. 电影 / 剧集) with its filter options.
 * 顶层浏览分类 (如电影 / 剧集) 及其筛选项.
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
 * Top-level response from /douban/categories.
 * /douban/categories 的顶层响应.
 */
export interface DoubanCategoriesResponse {
  categories: CategoryGroup[];
}

/**
 * Resolved query parameters for /douban/recommend/filter.
 * /douban/recommend/filter 的已解析查询参数.
 *
 * `kind` is required server-side; the rest are optional filters or pagination knobs.
 * kind 服务端必填; 其余字段为可选筛选项或分页参数.
 */
export interface DoubanRecommendFilter {
  kind: string;
  tag?: string;
  format?: string;
  region?: string;
  start?: number;
  count?: number;
}

/**
 * Paginated item payload for /douban/recommend/filter (and sibling /douban/list endpoints).
 * /douban/recommend/filter (以及 /douban/list 系列端点) 返回的分页条目负载.
 */
export interface DoubanListResponse {
  items: DoubanItem[];
}

/**
 * One playable episode (mirrors server `model.Episode`).
 * 一集可播放视频 (镜像 server `model.Episode`).
 */
export interface Episode {
  name: string;
  url: string;
}

/**
 * One source attached to a search result — mirrors server `model.SourceResult` (snake_case wire).
 * 一个搜索结果下的源, 镜像 server `model.SourceResult` (snake_case wire 格式).
 *
 * The `duration_ms` field is the upstream source's response time (used by the iOS picker to
 * surface slow sources); episodes is the full playable list — Detail / Player in M4 consume both.
 * duration_ms 是上游源的响应时间 (iOS 选源时用于标注慢源); episodes 是完整可播放列表, M4 Detail / Player 消费.
 */
export interface SourceResult {
  source_key: string;
  source_name: string;
  is_adult: boolean;
  video_id: string;
  duration_ms: number;
  episodes: Episode[];
}

/**
 * Single aggregated search result mirroring server `model.SearchResult`.
 * 单条聚合搜索结果, 镜像 server `model.SearchResult`.
 *
 * Backend has no top-level id; RN code synthesises a list key from the first source
 * (`source_key + ":" + video_id`).
 * 后端无顶层 id, RN 端基于首个源合成列表 key (source_key + ":" + video_id).
 */
export interface SearchResult {
  title: string;
  type: string;
  year: string;
  cover: string;
  desc: string;
  sources: SourceResult[];
}

/**
 * Final aggregated response of a search request — sync endpoint or SSE final frame.
 * 搜索请求的最终聚合响应 — 同步接口或 SSE 末帧.
 */
export interface SearchResponse {
  results: SearchResult[];
}

/**
 * SSE progress phase name emitted by the backend.
 * 后端推送的 SSE 进度阶段名称.
 */
export type SearchProgressPhase = "searching" | "probing" | string;

/**
 * SSE progress payload — anonymous counts only, no per-source names on the wire.
 * SSE 进度负载 — 仅包含匿名计数, 线上不带源名称.
 */
export interface SearchProgress {
  phase: SearchProgressPhase;
  completed: number;
  total: number;
}

/**
 * Normalised SSE event union the search API surfaces to callers.
 * 搜索 API 对外暴露的归一化 SSE 事件联合类型.
 */
export type SearchStreamEvent =
  | { type: "progress"; progress: SearchProgress }
  | { type: "result"; response: SearchResponse }
  | { type: "error"; message: string };

/**
 * Full detail of one video from one source, mirrors server `model.VideoDetail`.
 * 单个源返回的视频完整详情, 镜像 server `model.VideoDetail`.
 *
 * `episodes` is a 2-D array: outer index selects the CDN line, inner index selects the episode
 * inside that line. Lines whose inner array is empty are "dead" — render with strike-through and
 * disable selection. The PlayerScreen line picker mirrors this exact shape.
 * episodes 为二维数组: 外层选择 CDN 线路, 内层为该线路下的剧集. 内层为空表示死线路, 渲染为划线且禁用.
 * PlayerScreen 线路选择器结构与此严格对应.
 */
export interface VideoDetail {
  id: string;
  title: string;
  type: string;
  year: string;
  cover: string;
  desc: string;
  director: string;
  actor: string;
  area: string;
  episodes: Episode[][];
}

/**
 * Response from POST /api/v1/playback/url — playable URL plus the resolution mode.
 * POST /api/v1/playback/url 的响应, 包含可播放 URL 与解析模式.
 *
 * `mode` is "proxy" when the server wraps the URL in `/api/v1/proxy/m3u8?...&mt=<token>` and
 * "direct" when the URL is returned as-is. Clients treat both identically for playback.
 * mode 为 "proxy" 时服务端用 `/api/v1/proxy/m3u8?...&mt=<token>` 包装 URL; "direct" 时原样返回. 客户端播放时一视同仁.
 */
export interface PlaybackURLResponse {
  mode: "direct" | "proxy" | string;
  url: string;
}

/**
 * Episode resume intent passed across navigation so a fresh DetailScreen lands on the right episode.
 * 跨导航传递的分集恢复意图, 让新打开的 DetailScreen 直接定位到对应剧集.
 *
 * Both fields are required — `episodeIndex` is the primary key, `episodeName` is used by
 * usePlayer's source-switch matcher to re-pick the episode after a source switch reshuffles the list.
 * 两个字段都必填: episodeIndex 是主键, episodeName 用于切源重排后由 usePlayer 重新定位.
 */
export interface EpisodeResumeIntent {
  episodeIndex: number;
  episodeName: string;
}

/**
 * Navigation params for the Detail route — carries everything DetailScreen needs to load and play.
 * Detail 路由的导航参数, 包含 DetailScreen 加载与播放所需的全部信息.
 *
 * `sources` is the list of candidate sources from search/continue-watching; `sourceKey` selects
 * the initial one. When invoked from continue-watching `sources` may be empty, in which case
 * usePlayer seeds a placeholder source from `sourceKey + videoId` and replaces it on detailLoaded.
 * sources 是搜索/继续观看带来的候选源列表; sourceKey 选定初始源. 从继续观看进入时 sources 可能为空,
 * 由 usePlayer 用 sourceKey + videoId 构造占位 source, detailLoaded 后替换为真实数据.
 */
export interface PlayDestination {
  title: string;
  sources: SourceResult[];
  sourceKey: string;
  videoId: string;
  coverHint: string;
  resumeIntent?: EpisodeResumeIntent;
}
