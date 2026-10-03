// useFavoriteToggle — favorite state of one title, read from and written to the sync store.
//
// useFavoriteToggle — 某个标题的收藏状态, 从同步存储读取并写回.

import { useCallback } from "react";

import { useSync, useSyncRecord } from "@/sync/SyncContext";
import type { FavoritePayload } from "@/sync/types";

/**
 * useFavoriteToggle returns whether the title is a favorite and a toggle that returns the new state.
 * Favorites are keyed by title, so any source of the same title counts as favorited.
 *
 * useFavoriteToggle 返回标题是否已收藏, 以及返回切换后状态的 toggle.
 * 收藏按标题标识, 同一标题的任意来源都视为已收藏.
 */
export function useFavoriteToggle(payload: FavoritePayload) {
  const sync = useSync();
  const favorited = useSyncRecord("favorite", payload.title) !== null;
  const toggle = useCallback(() => {
    if (sync.status !== "ready") return favorited;
    if (favorited) {
      sync.store.remove("favorite", payload.title);
      return false;
    }
    return sync.store.upsert("favorite", payload) !== null;
  }, [favorited, payload, sync]);
  return { favorited, toggle };
}
