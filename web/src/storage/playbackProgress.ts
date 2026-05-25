/**
 * storage/playbackProgress.ts — per-user per-title episode selection and position backed by localStorage.
 *
 * storage/playbackProgress.ts — 基于 localStorage 的用户每标题集数选择与播放进度.
 *
 * localStorage key: "kmtv.playback.v1"
 * Schema: Record<string, PlaybackProgressEntry>
 *   — key format: "<sourceKey>:<videoID>"  (same convention as favorites)
 *   — value: { groupIndex, episodeIndex, positionSec, durationSec, updatedAt }
 *   — schema is Tier 4 locked; the key name "kmtv.playback.v1" must not change
 *
 * Behaviour contract:
 *   - Capped at MAX_PROGRESS_ENTRIES (50) via LRU eviction on every write.
 *   - Near-end detection: position within COMPLETION_THRESHOLD_SEC (30 s) OR
 *     >= COMPLETION_THRESHOLD_RATIO (95%) → entry deleted instead of saved (resume skip).
 *   - monotonicTick guarantees strict ordering even when multiple writes land in the same ms.
 *   - Registers with authLifecycle so progress is cleared on user identity change.
 *
 * 行为契约:
 *   - 通过 LRU 淘汰限制最多 MAX_PROGRESS_ENTRIES (50) 条.
 *   - 接近结尾检测: 距结尾 <= 30 秒 或 >= 95% → 删除条目而非保存 (跳过续播).
 *   - monotonicTick 保证即使同毫秒批量写入也严格有序.
 *   - 向 authLifecycle 注册, 用户身份切换时清除进度.
 *
 * Callers: player/VideoPlayer (write), viewer/detail/DetailPage (read),
 *          viewer/favorites/FavoritesPage (read).
 */
import { registerUserScopedReset } from "@/auth/authLifecycle";

// LOCKED storage key — must not change. Renaming breaks existing user data.
// 锁定的存储键 — 禁止更改, 重命名会破坏现有用户数据.
export const playbackProgressKey = "kmtv.playback.v1";

/**
 * PlaybackProgressEntry captures the last-watched episode and position for a (sourceKey, videoID) pair.
 * PlaybackProgressEntry
 * 记录 (sourceKey, videoID) 对应的上次观看集数与进度.
 */
export interface PlaybackProgressEntry {
  groupIndex: number;
  episodeIndex: number;
  positionSec: number;
  durationSec: number;
  updatedAt: number;
}

/**
 * MAX_PROGRESS_ENTRIES caps the number of stored progress records.
 * LRU eviction keeps the store bounded across long-term use.
 *
 * MAX_PROGRESS_ENTRIES 限制存储的进度记录数量上限.
 * 长期使用通过 LRU 控制大小.
 */
export const MAX_PROGRESS_ENTRIES = 50;

/**
 * COMPLETION_THRESHOLD_SEC — treat playback within 30 s of the end as "finished."
 * Handles long films where 5% could be significantly more than 30 s.
 *
 * COMPLETION_THRESHOLD_SEC — 结尾 30 秒视为看完.
 * 处理长片场景 (5% 可能远超 30 秒).
 */
export const COMPLETION_THRESHOLD_SEC = 30;

/**
 * COMPLETION_THRESHOLD_RATIO — treat playback at >= 95% as "finished."
 * Handles short episodes where 30 s could be a large chunk of the runtime.
 *
 * COMPLETION_THRESHOLD_RATIO — 进度 >= 95% 视为看完.
 * 处理短集场景 (30 秒可能占总时长很大比例).
 */
export const COMPLETION_THRESHOLD_RATIO = 0.95;

// ProgressMap is the raw localStorage shape: a flat Record keyed by "<sourceKey>:<videoID>".
// ProgressMap 是 localStorage 原始结构: 以 "<sourceKey>:<videoID>" 为键的平铺 Record.
type ProgressMap = Record<string, PlaybackProgressEntry>;

/**
 * monotonicTick ensures all writes are strictly ordered even when multiple writes land in the
 * same millisecond. Each call bumps the counter to at least one above the previous value.
 *
 * monotonicTick 保证即使同毫秒批量写入, 所有写入也严格有序.
 * 每次调用至少在前一个值基础上加 1.
 */
