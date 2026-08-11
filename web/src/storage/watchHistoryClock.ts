/**
 * storage/watchHistoryClock.ts — shared ordered event clock for watch-history writes.
 *
 * storage/watchHistoryClock.ts — 观看历史写入共享有序事件时钟.
 *
 * Responsibilities / 职责:
 *   - Issue strictly increasing millisecond event_time_ms values for local and remote history events
 *
 *     — 为本地和远端历史事件发放严格递增的毫秒级 event_time_ms 值
 *
 * Callers / 调用方:
 *   storage/anonymousWatchHistory.ts, api/viewerHooks.ts, viewer/detail/DetailPage.tsx
 *
 * ADR locks / ADR 约束:
 *   ADR-015 requires ordered event timestamps so clear tombstones win over older writes.
 *
 *   ADR-015 要求有序事件时间戳, 使清空墓碑能胜过更旧写入.
 */

let lastEventTime = 0;

/**
 * nextWatchHistoryEventTime returns a strictly increasing millisecond event timestamp.
 *
 * 返回严格递增的毫秒级事件时间戳.
 *
 * Same-millisecond playback, visibility, and teardown checkpoints still receive distinct ordered values.
 *
 * 同一毫秒内的播放, 可见性和卸载检查点仍会获得不同的有序值.
 */
export function nextWatchHistoryEventTime(): number {
  lastEventTime = Math.max(Date.now(), lastEventTime + 1);
  return lastEventTime;
}
