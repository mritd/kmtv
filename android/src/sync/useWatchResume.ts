/**
 * sync/useWatchResume.ts — player gate that waits briefly for sync before choosing a resume point.
 *
 * sync/useWatchResume.ts — 播放器在选择续播位置前短暂等待同步的逻辑.
 *
 * Playback renders from the local record; a pull runs first and is awaited for at most 1.5 seconds.
 *
 * 播放以本地记录为准; 先发起一次拉取, 最多等待 1.5 秒.
 *
 * Shared verbatim with android/src/sync/; both platforms' SyncContext export useSync and useSyncRecord.
 *
 * 与 android/src/sync/ 逐字共享; 两个平台的 SyncContext 都导出 useSync 和 useSyncRecord.
 */
import { useEffect, useState } from "react";

import { normalizeSyncKey } from "./normalizeKey";
import { useSync, useSyncRecord } from "./SyncContext";
import type { WatchPayload } from "./types";

/**
 * PLAYER_SYNC_WAIT_MS is how long the player waits for a sync before using local data.
 *
 * PLAYER_SYNC_WAIT_MS 是播放器在使用本地数据前等待同步的时长.
 */
export const PLAYER_SYNC_WAIT_MS = 1_500;

/**
 * WatchResume reports whether the resume decision must still wait, and the record to resume from.
 *
 * WatchResume 表示续播决定是否仍需等待, 以及用于续播的记录.
 */
export interface WatchResume {
  pending: boolean;
  item: WatchPayload | null;
}

/**
 * useWatchResume returns the watch record of a title once the player sync settled or timed out.
 *
 * useWatchResume 在播放器同步完成或超时后返回某个标题的观看记录.
 */
export function useWatchResume(title: string): WatchResume {
  const sync = useSync();
  const record = useSyncRecord("watch", title);
  const store = sync.status === "ready" ? sync.store : null;
  const engine = sync.status === "ready" ? sync.engine : null;
  const gateKey = store && title ? `${store.scopeKey}|${normalizeSyncKey(title)}` : "";
  const [readyKey, setReadyKey] = useState("");

  useEffect(() => {
    if (!gateKey) return;
    if (!engine) {
      setReadyKey(gateKey);
      return;
    }
    let active = true;
    const release = () => {
      if (active) setReadyKey(gateKey);
    };
    const timer = setTimeout(release, PLAYER_SYNC_WAIT_MS);
    void engine.requestSync("player").finally(() => {
      clearTimeout(timer);
      release();
    });
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [gateKey, engine]);

  const pending = title.trim() !== "" && (sync.status === "probing" || (gateKey !== "" && readyKey !== gateKey));
  return { pending, item: pending || !record ? null : record.payload };
}
