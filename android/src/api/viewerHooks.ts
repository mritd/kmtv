// react-query hook wrappers for viewer surfaces (home, categories, search).
// 观看者面 (首页、分类、搜索) 的 react-query 包装 hook.

import {
  useInfiniteQuery, useQuery,
  type UseInfiniteQueryResult, type UseQueryResult,
} from "@tanstack/react-query";

import type { DetailAPI } from "./detail";
import type { DoubanAPI } from "./douban";
import type { SearchAPI } from "./search";
import type {
  DoubanCategoriesResponse, DoubanHomeResponse, DoubanListResponse,
  DoubanRecommendFilter, SearchResponse, VideoDetail,
} from "./types";

const HOME_STALE_MS = 2 * 60 * 1000;
const CATEGORIES_STALE_MS = 5 * 60 * 1000;
const DETAIL_STALE_MS = 60 * 1000;

/**
 * Items per /douban/recommend/filter page (mirrors web RECOMMEND_PAGE_SIZE).
 * 每页 /douban/recommend/filter 条目数 (与 web RECOMMEND_PAGE_SIZE 一致).
 *
 * A page returning fewer items signals the end of the list.
 * 当某页返回少于该数量时, 表示列表结束.
 */
export const RECOMMEND_PAGE_SIZE = 20;

/**
 * RecommendFilterKey — the four filter fields that uniquely identify a recommendation list.
 * RecommendFilterKey — 唯一标识一份推荐列表的四个筛选字段.
 *
 * Embedded in the React Query key so changing any filter switches to a separate cache entry.
 * 内嵌于 query key, 任一筛选变化都会切到独立缓存条目.
 */
export type RecommendFilterKey = Required<Pick<DoubanRecommendFilter, "kind" | "tag" | "format" | "region">>;

/**
 * useDoubanHomeQuery: cached for 2 minutes, scoped by serverURL.
 * useDoubanHomeQuery: 缓存 2 分钟, 按 serverURL 隔离.
 */
export function useDoubanHomeQuery(
  api: DoubanAPI,
  scope: string = "",
): UseQueryResult<DoubanHomeResponse> {
  return useQuery({
    queryKey: ["douban-home", scope],
    queryFn: () => api.doubanHome(),
    staleTime: HOME_STALE_MS,
  });
}

/**
 * useCategoriesQuery: fetches /douban/categories metadata (groups + sub/region options).
 * useCategoriesQuery: 拉取 /douban/categories 元数据 (分组、子分类、地区).
 *
 * 5-minute staleTime mirrors web because metadata rarely changes; scope by serverURL so a
 * server switch never serves cached groups from the previous host.
 * 5 分钟 staleTime 与 web 一致, 因为元数据很少变化; 按 serverURL 隔离, 服务器切换后不会复用旧缓存.
 */
export function useCategoriesQuery(
  api: DoubanAPI,
  scope: string = "",
): UseQueryResult<DoubanCategoriesResponse> {
  return useQuery({
    queryKey: ["douban-categories", scope],
    queryFn: () => api.doubanCategories(),
    retry: 1,
    staleTime: CATEGORIES_STALE_MS,
  });
}

/**
 * useDoubanRecommendInfiniteQuery: paginated filtered items.
 * useDoubanRecommendInfiniteQuery: 经筛选的分页条目.
 *
 * Disabled when `kind` is empty (backend requires it; metadata may still be loading).
 * The query key embeds every filter field + scope so cache entries are isolated per filter
 * change and per server. Offset = cumulative raw items (matches iOS / web — no pre-dedup
 * tally so a duplicate dropped at render time still advances the upstream cursor).
 * 当 kind 为空时禁用 (后端必填, 也避免元数据未就绪时空请求).
 * query key 包含全部筛选字段 + scope, 切换筛选与服务器都会隔离缓存. 偏移 = 已获取原始条目累计
 * (与 iOS / web 一致, 渲染期去重不会回退游标).
 */
export function useDoubanRecommendInfiniteQuery(
  api: DoubanAPI,
  scope: string,
  filter: RecommendFilterKey,
): UseInfiniteQueryResult<{ pages: DoubanListResponse[]; pageParams: number[] }, Error> {
  return useInfiniteQuery({
    queryKey: ["douban-recommend", scope, filter.kind, filter.tag, filter.format, filter.region],
    queryFn: ({ pageParam }) =>
      api.doubanRecommendFilter({ ...filter, start: pageParam as number, count: RECOMMEND_PAGE_SIZE }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.items.length < RECOMMEND_PAGE_SIZE) return undefined;
      return allPages.reduce((sum, page) => sum + page.items.length, 0);
    },
    enabled: filter.kind.length > 0,
    retry: 1,
  });
}

/**
 * useSearchQuery: sync /search request, disabled when trimmed query is empty.
 * useSearchQuery: 同步 /search 请求, 在 trim 后的 query 为空时禁用.
 *
 * SSE streaming is driven directly from the SearchScreen state machine (not a hook) so progress
 * events can update React state mid-stream — this hook is reserved for the iOS fallback path.
 * SSE 流由 SearchScreen 状态机直接驱动, 进度事件需要中流回写 React state; 此 hook 保留给 iOS 回退路径.
 */
export function useSearchQuery(
  api: SearchAPI,
  scope: string,
  query: string,
): UseQueryResult<SearchResponse> {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ["search", scope, trimmed],
    queryFn: () => api.search(trimmed),
    enabled: trimmed.length > 0,
    retry: 1,
  });
}

/**
 * useVideoDetailQuery — fetches /detail for one (sourceKey, videoId) pair, scoped by server.
 * useVideoDetailQuery — 拉取一对 (sourceKey, videoId) 的 /detail, 按服务器隔离.
 *
 * Disabled until both ids are non-empty. 1-minute staleTime mirrors the spec — detail rarely
 * changes within a single playback session, but a fresh entry from player back-navigation should
 * still see updated episodes if the source published more.
 * 在两个 id 均非空前禁用. 1 分钟 staleTime 与 spec 一致, 单次会话内详情几乎不变, 但回到详情页时
 * 若源端新增剧集仍可拿到刷新数据.
 */
export function useVideoDetailQuery(
  api: DetailAPI,
  scope: string,
  sourceKey: string,
  videoId: string,
): UseQueryResult<VideoDetail> {
  return useQuery({
    queryKey: ["video-detail", scope, sourceKey, videoId],
    queryFn: () => api.detail(sourceKey, videoId),
    enabled: sourceKey.length > 0 && videoId.length > 0,
    staleTime: DETAIL_STALE_MS,
    retry: 1,
  });
}
