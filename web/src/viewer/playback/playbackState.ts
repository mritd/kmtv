/**
 * playbackState — pure state machine types and reducer for the video playback lifecycle.
 * playbackState — 纯状态机类型和视频播放生命周期的 reducer.
 *
 * Responsibilities / 职责:
 *   - Define PlaybackStatus / PlaybackMode / PlaybackState shape — 定义播放状态类型
 *   - Define PlaybackAction union for every valid transition — 定义所有有效转换的 action 联合
 *   - createInitialPlaybackState() — return the canonical idle snapshot — 返回标准 idle 快照
 *   - playbackReducer() — pure function: (state, action) → nextState — 纯函数状态转换
 *
 * Design notes / 设计说明:
 *   - No React, no side-effects, no I/O. 100% unit-testable. — 无 React, 无副作用, 无 I/O, 100% 可单元测试.
 *   - The reducer is hosted by PlaybackPanel.tsx via React.useReducer. — 由 PlaybackPanel.tsx 通过 React.useReducer 托管.
 *   - All url/mode/error fields are cleared on every episode/source selection, never carried from a prior resolve. — url/mode/error 在每次集数/源选择时均被清空.
 *
 * Callers / 调用方:
 *   viewer/playback/PlaybackPanel.tsx (hosts state + calls dispatch)
 *   viewer/detail/DetailPage.tsx     (reads state to drive episode picker + source picker)
 */

import type { Episode } from "@/api/types";

/**
 * PlaybackStatus — lifecycle phase of the ArtPlayer-backed video player.
 * PlaybackStatus — ArtPlayer 播放器的生命周期阶段.
 *
 * - "idle"      — no episode selected; placeholder shown — 无集数被选中; 显示占位符
 * - "resolving" — episode selected; waiting for proxy/direct URL — 集数已选中; 等待代理/直连 URL
 * - "ready"     — URL resolved; ArtPlayer mounting — URL 已解析; ArtPlayer 正在挂载
 * - "playing"   — ArtPlayer "video:play" event fired — ArtPlayer "video:play" 事件已触发
 * - "failed"    — URL resolution failed; retry button shown — URL 解析失败; 显示重试按钮
 */
export type PlaybackStatus = "idle" | "resolving" | "ready" | "playing" | "failed";

/**
 * PlaybackMode — whether the resolved stream URL is served via proxy or directly from the CDN.
 * PlaybackMode — 解析后的流 URL 是通过代理还是直接来自 CDN.
 *
 * - "proxy"  — URL passes through the KMTV media proxy — URL 经过 KMTV 媒体代理
 * - "direct" — URL points directly at the upstream CDN — URL 直接指向上游 CDN
 */
export type PlaybackMode = "proxy" | "direct";

/**
 * PlaybackState — snapshot shape held by PlaybackPanel.tsx via useReducer.
 * PlaybackState — 由 PlaybackPanel.tsx 通过 useReducer 持有的快照形状.
 *
 * url and mode are only non-null when status is "ready" or "playing".
 * url 和 mode 仅在 status 为 "ready" 或 "playing" 时非 null.
 *
 * error is only non-null when status is "failed".
 * error 仅在 status 为 "failed" 时非 null.
 */
export interface PlaybackState {
  status: PlaybackStatus;
  /** groupIndex — index into the source's episode groups array. groupIndex — 源集数组数组的索引. */
  groupIndex: number;
  /** episodeIndex — index into the selected group's episode list. episodeIndex — 选中组集数列表的索引. */
  episodeIndex: number;
  /** selectedEpisode — currently selected episode (null when idle). selectedEpisode — 当前选中集数 (idle 时为 null). */
  selectedEpisode: Episode | null;
  /** url — resolved stream URL (null when not yet resolved). url — 已解析流 URL (未解析时为 null). */
  url: string | null;
  /** mode — proxy or direct (null when url is null). mode — 代理或直连 (url 为 null 时为 null). */
  mode: PlaybackMode | null;
  /** error — failure message for the "failed" status. error — "failed" 状态的失败消息. */
  error: string | null;
}

