/**
 * detailStore — per-video detail and playback state with LRU eviction.
 * detailStore — 带 LRU 淘汰的逐视频详情与播放状态 store.
 *
 * Responsibilities / 职责:
 *   - Maintain a bounded LRU cache of DetailEntry records keyed by (sourceKey, videoID) — 维护以 (sourceKey, videoID) 为键的有界 LRU 缓存
 *   - Track bundle resolution, source selection, pending episode selection, and playback — 追踪 bundle 解析、选源、待定集数选择、播放状态
 *   - Route PlaybackAction through the pure playbackReducer — 将 PlaybackAction 路由到纯函数 playbackReducer
 *   - Evict least-recently-used entries when the cache exceeds LRU_CAP — 超出容量时淘汰最近最少使用的条目
 *   - Reset all entries on user switch (user-scoped state) — 用户切换时清空所有条目 (用户作用域状态)
 *
 * State shape / 状态结构:
 *   entries: Record<string, DetailEntry>  — active video detail entries
 *
 * Actions / 动作:
 *   ensureEntry(sourceKey, videoID) → string  — upsert entry and return its key
 *   touch(key)                               — update lastTouched for LRU ordering
 *   setBundle(key, bundle, hasResolved?)     — store the resolved SourceBundle
 *   setSelectedSourceID(key, sourceID)       — record which source tab the user chose
 *   setPendingEpisodeSelection(key, value)   — queue a cross-source episode selection
 *   dispatchPlayback(key, action)            — drive the playback state machine
 *   resetEntry(key)                          — remove a single entry
 *   resetAll()                               — clear all entries (user switch / logout)
 *   resetAllPlayback()                       — reset playback state but keep entries (settings change)
 *
 * Callers / 调用方:
 *   viewer/detail/* components (reads and writes most actions)
 *   viewer/playback/VideoPlayer.tsx (dispatchPlayback)
 *   auth/authLifecycle.ts (registerUserScopedReset → resetAll)
 *   test/setup.ts (resetAll in beforeEach)
 */

import { createStore } from "zustand/vanilla";

import { registerUserScopedReset } from "@/auth/authLifecycle";
import type { SourceBundle } from "@/storage/sourceBundles";
import {
  createInitialPlaybackState,
  playbackReducer,
  type PlaybackAction,
  type PlaybackState,
} from "@/viewer/playback/playbackState";

// Maximum number of concurrent detail entries in the LRU cache.
// Entries beyond this cap are evicted in least-recently-used order.
// LRU 缓存的最大条目数; 超出此值时按最近最少使用顺序淘汰.
const LRU_CAP = 8;

/**
 * detailEntryKey — derive a collision-free cache key for a (sourceKey, videoID) pair.
 * detailEntryKey — 由 (sourceKey, videoID) 生成无碰撞缓存 key.
 *
 * Uses JSON-encoded tuple form so any character in either field is safe — including
 * separators that would collide under a literal "a + sep + b" scheme (e.g. the prior
 * ":::" form collided between ("a:::b","c") and ("a","b:::c")).
 * 使用 JSON 元组编码, 两个字段中的任意字符都安全 — 包括会让朴素拼接 "a + sep + b"
 * 发生碰撞的分隔符 (旧的 ":::" 形式中 ("a:::b","c") 与 ("a","b:::c") 会撞 key).
 */
export function detailEntryKey(sourceKey: string, videoID: string): string {
  return JSON.stringify([sourceKey, videoID]);
}

/**
 * DetailEntry — one slot in the LRU cache representing a single video's full detail state.
 * DetailEntry — LRU 缓存中单条视频的完整详情状态.
 *
 * `lastTouched` drives LRU eviction; updated by ensureEntry, touch, and every mutation.
 * lastTouched 驱动 LRU 淘汰, 由 ensureEntry、touch 及每次变更更新.
 */
export interface DetailEntry {
  sourceKey: string;
  videoID: string;
  bundle: SourceBundle | null;
  hasResolvedBundle: boolean;
  selectedSourceID: string | null;
  pendingEpisodeSelection: { sourceKey: string; videoID: string; episodeIndex: number } | null;
  playback: PlaybackState;
  lastTouched: number;
}

/**
 * DetailState — full state + action contract of detailStore.
 * DetailState — detailStore 的完整状态与 action 接口.
 */
