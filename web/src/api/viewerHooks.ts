/**
 * viewerHooks — React Query hooks for viewer-facing (non-admin) API resources.
 * viewerHooks — 观看者（非管理员）API 资源的 React Query hooks.
 *
 * Responsibilities / 职责:
 *   - Fetch Douban home recommendations — 获取豆瓣首页推荐
 *   - Fetch browse category metadata — 获取浏览分类元数据
 *   - Fetch paginated, filtered Douban recommendation pages — 获取分页且经筛选的豆瓣推荐页
 *   - Fetch paginated search results — 获取分页搜索结果
 *   - Fetch video detail records — 获取视频详情记录
 *   - Resolve playback URLs via mutation — 通过 mutation 解析播放 URL
 *
 * Key exports / 主要导出:
 *   useDoubanHomeQuery, useCategoriesQuery, useDoubanRecommendInfiniteQuery,
 *   useSearchQuery, useDetailQuery, usePlaybackURLMutation, RECOMMEND_PAGE_SIZE
 *
 * Callers / 调用方:
 *   viewer/home/HomePage.tsx, viewer/categories/CategoriesPage.tsx,
 *   viewer/search/SearchPage.tsx, viewer/detail/DetailPage.tsx,
 *   viewer/playback/PlaybackPanel.tsx
 *
 * React Query key contract (TIER 4 LOCKED — callers and tests depend on exact shapes):
 *   ["douban-home"]                                   — Douban recommendations
 *   ["douban-categories"]                             — browse category metadata
 *   ["douban-recommend", kind, tag, format, region]   — filtered recommendation pages
 *   ["search", query]                                 — paginated search by query string
 *   ["detail", source, id]                            — detail by source key + video id
 * Tier 4 锁定 — 调用方和测试依赖这些精确 key, 不得更改.
 */

import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";

import type { DoubanRecommendFilter, Episode } from "./types";
import { useAPI } from "./context";

/**
 * RECOMMEND_PAGE_SIZE — items requested per filtered recommendation page.
 * RECOMMEND_PAGE_SIZE — 每页筛选推荐请求的条目数.
 *
 * A page returning fewer than this count signals the end of the list (no further pages).
 * 当某页返回少于此数量时, 表示列表结束 (无更多页).
 */
export const RECOMMEND_PAGE_SIZE = 20;

/**
 * RecommendFilterKey — the four filter fields that uniquely identify a recommendation list.
 * RecommendFilterKey — 唯一标识一份推荐列表的四个筛选字段.
 *
 * These compose the React Query key so changing any filter switches to a separate cache
 * entry; in-flight requests for the previous filter can no longer overwrite the new list.
 * 这些字段组成 React Query key, 改动任一筛选即切换到独立缓存条目;
 * 上一组筛选的在途请求无法再覆盖新列表.
 */
export type RecommendFilterKey = Required<Pick<DoubanRecommendFilter, "kind" | "tag" | "format" | "region">>;

/**
 * useDoubanHomeQuery fetches the Douban home recommendation sections.
 * useDoubanHomeQuery
 * 获取豆瓣首页推荐分区数据.
 *
 * retry: 1 because Douban may be slow; a single retry avoids flashing errors on transient blips.
 * retry: 1 是因为豆瓣有时较慢; 单次重试可避免因短暂波动而闪现错误提示.
 */
export function useDoubanHomeQuery() {
  const api = useAPI();
  return useQuery({ queryKey: ["douban-home"], queryFn: () => api.doubanHome(), retry: 1 });
}

/**
 * useCategoriesQuery fetches the browse category metadata (groups, sub-categories, regions).
 * useCategoriesQuery
 * 获取浏览分类元数据 (分组、子分类、地区).
 *
 * Category metadata changes rarely, so a 5-minute staleTime avoids refetching on every mount
 * while still picking up server-side changes within a session. retry: 1 matches the home query
 * since the same upstream (Douban) can be transiently slow.
 * 分类元数据很少变化, 因此设置 5 分钟 staleTime, 避免每次挂载都重新请求,
 * 同时仍能在一个会话内捕获服务端变更. retry: 1 与首页查询一致, 因为同一上游 (豆瓣) 可能短暂变慢.
 */
export function useCategoriesQuery() {
  const api = useAPI();
  return useQuery({
    queryKey: ["douban-categories"],
    queryFn: () => api.doubanCategories(),
    retry: 1,
    staleTime: 5 * 60_000,
  });
}

