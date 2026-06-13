// react-query hook wrappers for the home feed (more land in M3+).
// 首页信息流的 react-query 包装 hook (M3+ 会扩展更多).

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import type { DoubanAPI } from "./douban";
import type { DoubanHomeResponse } from "./types";

const HOME_STALE_MS = 2 * 60 * 1000;

/**
 * useDoubanHomeQuery: cached for 2 minutes (matches spec section 6). The queryKey carries
 * `scope` so callers can isolate cache entries per server (passing `serverURL` keeps users
 * from seeing the previous server's home feed after switching).
 * useDoubanHomeQuery: 缓存 2 分钟 (与 spec 第 6 节一致). queryKey 携带 `scope`, 调用者
 * 通常传入 `serverURL` 以便切换服务器后不会复用上一台服务器的缓存.
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
