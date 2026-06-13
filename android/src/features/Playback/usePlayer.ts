// usePlayer — the playback hook owning reducer + detail load + URL resolution + line/source failover.
// PlayerScreen ref-binds to <Video /> while reading state/actions from this hook.
// usePlayer — 拥有 reducer、详情加载、URL 解析、线路/源 fallback 的播放 hook.
// PlayerScreen 通过 ref 绑定 <Video />, 状态与 action 都从该 hook 读取.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import type { DetailAPI } from "@/api/detail";
import type { PlaybackAPI } from "@/api/playback";
import type { PlayDestination, VideoDetail } from "@/api/types";
import {
  loadPlaybackSettings, savePlaybackSettings, type PlaybackSettings,
} from "@/storage/playbackSettings";
import { loadWatchHistory, recordPlayProgress } from "@/storage/watchHistory";

import { currentEpisode, episodes as selectEpisodes, sourceVideoID } from "./episodeSelection";
import {
  initialPlayerState, playerReducer, type PlayerAction, type PlayerState,
} from "./playerReducer";

const PROGRESS_SAVE_INTERVAL_S = 5;

/**
 * Pure helper: apply a sequence of actions and return the final state. The failover loop uses
 * this to compute the next state synchronously without waiting for React to commit dispatches.
 * 纯函数: 顺次应用一组 action 并返回最终 state. failover 循环用它同步推算下一步, 不依赖 React commit.
 */
function applyAll(state: PlayerState, actions: PlayerAction[]): PlayerState {
  return actions.reduce(playerReducer, state);
}

/**
 * Re-pick the episode index after a source switch by matching the previous episode name.
 * Mirrors iOS PlayerViewModel.matchEpisode: tries an exact name match first, then a numeric
 * substring match (so "Episode 03" still matches "Ep03" / "03"). Falls back to 0 when nothing fits.
 * 切源后按上一集名称重新定位剧集索引. 镜像 iOS PlayerViewModel.matchEpisode: 先尝试完整名称匹配,
 * 再做数字子串匹配 (让 "Episode 03" 与 "Ep03"/"03" 等价). 都不匹配时回退到 0.
 */
function matchEpisodeByName(state: PlayerState, prevName: string): number {
  if (!prevName) return 0;
  const list = selectEpisodes(state);
  if (list.length === 0) return 0;
  const exact = list.findIndex((e) => e.name === prevName);
  if (exact >= 0) return exact;
  const prevDigits = prevName.match(/\d+/)?.[0];
  if (!prevDigits) return 0;
  const byDigits = list.findIndex((e) => e.name.match(/\d+/)?.[0] === prevDigits);
  return byDigits >= 0 ? byDigits : 0;
}

/**
 * Inputs to usePlayer — everything wires through props so unit tests can substitute fakes.
 * usePlayer 的入参 — 一律通过 props 注入, 单测可替换为 fake.
 */
export interface UsePlayerOptions {
  serverURL: string;
  destination: PlayDestination;
  detailAPI: DetailAPI;
  playbackAPI: PlaybackAPI;
}

/**
 * Public surface returned by usePlayer. `playbackURL` is read from `state` so React re-renders
 * `<Video source={uri}/>` when the URL flips; `resumeStartSeconds` is the position to seek to on
 * the next `onLoad` (watch history + skipIntro merged).
 * usePlayer 对外返回的接口. `playbackURL` 直接从 state 取, 让 `<Video source={uri}/>` 在 URL 切换时
 * 重渲染. `resumeStartSeconds` 是下次 `onLoad` 后需要 seek 到的位置 (watchHistory + skipIntro 合并).
 */
export interface UsePlayerResult {
  state: PlayerState;
  /** Position in seconds to seek to on the next onLoad. 下次 onLoad 后需要 seek 到的秒数. */
  resumeStartSeconds: number;
  actions: {
    startPlayback: () => Promise<void>;
    switchSource: (sourceKey: string) => Promise<void>;
    switchLine: (index: number) => Promise<void>;
    switchEpisode: (index: number) => Promise<void>;
    setRate: (rate: number) => void;
    setSkipIntro: (seconds: number) => void;
    setSkipOutro: (seconds: number) => void;
    timeUpdate: (currentTime: number, duration: number) => void;
    setBuffering: (value: boolean) => void;
    setSeeking: (value: boolean) => void;
    setPlaying: (value: boolean) => void;
    onError: (message: string) => Promise<void>;
    persistProgressNow: (current?: number, total?: number) => void;
    /** Marks resume seek as consumed so subsequent onLoad events don't re-seek. 标记续播 seek 已消费. */
    markResumeConsumed: () => void;
  };
  /** Always-current PlayerState ref so async callbacks read the latest values. async 回调读取最新 state 的 ref. */
  stateRef: { current: PlayerState };
}