let monotonicTick = 0;
function nextWriteTick(): number {
  const now = Date.now();
  monotonicTick = monotonicTick >= now ? monotonicTick + 1 : now;
  return monotonicTick;
}

// entryKey mirrors the favorites "<sourceKey>:<videoID>" convention for cross-module readability.
// entryKey 沿用 favorites 模块的 "<sourceKey>:<videoID>" 约定, 跨模块易读.
function entryKey(sourceKey: string, videoID: string): string {
  return `${sourceKey}:${videoID}`;
}

// readMap — read and validate the stored progress map. Returns {} on any error or missing key.
// readMap — 读取并验证存储的进度 map. 任何错误或键缺失时返回 {}.
function readMap(): ProgressMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(playbackProgressKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return isProgressMap(parsed) ? parsed : {};
  } catch {
    // Corrupt progress data should not block playback.
    // 损坏的播放进度不能阻塞播放.
    window.localStorage.removeItem(playbackProgressKey);
    return {};
  }
}

// writeMap — prune then persist. Quota errors are swallowed; next save retries.
// writeMap — 先剪枝再持久化. 配额错误静默丢弃, 下次保存重试.
function writeMap(map: ProgressMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(playbackProgressKey, JSON.stringify(prune(map)));
  } catch {
    // Quota errors silently drop the write; next save attempts again.
    // 配额错误静默丢弃, 下次保存重试.
  }
}

// prune evicts the oldest entries (lowest updatedAt) to keep the map at or below MAX_PROGRESS_ENTRIES.
// prune 淘汰最旧条目 (updatedAt 最小) 使 map 不超过 MAX_PROGRESS_ENTRIES.
function prune(map: ProgressMap): ProgressMap {
  const keys = Object.keys(map);
  if (keys.length <= MAX_PROGRESS_ENTRIES) return map;
  const sorted = keys.sort((a, b) => (map[b].updatedAt ?? 0) - (map[a].updatedAt ?? 0));
  const kept: ProgressMap = {};
  for (const key of sorted.slice(0, MAX_PROGRESS_ENTRIES)) {
    kept[key] = map[key];
  }
  return kept;
}

// isProgressMap validates that the parsed JSON is a flat Record of well-formed PlaybackProgressEntry values.
// Explicitly rejects arrays: `Array.isArray` is needed because typeof [] === "object".
// An empty array would otherwise pass the loop and accept bad data — silently losing writes
// because JSON.stringify([]) drops named properties added to an array instance.
// isProgressMap 验证解析后的 JSON 是平铺的、字段完整的 PlaybackProgressEntry Record.
// 显式拒绝数组: typeof [] === "object", 空数组会通过循环并接受坏数据 —
// 因为 JSON.stringify([]) 会丢弃数组实例上的具名属性, 导致写入静默丢失.
function isProgressMap(value: unknown): value is ProgressMap {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  for (const v of Object.values(value)) {
    if (typeof v !== "object" || v === null) return false;
    const entry = v as Partial<PlaybackProgressEntry>;
    if (typeof entry.groupIndex !== "number" || typeof entry.episodeIndex !== "number") return false;
    if (typeof entry.positionSec !== "number" || typeof entry.durationSec !== "number") return false;
    if (typeof entry.updatedAt !== "number") return false;
  }
  return true;
}

/**
 * getPlaybackProgress returns the stored progress entry for a (sourceKey, videoID) pair, or null.
 * Returns null immediately for blank sourceKey or videoID to avoid silently writing bad keys.
 *
 * getPlaybackProgress 返回 (sourceKey, videoID) 对应的存储进度条目, 或 null.
 * sourceKey 或 videoID 为空时立即返回 null, 避免静默写入非法键.
 */
export function getPlaybackProgress(sourceKey: string, videoID: string): PlaybackProgressEntry | null {
  if (!sourceKey || !videoID) return null;
  const map = readMap();
  return map[entryKey(sourceKey, videoID)] ?? null;
}

/**
 * setPlaybackSelection records which episode is active for a title.
 * If the same episode is re-selected, the existing positionSec/durationSec are preserved so
 * that the user's seek position is not reset on every re-render or navigation event.
 * If a different episode is selected, position is reset to zero.
 *
 * setPlaybackSelection 记录某标题当前激活的集数.
 * 若重新选中同一集, 保留现有的 positionSec/durationSec, 避免每次重渲染或导航都重置进度.
 * 若切换到不同集数, 进度重置为零.
 */