export interface DetailState {
  entries: Record<string, DetailEntry>;
  ensureEntry(sourceKey: string, videoID: string): string;
  touch(key: string): void;
  setBundle(key: string, bundle: SourceBundle, hasResolved?: boolean): void;
  setSelectedSourceID(key: string, sourceID: string): void;
  setPendingEpisodeSelection(key: string, value: DetailEntry["pendingEpisodeSelection"]): void;
  dispatchPlayback(key: string, action: PlaybackAction): void;
  resetEntry(key: string): void;
  resetAll(): void;
  resetAllPlayback(): void;
}

// Monotonic touch counter so two ensureEntry calls in the same millisecond still order correctly.
// 单调递增的计数, 避免同一毫秒内多次 ensureEntry 排序紊乱.
let touchSeq = 0;
function nextTouch(): number {
  touchSeq += 1;
  // Multiply Date.now() by 1000 to give 1ms resolution, then add the sub-ms sequence mod 1000
  // to order rapid back-to-back calls within one millisecond (up to ~1000 calls/ms before wrap).
  // This is sufficient for LRU ordering — it does not guarantee strict monotonicity beyond that rate.
  // 将 Date.now() 乘以 1000 提供 1ms 精度, 加上 sub-ms 序列模 1000 对同一毫秒内的快速调用排序 (每毫秒约 1000 次内有效).
  // 满足 LRU 排序需求; 不保证超高频率下的严格单调性.
  return Date.now() * 1000 + (touchSeq % 1000);
}

/**
 * detailStore — vanilla Zustand store (no React hooks required).
 * detailStore — 原生 Zustand store (无需 React hook).
 */
export const detailStore = createStore<DetailState>()((set, get) => ({
  entries: {},

  /**
   * ensureEntry — upsert a detail entry for (sourceKey, videoID) and return its key.
   * ensureEntry — 对 (sourceKey, videoID) 进行 upsert 并返回 key.
   *
   * If the entry already exists it is touched (lastTouched updated) to stay hot in the LRU.
   * If it is new it is initialized with blank state and then LRU eviction is applied.
   * 若条目已存在则 touch 更新 lastTouched; 若为新条目则初始化并执行 LRU 淘汰.
   */
  ensureEntry: (sourceKey, videoID) => {
    const key = detailEntryKey(sourceKey, videoID);
    set((s) => {
      if (s.entries[key]) {
        // Entry exists — only update lastTouched to keep it hot in the LRU cache.
        // 条目已存在 — 仅更新 lastTouched 以保持在 LRU 缓存中热度.
        return {
          entries: { ...s.entries, [key]: { ...s.entries[key], lastTouched: nextTouch() } },
        };
      }
      const fresh: DetailEntry = {
        sourceKey,
        videoID,
        bundle: null,
        hasResolvedBundle: false,
        selectedSourceID: null,
        pendingEpisodeSelection: null,
        playback: createInitialPlaybackState(),
        lastTouched: nextTouch(),
      };
      const next = { ...s.entries, [key]: fresh };
      return { entries: evictLRU(next) };
    });
    return key;
  },

  /**
   * touch — bump lastTouched for an existing entry without changing any other field.
   * touch — 在不修改其他字段的情况下更新 lastTouched.
   *
   * No-op if the key is unknown; guards against callers holding a stale key after resetEntry.
   * 若 key 不存在则无操作, 防止调用方持有 resetEntry 后的陈旧 key 导致错误.
   */
  touch: (key) =>
    set((s) => {
      const entry = s.entries[key];
      // Guard: unknown key — return state unchanged to avoid an empty phantom entry.
      // 防护: 未知 key — 原样返回状态, 避免创建空的幽灵条目.
      if (!entry) return s;
      return { entries: { ...s.entries, [key]: { ...entry, lastTouched: nextTouch() } } };
    }),

  /**
   * setBundle — store the resolved SourceBundle for an entry.
   * setBundle — 存储条目已解析的 SourceBundle.
   *
   * `hasResolved` defaults to true; pass false for partial/preview bundles that should
   * not yet suppress a subsequent re-fetch.
   * hasResolved 默认为 true; 对部分/预览 bundle 传 false 以允许后续再次拉取.
   */
  setBundle: (key, bundle, hasResolved = true) =>
    set((s) => updateEntry(s, key, { bundle, hasResolvedBundle: hasResolved })),

  /**
   * setSelectedSourceID — record which source tab the user selected.
   * setSelectedSourceID — 记录用户选择的视频源 tab.
   */
  setSelectedSourceID: (key, sourceID) =>
    set((s) => updateEntry(s, key, { selectedSourceID: sourceID })),

  /**
   * setPendingEpisodeSelection — queue a cross-source episode jump.
   * setPendingEpisodeSelection — 入队跨视频源的集数跳转.
   *
   * Set to null to clear the pending selection after it has been applied.
   * 应用后传 null 清除待定选择.
   */
  setPendingEpisodeSelection: (key, value) =>
    set((s) => updateEntry(s, key, { pendingEpisodeSelection: value })),

  /**
   * dispatchPlayback — route a PlaybackAction through the pure playbackReducer for a given entry.
   * dispatchPlayback — 将 PlaybackAction 通过纯函数 playbackReducer 路由到指定条目.
   *
   * No-op if the key is unknown; guards against race conditions where playback
   * resolves after resetEntry is called.
   * 若 key 不存在则无操作, 防止 resetEntry 后播放解析仍触发的竞态条件.
   */
  dispatchPlayback: (key, action) =>
    set((s) => {
      const entry = s.entries[key];
      // Guard: entry may have been evicted or reset while playback was resolving.
      // 防护: 条目在播放解析期间可能已被淘汰或重置.
      if (!entry) return s;
      const next = playbackReducer(entry.playback, action);
      return {
        entries: { ...s.entries, [key]: { ...entry, playback: next, lastTouched: nextTouch() } },
      };
    }),

  /**
   * resetEntry — remove a single entry from the cache.
   * resetEntry — 从缓存中移除单条条目.
   *
   * No-op if the key is unknown.
   * 若 key 不存在则无操作.
   */
  resetEntry: (key) =>
    set((s) => {
      // Guard: do not create an unnecessary state object when key is absent.
      // 防护: key 不存在时不创建多余的状态对象.
      if (!s.entries[key]) return s;
      const rest = { ...s.entries };
      delete rest[key];
      return { entries: rest };
    }),

  /**
   * resetAll — clear every entry (called on user switch / logout).
   * resetAll — 清空所有条目 (用户切换/登出时调用).
   */
  resetAll: () => set({ entries: {} }),

  /**
   * resetAllPlayback — reset playback state for every entry while keeping the entries themselves.
   * resetAllPlayback — 重置所有条目的播放状态, 但保留条目本身.
   *
   * Called when global playback settings change (e.g. proxy ↔ direct mode switch)
   * so that all open detail pages re-resolve their URLs with the new settings.
   * 全局播放设置变更时调用 (如代理↔直连切换), 使所有已打开的详情页用新设置重新解析 URL.
   */
  resetAllPlayback: () =>
    set((s) => {
      const next: Record<string, DetailEntry> = {};
      for (const [key, entry] of Object.entries(s.entries)) {
        next[key] = { ...entry, playback: createInitialPlaybackState() };
      }
      return { entries: next };
    }),
}));

