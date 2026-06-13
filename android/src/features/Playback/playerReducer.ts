// Pure reducer for the playback state machine. No RN, no react-native-video, no async.
// 播放状态机的纯 reducer. 不依赖 RN, 不依赖 react-native-video, 也不涉及异步.

import type { SourceResult, VideoDetail } from "@/api/types";
import type { PlaybackSettings } from "@/storage/playbackSettings";

import { episodes as selectEpisodes } from "./episodeSelection";

const MAX_SKIP_SECONDS = 300;
const MIN_RATE = 0.5;
const MAX_RATE = 4;

/**
 * Player state machine state — owned by usePlayer + driven through playerReducer.
 *
 * `playbackURL` is the currently-resolved playable URL (null until the first /playback/url
 * roundtrip lands). It lives in reducer state — NOT in a ref — so `<Video source={uri}/>` re-renders
 * when the URL flips. `urlGeneration` is bumped on every `urlResolved` so we can force a fresh
 * mount when the same URL is re-issued (e.g. retry after a transient HLS hiccup).
 *
 * 播放状态机的 state, 由 usePlayer 持有并通过 playerReducer 推动.
 *
 * playbackURL 为当前解析出的可播放 URL (首次 /playback/url 返回前为 null). 放在 reducer state 中
 * (而非 ref) 让 `<Video source={uri}/>` 能正常重渲染. urlGeneration 每次 urlResolved 自增, 在 URL
 * 不变但需要强制重挂 (例如 HLS 抖动重试) 时使用.
 */
export interface PlayerState {
  detail: VideoDetail | null;
  sources: SourceResult[];
  currentSourceKey: string;
  currentLineIndex: number;
  currentEpisodeIndex: number;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  isBuffering: boolean;
  isSeeking: boolean;
  playbackRate: number;
  skipIntroSeconds: number;
  skipOutroSeconds: number;
  errorMessage: string;
  playbackURL: string | null;
  urlGeneration: number;
}

/**
 * Build the initial reducer state from a navigation destination. When `sources` is empty (e.g.
 * the user came from continue-watching where MMKV only stores sourceKey + videoId), we seed a
 * placeholder source so episode selection has something to anchor to until detailLoaded arrives.
 * The placeholder uses `sourceKey` as both key and human name; once detailLoaded fires it gets
 * swapped via the usual reducer transitions.
 * 由导航目标构造 reducer 初始 state. 当 `sources` 为空 (例如从继续观看进入, MMKV 仅持有 sourceKey
 * 与 videoId), 用占位 source 让剧集选择器在 detailLoaded 到达前有锚点. 占位 source_key 与
 * source_name 都用 sourceKey, detailLoaded 后由常规 reducer 转换替换为真实数据.
 */
export function initialPlayerState(
  sources: SourceResult[],
  sourceKey: string,
  videoId: string,
  episodeIndex: number,
): PlayerState {
  const seeded = sources.length > 0
    ? sources
    : [{ source_key: sourceKey, source_name: sourceKey, is_adult: false, video_id: videoId, duration_ms: 0, episodes: [] }];
  return {
    detail: null,
    sources: seeded,
    currentSourceKey: sourceKey,
    currentLineIndex: 0,
    currentEpisodeIndex: Math.max(0, episodeIndex),
    currentTime: 0,
    duration: 0,
    isPlaying: false,
    isBuffering: false,
    isSeeking: false,
    playbackRate: 1,
    skipIntroSeconds: 0,
    skipOutroSeconds: 0,
    errorMessage: "",
    playbackURL: null,
    urlGeneration: 0,
  };
}

/**
 * Reducer action union — closed so unit tests can exhaustively check every transition.
 * Reducer action 联合类型, 封闭便于单测对每个迁移做穷尽校验.
 */
export type PlayerAction =
  | { type: "detailLoaded"; detail: VideoDetail }
  | { type: "switchEpisode"; index: number }
  | { type: "switchLine"; index: number }
  | { type: "switchSource"; sourceKey: string }
  | { type: "removeSource"; sourceKey: string }
  | { type: "timeUpdate"; currentTime: number; duration: number }
  | { type: "setBuffering"; value: boolean }
  | { type: "setSeeking"; value: boolean }
  | { type: "playState"; value: boolean }
  | { type: "error"; message: string }
  | { type: "clearError" }
  | { type: "loadSkipSettings"; settings: PlaybackSettings }
  | { type: "setSkipIntro"; value: number }
  | { type: "setSkipOutro"; value: number }
  | { type: "setRate"; rate: number }
  | { type: "urlResolved"; url: string }
  | { type: "urlCleared" };

function clampEpisodeIndex(state: PlayerState, detail: VideoDetail): number {
  const next = { ...state, detail };
  const list = selectEpisodes(next);
  if (list.length === 0) return 0;
  return Math.min(Math.max(0, state.currentEpisodeIndex), list.length - 1);
}

/**
 * Pure state transition — never throws, never mutates the input state.
 * 纯状态迁移, 不抛错, 不修改输入 state.
 */
export function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  switch (action.type) {
    case "detailLoaded":
      return { ...state, detail: action.detail, currentEpisodeIndex: clampEpisodeIndex(state, action.detail) };
    case "switchEpisode":
      return { ...state, currentEpisodeIndex: Math.max(0, action.index) };
    case "switchLine":
      return { ...state, currentLineIndex: Math.max(0, action.index), currentEpisodeIndex: 0 };
    case "switchSource":
      return { ...state, currentSourceKey: action.sourceKey, currentLineIndex: 0 };
    case "removeSource":
      return { ...state, sources: state.sources.filter((s) => s.source_key !== action.sourceKey) };
    case "timeUpdate":
      return {
        ...state,
        currentTime: state.isSeeking ? state.currentTime : action.currentTime,
        duration: action.duration,
      };
    case "setBuffering":
      return { ...state, isBuffering: action.value };
    case "setSeeking":
      return { ...state, isSeeking: action.value };
    case "playState":
      return { ...state, isPlaying: action.value };
    case "error":
      // Clear playbackURL on error so the failover loop's early-return guard (`next.playbackURL`)
      // doesn't short-circuit on a stale URL when the same source is retried.
      // 错误时清空 playbackURL, 避免 failover 提前返回卡在已坏的 URL.
      return { ...state, errorMessage: action.message, isBuffering: false, playbackURL: null };
    case "clearError":
      return { ...state, errorMessage: "" };
    case "loadSkipSettings":
      return {
        ...state,
        skipIntroSeconds: action.settings.skipIntroSeconds,
        skipOutroSeconds: action.settings.skipOutroSeconds,
        playbackRate: action.settings.playbackRate,
      };
    case "setSkipIntro":
      return { ...state, skipIntroSeconds: Math.max(0, Math.min(MAX_SKIP_SECONDS, action.value)) };
    case "setSkipOutro":
      return { ...state, skipOutroSeconds: Math.max(0, Math.min(MAX_SKIP_SECONDS, action.value)) };
    case "setRate":
      return { ...state, playbackRate: Math.max(MIN_RATE, Math.min(MAX_RATE, action.rate)) };
    case "urlResolved":
      return { ...state, playbackURL: action.url, urlGeneration: state.urlGeneration + 1, errorMessage: "" };
    case "urlCleared":
      return { ...state, playbackURL: null };
    default:
      return state;
  }
}