/**
 * usePlayer — the playback hook. Loads detail on mount, owns reducer + failover, and exposes
 * actions used by both PlayerScreen UI and the imperative <Video /> ref handlers.
 * usePlayer — 播放 hook. 挂载即加载详情, 维护 reducer + fallback, 暴露 PlayerScreen UI 与
 * imperative <Video /> 回调共用的 action.
 */
export function usePlayer({ serverURL, destination, detailAPI, playbackAPI }: UsePlayerOptions): UsePlayerResult {
  const [state, dispatch] = useReducer(
    playerReducer,
    initialPlayerState(
      destination.sources,
      destination.sourceKey,
      destination.videoId,
      destination.resumeIntent?.episodeIndex ?? 0,
    ),
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const lastSavedTimeRef = useRef(0);
  const resumeStartRef = useRef(0);
  // `resumeConsumed` is a state (not a ref) so flipping it re-renders the hook and the next read
  // of `resumeStartSeconds` sees 0. The flag never resets — once consumed, subsequent onLoad
  // events for the same screen lifetime stay consumed; new playback (switchLine/Episode/Source)
  // resets it back to false.
  // resumeConsumed 是 state (而非 ref), flip 时触发重渲染, 下次读 resumeStartSeconds 才能取到 0.
  // 一旦置 true 在屏幕生命周期内不重置; 切线路/剧集/源时显式置回 false.
  const [resumeConsumed, setResumeConsumed] = useState(false);

  // Seed skip-intro / skip-outro from MMKV, then compute resume position (watchHistory + skipIntro).
  // 由 MMKV 加载跳过设置, 再用 watchHistory + skipIntro 计算续播位置.
  useEffect(() => {
    const settings: PlaybackSettings = loadPlaybackSettings(serverURL, destination.title);
    dispatch({ type: "loadSkipSettings", settings });
    const history = loadWatchHistory(serverURL, 100);
    const saved = history.find((h) =>
      h.sourceKey === destination.sourceKey
      && h.videoId === destination.videoId
      && h.episodeIndex === (destination.resumeIntent?.episodeIndex ?? 0),
    );
    resumeStartRef.current = saved && saved.progress > 0 ? saved.progress : settings.skipIntroSeconds;
    lastSavedTimeRef.current = resumeStartRef.current;
    setResumeConsumed(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load detail on mount.
  // 挂载时加载详情.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const detail = await detailAPI.detail(destination.sourceKey, destination.videoId);
        if (cancelled) return;
        dispatch({ type: "detailLoaded", detail });
      } catch (err) {
        if (cancelled) return;
        dispatch({ type: "error", message: err instanceof Error ? err.message : "load failed" });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pure transition over (state, episode) → next state with either urlResolved or error.
  // 纯转换: (state, 当前剧集) 推出下一态, 含 urlResolved 或 error.
  const resolveForState = useCallback(
    async (input: PlayerState): Promise<PlayerState> => {
      const ep = currentEpisode(input);
      if (!ep) return playerReducer(input, { type: "error", message: "no episode" });
      try {
        const response = await playbackAPI.playbackURL(ep.url, input.currentSourceKey);
        return playerReducer(input, { type: "urlResolved", url: response.url });
      } catch (err) {
        return playerReducer(input, {
          type: "error",
          message: err instanceof Error ? err.message : "resolve failed",
        });
      }
    },
    [playbackAPI],
  );

  // Failover loop: try current selection, then remaining CDN lines, then remaining sources. All
  // intermediate state moves through pure playerReducer so no stale-state race is possible.
  // failover 循环: 先试当前选择, 再切线路, 再切源. 全部经 playerReducer 推进, 杜绝 stale state.
  const playFrom = useCallback(
    async (input: PlayerState): Promise<PlayerState> => {
      let next = await resolveForState(playerReducer(input, { type: "clearError" }));
      if (next.playbackURL) return next;

      const lineCount = next.detail?.episodes.length ?? 0;
      for (let line = next.currentLineIndex + 1; line < lineCount; line += 1) {
        const dead = (next.detail?.episodes[line]?.length ?? 0) === 0;
        if (dead) continue;
        next = await resolveForState(applyAll(next, [
          { type: "switchLine", index: line },
          { type: "clearError" },
        ]));
        if (next.playbackURL) return next;
      }

      let working = playerReducer(next, { type: "removeSource", sourceKey: next.currentSourceKey });
      while (working.sources.length > 0) {
        const fallback = working.sources[0];
        if (!fallback) break;
        try {
          const detail: VideoDetail = await detailAPI.detail(fallback.source_key, fallback.video_id);
          working = applyAll(working, [
            { type: "switchSource", sourceKey: fallback.source_key },
            { type: "detailLoaded", detail },
            { type: "clearError" },
          ]);
          const resolved = await resolveForState(working);
          if (resolved.playbackURL) return resolved;
          working = playerReducer(resolved, { type: "removeSource", sourceKey: fallback.source_key });
        } catch {
          working = playerReducer(working, { type: "removeSource", sourceKey: fallback.source_key });
        }
      }
      return playerReducer(working, { type: "error", message: "All sources failed" });
    },
    [detailAPI, resolveForState],
  );

  // Apply a computed final state by replaying field-level deltas via existing reducer actions.
  // Replay order: source → line → episode (switchLine resets episodeIndex to 0, so episode must
  // come last). Always dispatches urlResolved when after.playbackURL is non-null even if string
  // unchanged — bumps urlGeneration so `<Video key={urlGeneration}>` remounts on transient retry.
  // 将推算出的最终 state 通过现有 reducer action 回放到 React.
  // 回放顺序: 源 → 线路 → 剧集 (switchLine 会清零 episodeIndex, 因此 episode 放最后).
  // playbackURL 非空时总派发 urlResolved (即便字符串未变), bump urlGeneration 触发 <Video> 重挂.
  const commitFinalState = useCallback((before: PlayerState, after: PlayerState) => {
    if (after.currentSourceKey !== before.currentSourceKey) {
      dispatch({ type: "switchSource", sourceKey: after.currentSourceKey });
    }
    if (after.currentLineIndex !== before.currentLineIndex) {
      dispatch({ type: "switchLine", index: after.currentLineIndex });
    }
    if (after.currentEpisodeIndex !== before.currentEpisodeIndex
        || after.currentLineIndex !== before.currentLineIndex
        || after.currentSourceKey !== before.currentSourceKey) {
      dispatch({ type: "switchEpisode", index: after.currentEpisodeIndex });
    }
    if (after.detail !== before.detail && after.detail) {
      dispatch({ type: "detailLoaded", detail: after.detail });
    }
    const removedKeys = before.sources
      .map((s) => s.source_key)
      .filter((k) => !after.sources.some((s) => s.source_key === k));
    for (const key of removedKeys) dispatch({ type: "removeSource", sourceKey: key });
    if (after.playbackURL) {
      dispatch({ type: "urlResolved", url: after.playbackURL });
    } else if (before.playbackURL) {
      dispatch({ type: "urlCleared" });
    }
    if (after.errorMessage && after.errorMessage !== before.errorMessage) {
      dispatch({ type: "error", message: after.errorMessage });
    } else if (!after.errorMessage && before.errorMessage) {
      dispatch({ type: "clearError" });
    }
  }, []);

  const startPlayback = useCallback(async () => {
    const before = stateRef.current;
    const after = await playFrom(before);
    commitFinalState(before, after);
    setResumeConsumed(false);
  }, [commitFinalState, playFrom]);

  const onError = useCallback(async (message: string) => {
    const before = playerReducer(stateRef.current, { type: "error", message });
    const after = await playFrom(before);
    commitFinalState(stateRef.current, after);
  }, [commitFinalState, playFrom]);

  const markResumeConsumed = useCallback(() => { setResumeConsumed(true); }, []);

  const switchSource = useCallback(async (sourceKey: string) => {
    const source = stateRef.current.sources.find((s) => s.source_key === sourceKey);
    if (!source) return;
    const before = stateRef.current;
    // Remember the current episode name so we can re-pick by name after the new source's episode
    // list lands (iOS PlayerViewModel.matchEpisode). Numeric matching falls back to episodeIndex.
    // 记住当前剧集名称, 新源剧集到达后按名称重新定位 (镜像 iOS PlayerViewModel.matchEpisode). 数字命中
    // 不到时退回 episodeIndex.
    const prevEpisodeName = currentEpisode(before)?.name ?? "";
    try {
      const detail = await detailAPI.detail(sourceKey, source.video_id);
      const seededWithDetail = applyAll(before, [
        { type: "switchSource", sourceKey },
        { type: "detailLoaded", detail },
      ]);
      const matchedIndex = matchEpisodeByName(seededWithDetail, prevEpisodeName);
      const seed = applyAll(seededWithDetail, [
        { type: "switchEpisode", index: matchedIndex },
        { type: "urlCleared" },
        { type: "clearError" },
      ]);
      const after = await playFrom(seed);
      commitFinalState(before, after);
      setResumeConsumed(false);
    } catch (err) {
      dispatch({ type: "error", message: err instanceof Error ? err.message : "switch source failed" });
    }
  }, [commitFinalState, detailAPI, playFrom]);

  const switchLine = useCallback(async (index: number) => {
    const before = stateRef.current;
    const seed = applyAll(before, [
      { type: "switchLine", index },
      { type: "urlCleared" },
      { type: "clearError" },
    ]);
    const after = await playFrom(seed);
    commitFinalState(before, after);
    setResumeConsumed(false);
  }, [commitFinalState, playFrom]);

  const switchEpisode = useCallback(async (index: number) => {
    const before = stateRef.current;
    const seed = applyAll(before, [
      { type: "switchEpisode", index },
      { type: "urlCleared" },
      { type: "clearError" },
    ]);
    const after = await playFrom(seed);
    commitFinalState(before, after);
    setResumeConsumed(false);
  }, [commitFinalState, playFrom]);

  const setRate = useCallback((rate: number) => {
    dispatch({ type: "setRate", rate });
    savePlaybackSettings(serverURL, destination.title, {
      ...loadPlaybackSettings(serverURL, destination.title),
      playbackRate: rate,
    });
  }, [destination.title, serverURL]);

  const setSkipIntro = useCallback((seconds: number) => {
    dispatch({ type: "setSkipIntro", value: seconds });
    savePlaybackSettings(serverURL, destination.title, {
      ...loadPlaybackSettings(serverURL, destination.title),
      skipIntroSeconds: Math.max(0, Math.min(300, seconds)),
    });
  }, [destination.title, serverURL]);

  const setSkipOutro = useCallback((seconds: number) => {
    dispatch({ type: "setSkipOutro", value: seconds });
    savePlaybackSettings(serverURL, destination.title, {
      ...loadPlaybackSettings(serverURL, destination.title),
      skipOutroSeconds: Math.max(0, Math.min(300, seconds)),
    });
  }, [destination.title, serverURL]);

  // Persist progress using either the latest reducer state (parameterless call from unmount /
  // public action) OR an explicit time/duration pair passed by timeUpdate so we don't depend on
  // a not-yet-committed dispatch.
  // 持久化进度: 不带参数读 reducer 最新 state (卸载或外部调用); 带参数时直接使用 timeUpdate 传入
  // 的 currentTime / duration, 避免依赖尚未 commit 的 dispatch.
  const persistProgressNow = useCallback((current?: number, total?: number) => {
    const ep = currentEpisode(stateRef.current);
    const videoId = sourceVideoID(stateRef.current);
    if (!ep || !videoId) return;
    const { detail, currentSourceKey, currentEpisodeIndex } = stateRef.current;
    const currentTime = current ?? stateRef.current.currentTime;
    const duration = total ?? stateRef.current.duration;
    if (currentTime <= 0 || !Number.isFinite(duration)) return;
    recordPlayProgress(serverURL, {
      id: `${currentSourceKey}:${videoId}:${currentEpisodeIndex}`,
      sourceKey: currentSourceKey,
      videoId,
      title: detail?.title ?? destination.title,
      cover: detail?.cover ?? destination.coverHint ?? "",
      episode: ep.name,
      episodeIndex: currentEpisodeIndex,
      progress: currentTime,
      duration,
    });
    lastSavedTimeRef.current = currentTime;
  }, [destination.coverHint, destination.title, serverURL]);

  const timeUpdate = useCallback((currentTime: number, duration: number) => {
    dispatch({ type: "timeUpdate", currentTime, duration });
    if (Math.abs(currentTime - lastSavedTimeRef.current) >= PROGRESS_SAVE_INTERVAL_S) {
      persistProgressNow(currentTime, duration);
    }
    const { skipOutroSeconds, currentEpisodeIndex } = stateRef.current;
    const list = selectEpisodes(stateRef.current);
    if (skipOutroSeconds > 0 && duration > 0) {
      const remaining = duration - currentTime;
      if (remaining > 0 && remaining <= skipOutroSeconds && currentEpisodeIndex < list.length - 1) {
        void switchEpisode(currentEpisodeIndex + 1);
      }
    }
  }, [persistProgressNow, switchEpisode]);

  const setBuffering = useCallback((value: boolean) => dispatch({ type: "setBuffering", value }), []);
  const setSeeking = useCallback((value: boolean) => dispatch({ type: "setSeeking", value }), []);
  const setPlaying = useCallback((value: boolean) => dispatch({ type: "playState", value }), []);

  const actions = useMemo(() => ({
    startPlayback, switchSource, switchLine, switchEpisode,
    setRate, setSkipIntro, setSkipOutro, timeUpdate, setBuffering, setSeeking, setPlaying,
    onError, persistProgressNow, markResumeConsumed,
  }), [startPlayback, switchSource, switchLine, switchEpisode, setRate, setSkipIntro, setSkipOutro, timeUpdate, setBuffering, setSeeking, setPlaying, onError, persistProgressNow, markResumeConsumed]);

  return {
    state,
    resumeStartSeconds: resumeConsumed ? 0 : resumeStartRef.current,
    actions,
    stateRef,
  };
}
