// useFavoriteToggle — small hook owning is-favorited state for one (sourceKey, videoId) tuple.
// useFavoriteToggle — 承载单个 (sourceKey, videoId) 元组收藏状态的小 hook.

import { useCallback, useEffect, useState } from "react";

import {
  isFavorited as readIsFavorited, toggleFavorite, type FavoriteItem,
} from "@/storage/favorites";

/**
 * Args for useFavoriteToggle — full metadata, since iOS persists title/cover/type/year.
 * useFavoriteToggle 的参数 — 包含完整元数据, 因为 iOS 也会持久化 title/cover/type/year.
 */
export interface UseFavoriteToggleArgs {
  serverURL: string;
  item: Omit<FavoriteItem, "addedAt">;
}

/**
 * useFavoriteToggle — returns the current is-favorited flag and a synchronous toggle.
 * useFavoriteToggle — 返回当前收藏标志与同步切换函数.
 */
export function useFavoriteToggle({ serverURL, item }: UseFavoriteToggleArgs) {
  const [favorited, setFavorited] = useState(false);
  useEffect(() => {
    setFavorited(readIsFavorited(serverURL, item.sourceKey, item.videoId));
  }, [serverURL, item.sourceKey, item.videoId]);
  const toggle = useCallback(() => {
    const next = toggleFavorite(serverURL, item);
    setFavorited(next);
    return next;
  }, [item, serverURL]);
  return { favorited, toggle };
}