/**
 * useDoubanRecommendInfiniteQuery fetches filtered recommendation items page-by-page.
 * useDoubanRecommendInfiniteQuery
 * 逐页获取经筛选的推荐条目.
 *
 * The query key embeds all four filter fields, so selecting a different category, sub-category,
 * or region transparently switches to a separate cache entry — no manual stale-response guard
 * is needed (unlike the iOS generation counter). The query is disabled until `kind` is non-empty
 * because the backend requires it; this avoids a blank fetch before category metadata loads.
 * query key 内嵌全部四个筛选字段, 因此切换分类/子分类/地区会透明地切到独立缓存条目 —
 * 无需手写陈旧响应防护 (不同于 iOS 的代次计数器). 在 kind 为空前禁用查询 (后端必填 kind),
 * 避免分类元数据加载完成前发起空请求.
 *
 * Pagination: each page requests RECOMMEND_PAGE_SIZE items starting at the cumulative count of
 * items already fetched (raw, pre-dedup — matching the iOS offset logic). getNextPageParam
 * returns undefined when the last page is short, signalling the end of the list.
 * 分页: 每页请求 RECOMMEND_PAGE_SIZE 条, 起始偏移为已获取条目的累计原始数量 (去重前, 与 iOS 偏移逻辑一致).
 * 当最后一页不足整页时, getNextPageParam 返回 undefined, 表示列表结束.
 */
export function useDoubanRecommendInfiniteQuery(filter: RecommendFilterKey) {
  const api = useAPI();
  return useInfiniteQuery({
    queryKey: ["douban-recommend", filter.kind, filter.tag, filter.format, filter.region],
    queryFn: ({ pageParam }) =>
      api.doubanRecommendFilter({ ...filter, start: pageParam, count: RECOMMEND_PAGE_SIZE }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      // A short final page means the upstream has no more items for this filter.
      // 最后一页不足整页, 说明该筛选下上游已无更多条目.
      if (lastPage.items.length < RECOMMEND_PAGE_SIZE) return undefined;
      // Next offset = total raw items fetched so far; dedup happens later at render time.
      // 下一偏移 = 目前已获取的原始条目总数; 去重在渲染阶段进行.
      return allPages.reduce((sum, page) => sum + page.items.length, 0);
    },
    enabled: filter.kind.length > 0,
    retry: 1,
  });
}

/**
 * useSearchQuery fetches aggregated search results for the given query string.
 * useSearchQuery
 * 获取给定查询字符串的聚合搜索结果.
 *
 * The query is disabled when the trimmed query is empty to avoid sending blank searches.
 * 当 trim 后的查询为空时禁用, 以避免发送空搜索请求.
 */
export function useSearchQuery(query: string) {
  const api = useAPI();
  return useQuery({ queryKey: ["search", query], queryFn: () => api.search(query), enabled: query.trim().length > 0 });
}

/**
 * useDetailQuery fetches the full video detail record for a source key + video ID pair.
 * useDetailQuery
 * 获取源 key 和视频 ID 对应的完整视频详情记录.
 *
 * The query is disabled when either source or id is empty to prevent premature fetches
 * before route params are available.
 * 当 source 或 id 为空时禁用, 防止在路由参数就绪前过早发起请求.
 */
export function useDetailQuery(source: string, id: string) {
  const api = useAPI();
  return useQuery({
    queryKey: ["detail", source, id],
    queryFn: () => api.detail(source, id),
    enabled: source.length > 0 && id.length > 0,
  });
}

/**
 * usePlaybackURLMutation resolves the proxy or direct playback URL for an episode.
 * usePlaybackURLMutation
 * 解析剧集的代理或直连播放 URL.
 *
 * The source key is captured at hook creation time and forwarded to each mutation call.
 * Callers fire `mutate(episode)` or `mutateAsync(episode)` when the user picks an episode.
 * source key 在 hook 创建时捕获并传递给每次 mutation 调用.
 * 调用方在用户选择剧集时触发 mutate(episode) 或 mutateAsync(episode).
 */
export function usePlaybackURLMutation(source: string) {
  const api = useAPI();
  return useMutation({ mutationFn: (episode: Episode) => api.playbackURL(episode.url, source) });
}