export function setPlaybackSelection(
  sourceKey: string,
  videoID: string,
  groupIndex: number,
  episodeIndex: number,
): void {
  if (!sourceKey || !videoID) return;
  const map = readMap();
  const key = entryKey(sourceKey, videoID);
  const previous = map[key];
  const sameEpisode = previous && previous.groupIndex === groupIndex && previous.episodeIndex === episodeIndex;
  map[key] = {
    groupIndex,
    episodeIndex,
    positionSec: sameEpisode ? previous.positionSec : 0,
    durationSec: sameEpisode ? previous.durationSec : 0,
    updatedAt: nextWriteTick(),
  };
  writeMap(map);
}

/**
 * setPlaybackPosition records the current playback time and total duration for the active episode.
 * Silently ignores negative or non-finite position values (ArtPlayer can emit NaN briefly on seek).
 * Clears the entry instead of saving when the position is near the end — defined by either the
 * COMPLETION_THRESHOLD_SEC or COMPLETION_THRESHOLD_RATIO gate — so the next resume starts fresh.
 *
 * setPlaybackPosition 记录当前集数的最新播放进度和总时长.
 * 静默忽略负数或非有限位置值 (ArtPlayer 在拖拽时可能短暂发出 NaN).
 * 接近结尾时删除条目而非保存, 使下次续播从头开始.
 * 接近结尾由 COMPLETION_THRESHOLD_SEC 或 COMPLETION_THRESHOLD_RATIO 任一触发.
 */
export function setPlaybackPosition(
  sourceKey: string,
  videoID: string,
  groupIndex: number,
  episodeIndex: number,
  positionSec: number,
  durationSec: number,
): void {
  if (!sourceKey || !videoID) return;
  if (!Number.isFinite(positionSec) || positionSec < 0) return;
  const map = readMap();
  const key = entryKey(sourceKey, videoID);
  // Drop the record when nearly finished so resume does not snap back to the credits.
  // 结尾附近视为看完, 直接清除避免回放片尾.
  if (Number.isFinite(durationSec) && durationSec > 0) {
    const nearEndBySeconds = durationSec - positionSec <= COMPLETION_THRESHOLD_SEC;
    const nearEndByRatio = positionSec / durationSec >= COMPLETION_THRESHOLD_RATIO;
    if (nearEndBySeconds || nearEndByRatio) {
      delete map[key];
      writeMap(map);
      return;
    }
  }
  map[key] = {
    groupIndex,
    episodeIndex,
    positionSec,
    // Preserve a previously known duration when the current call has an invalid duration.
    // 当前调用的 durationSec 无效时, 保留之前已知的时长.
    durationSec: Number.isFinite(durationSec) && durationSec > 0 ? durationSec : (map[key]?.durationSec ?? 0),
    updatedAt: nextWriteTick(),
  };
  writeMap(map);
}

/**
 * clearPlaybackProgress removes the progress entry for a single (sourceKey, videoID) pair.
 * Used when the user explicitly marks an episode as watched or resets their position.
 *
 * clearPlaybackProgress 移除单个 (sourceKey, videoID) 对的进度条目.
 * 用于用户明确标记集数为已看或重置进度时.
 */
export function clearPlaybackProgress(sourceKey: string, videoID: string): void {
  if (!sourceKey || !videoID) return;
  const map = readMap();
  delete map[entryKey(sourceKey, videoID)];
  writeMap(map);
}

/**
 * clearAllPlaybackProgress removes the entire progress key from localStorage.
 * Called automatically by the authLifecycle hook on identity change.
 * Also exposed for explicit "clear history" UI actions.
 *
 * clearAllPlaybackProgress 从 localStorage 中移除整个进度键.
 * 身份切换时由 authLifecycle 钩子自动调用.
 * 也用于"清空历史"等显式 UI 操作.
 */
export function clearAllPlaybackProgress(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(playbackProgressKey);
}

// Playback history is tied to the signed-in user;
// clear it on identity change so the next account starts fresh.
// 播放历史绑定登录用户, 切换身份时清空.
registerUserScopedReset(() => clearAllPlaybackProgress());