/**
 * PlaybackAction — discriminated union of all valid state transitions.
 * PlaybackAction — 所有有效状态转换的可辨识联合.
 *
 * - selectEpisode  — user picks a specific episode — 用户选中特定集数
 * - selectSource   — user switches to a different source group — 用户切换到不同源组
 * - resolveSuccess — proxy/CDN lookup succeeded; url + mode are set — 代理/CDN 查询成功; 设置 url + mode
 * - resolveFailure — proxy/CDN lookup failed; error message is set — 代理/CDN 查询失败; 设置 error 消息
 * - playing        — ArtPlayer fires "video:play" — ArtPlayer 触发 "video:play"
 * - reset          — return to initial idle state (e.g. on source change from parent) — 回到初始 idle 状态
 */
export type PlaybackAction =
  | { type: "selectEpisode"; groupIndex: number; episodeIndex: number; episode: Episode }
  | { type: "selectSource"; groupIndex: number; groups: Episode[][] }
  | { type: "resolveSuccess"; url: string; mode: PlaybackMode }
  | { type: "resolveFailure"; message: string }
  | { type: "playing" }
  | { type: "reset" };

/**
 * createInitialPlaybackState — return the canonical idle snapshot for useReducer initial state.
 * createInitialPlaybackState — 返回 useReducer 初始状态的标准 idle 快照.
 *
 * Always construct via this function rather than an inline literal so the shape stays in sync
 * when the interface evolves.
 * 始终通过此函数构造, 而非内联字面量, 以便接口演化时保持一致.
 */
export function createInitialPlaybackState(): PlaybackState {
  return { status: "idle", groupIndex: 0, episodeIndex: 0, selectedEpisode: null, url: null, mode: null, error: null };
}

/**
 * playbackReducer — pure (state, action) → nextState function for the ArtPlayer lifecycle.
 * playbackReducer — 用于 ArtPlayer 生命周期的纯 (state, action) → nextState 函数.
 *
 * All url/mode/error fields are cleared on "selectEpisode" and "selectSource" so a leftover URL
 * from a previous resolve never leaks into a newly resolved episode.
 * "selectEpisode" 和 "selectSource" 时清除所有 url/mode/error 字段, 防止旧解析 URL 泄漏到新集数.
 *
 * @param state  — current PlaybackState snapshot — 当前 PlaybackState 快照
 * @param action — discriminated union action — 可辨识联合 action
 * @returns      — next immutable PlaybackState snapshot — 下一个不可变 PlaybackState 快照
 */
export function playbackReducer(state: PlaybackState, action: PlaybackAction): PlaybackState {
  switch (action.type) {
    case "selectEpisode":
      // Always clear url/mode/error; the previous resolve is irrelevant for the new episode.
      // 始终清除 url/mode/error; 新集数与之前的解析结果无关.
      return {
        status: "resolving",
        groupIndex: action.groupIndex,
        episodeIndex: action.episodeIndex,
        selectedEpisode: action.episode,
        url: null,
        mode: null,
        error: null,
      };
    case "selectSource": {
      // Use the prior episodeIndex when the new group is long enough; otherwise fall back to 0.
      // 新组长度足够时保留旧 episodeIndex; 否则回退到 0.
      const episodes = action.groups[action.groupIndex] ?? [];
      const nextEpisodeIndex = state.episodeIndex < episodes.length ? state.episodeIndex : 0;
      const selectedEpisode = episodes[nextEpisodeIndex] ?? null;
      // Idle when the group is empty (source not yet loaded); resolving otherwise.
      // 组为空 (源尚未加载) 时进入 idle; 否则进入 resolving.
      return {
        status: selectedEpisode ? "resolving" : "idle",
        groupIndex: action.groupIndex,
        episodeIndex: nextEpisodeIndex,
        selectedEpisode,
        url: null,
        mode: null,
        error: null,
      };
    }
    case "resolveSuccess":
      // Spread to preserve groupIndex/episodeIndex/selectedEpisode from the prior state.
      // 展开以保留先前状态的 groupIndex/episodeIndex/selectedEpisode.
      return { ...state, status: "ready", url: action.url, mode: action.mode, error: null };
    case "resolveFailure":
      // Keep selectedEpisode so the retry button can display the episode name.
      // 保留 selectedEpisode 以便重试按钮显示集数名称.
      return { ...state, status: "failed", url: null, mode: null, error: action.message };
    case "playing":
      // ArtPlayer "video:play" fires after the media element starts; transition to playing.
      // ArtPlayer "video:play" 在媒体元素开始播放后触发; 转换到 playing.
      return { ...state, status: "playing", error: null };
    case "reset":
      return createInitialPlaybackState();
  }
}