/**
 * updateEntry — immutably apply a partial patch to a named entry and bump its lastTouched.
 * updateEntry — 不可变地将局部补丁应用到指定条目并更新 lastTouched.
 *
 * Returns state unchanged if the key is not found, so callers need not guard themselves.
 * 若 key 不存在则原样返回状态, 调用方无需自行防护.
 */
function updateEntry(s: DetailState, key: string, patch: Partial<DetailEntry>): DetailState {
  const entry = s.entries[key];
  // Guard: unknown key — return state reference unchanged (no spurious re-render).
  // 防护: 未知 key — 原样返回状态引用 (避免不必要的重渲染).
  if (!entry) return s;
  return {
    ...s,
    entries: { ...s.entries, [key]: { ...entry, ...patch, lastTouched: nextTouch() } },
  };
}

/**
 * evictLRU — trim the entries map to LRU_CAP by removing the least-recently-used entries.
 * evictLRU — 通过移除最近最少使用的条目将 entries 修剪到 LRU_CAP.
 *
 * Returns the input unchanged if it is at or below capacity.
 * 若条目数未超出容量则原样返回.
 */
function evictLRU(entries: Record<string, DetailEntry>): Record<string, DetailEntry> {
  const keys = Object.keys(entries);
  if (keys.length <= LRU_CAP) return entries;
  // Sort ascending by lastTouched so the oldest entries are at the front.
  // 按 lastTouched 升序排列, 最旧的条目在最前.
  const sorted = [...keys].sort((a, b) => entries[a].lastTouched - entries[b].lastTouched);
  const drop = sorted.slice(0, keys.length - LRU_CAP);
  const next = { ...entries };
  for (const k of drop) delete next[k];
  return next;
}

// Detail entries are user-scoped (playback URLs and selections reflect identity).
// 详情条目属于用户作用域 (播放 URL 和选择反映身份).
registerUserScopedReset(() => detailStore.getState().resetAll());
