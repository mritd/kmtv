/**
 * viewerHooks — React Query hooks for viewer-facing (non-admin) API resources.
 * viewerHooks — 观看者（非管理员）API 资源的 React Query hooks.
 *
 * Responsibilities / 职责:
 *   - Fetch Douban home recommendations — 获取豆瓣首页推荐
 *   - Fetch paginated search results — 获取分页搜索结果
 *   - Fetch video detail records — 获取视频详情记录
 *   - Resolve playback URLs via mutation — 通过 mutation 解析播放 URL
 *
 * Key exports / 主要导出:
 *   useDoubanHomeQuery, useSearchQuery, useDetailQuery, usePlaybackURLMutation
 *
 * Callers / 调用方:
 *   viewer/home/HomePage.tsx, viewer/search/SearchPage.tsx,
 *   viewer/detail/DetailPage.tsx, viewer/playback/PlaybackPanel.tsx
 *
 * React Query key contract (TIER 4 LOCKED — callers and tests depend on exact shapes):
 *   ["douban-home"]           — Douban recommendations
 *   ["search", query]         — paginated search by query string
 *   ["detail", source, id]    — detail by source key + video id
 * Tier 4 锁定 — 调用方和测试依赖这些精确 key, 不得更改.
 */

import { useMutation, useQuery } from "@tanstack/react-query";

import type { Episode } from "./types";
import { useAPI } from "./context";

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
