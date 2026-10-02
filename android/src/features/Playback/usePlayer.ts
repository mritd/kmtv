// usePlayer — the playback hook owning reducer + detail load + URL resolution + line/source failover.
// PlayerScreen ref-binds to <Video /> while reading state/actions from this hook.
//
// usePlayer — 拥有 reducer、详情加载、URL 解析、线路/源 fallback 的播放 hook.
// PlayerScreen 通过 ref 绑定 <Video />, 状态与 action 都从该 hook 读取.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import type { DetailAPI } from "@/api/detail";
import type { PlaybackAPI } from "@/api/playback";
import type { PlayDestination, VideoDetail } from "@/api/types";
import { loadPlaybackSettings, savePlaybackSettings } from "@/storage/playbackSettings";
import type { WatchPayload } from "@/sync/types";
import type { WatchResume } from "@/sync/useWatchResume";

import { currentEpisode, episodes as selectEpisodes, sourceVideoID } from "./episodeSelection";
import {
  initialPlayerState, playerReducer, shouldIgnoreProgressDuringPendingSeek, type PlayerAction, type PlayerState,
} from "./playerReducer";

const PROGRESS_SAVE_INTERVAL_S = 5;
const END_ADVANCE_EPSILON_S = 0.75;

/**
 * Pure helper: apply a sequence of actions and return the final state. The failover loop uses
 * this to compute the next state synchronously without waiting for React to commit dispatches.
 *
 * 纯函数: 顺次应用一组 action 并返回最终 state. failover 循环用它同步推算下一步, 不依赖 React commit.
 */
function applyAll(state: PlayerState, actions: PlayerAction[]): PlayerState {
  return actions.reduce(playerReducer, state);
}

/**
 * Re-pick the episode index after a source switch by matching the previous episode name.
 * Mirrors iOS PlayerViewModel.matchEpisode: tries an exact name match first, then a numeric
 * substring match (so "Episode 03" still matches "Ep03" / "03"). Falls back to 0 when nothing fits.
 *
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

const NO_RESUME: WatchResume = { pending: false, item: null };

/**
 * Inputs to usePlayer — everything wires through props so unit tests can substitute fakes.
 * `resume` comes from useWatchResume; `saveWatch` writes checkpoints into the sync store, and
 * `flushWatch` pushes them after the outgoing episode is saved on a source, line, or episode switch.
 *
 * usePlayer 的入参 — 一律通过 props 注入, 单测可替换为 fake.
 * resume 来自 useWatchResume; saveWatch 将播放进度写入同步存储; 切换来源, 线路或剧集时保存
 * 即将离开的剧集后, 由 flushWatch 推送.
 */
export interface UsePlayerOptions {
  serverURL: string;
  destination: PlayDestination;
  detailAPI: DetailAPI;
  playbackAPI: PlaybackAPI;
  resume?: WatchResume;
  saveWatch?: (payload: WatchPayload) => void;
  flushWatch?: () => void;
}

/**
 * Public surface returned by usePlayer. `playbackURL` is read from `state` so React re-renders
 * `<Video source={uri}/>` when the URL flips; `resumeStartSeconds` is the position to seek to on
 * the next `onLoad` (watch record + skipIntro merged).
 *
 * usePlayer 对外返回的接口. `playbackURL` 直接从 state 取, 让 `<Video source={uri}/>` 在 URL 切换时
 * 重渲染. `resumeStartSeconds` 是下次 `onLoad` 后需要 seek 到的位置 (观看记录 + skipIntro 合并).
 */
export interface UsePlayerResult {
	state: PlayerState;
  /**
   * True once the watch record gate has opened, after a sync or its timeout, so playback can initialize once.
   *
   * 观看记录等待结束 (同步完成或超时) 后为 true, 此时播放才初始化一次.
   */
	historyReady: boolean;
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
    commitSeek: (currentTime: number, duration?: number) => void;
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
 *
 * usePlayer — 播放 hook. 挂载即加载详情, 维护 reducer + fallback, 暴露 PlayerScreen UI 与
 * imperative <Video /> 回调共用的 action.
 */
export function usePlayer({ serverURL, destination, detailAPI, playbackAPI, resume = NO_RESUME, saveWatch, flushWatch }: UsePlayerOptions): UsePlayerResult {
  const [state, dispatch] = useReducer(
    playerReducer,
    initialPlayerState(
      destination.sources,
		destination.sourceKey,
		destination.videoId,
		destination.resumeIntent?.episodeIndex ?? 0,
		destination.resumeIntent?.groupIndex ?? 0,
	),
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const lastSavedTimeRef = useRef(0);
  // lastCheckpointRef identifies the last checkpoint handed to saveWatch. A paused player that
  // reports the same position again must not give old progress a newer event time.
  //
  // lastCheckpointRef 标识最近一次交给 saveWatch 的进度. 暂停的播放器重复报告同一位置时,
  // 不能给旧进度新的事件时间.
  const lastCheckpointRef = useRef("");
  const autoAdvanceKeyRef = useRef<string | null>(null);
  const autoAdvanceBlockedRef = useRef(false);
  const resumeStartRef = useRef(0);
  // `resumeConsumed` is a state (not a ref) so flipping it re-renders the hook and the next read
  // of `resumeStartSeconds` sees 0. The flag never resets — once consumed, subsequent onLoad
  // events for the same screen lifetime stay consumed; new playback (switchLine/Episode/Source)
  // resets it back to false.
  //
  // resumeConsumed 是 state (而非 ref), flip 时触发重渲染, 下次读 resumeStartSeconds 才能取到 0.
  // 一旦置 true 在屏幕生命周期内不重置; 切线路/剧集/源时显式置回 false.
	const [resumeConsumed, setResumeConsumed] = useState(false);
  const [historyReady, setHistoryReady] = useState(false);
  const resumeAppliedRef = useRef(false);
  const watchItemRef = useRef(resume.item);
  watchItemRef.current = resume.item;

  // The watch record holds one position per title; it applies only to the exact source, line,
  // and episode it was saved for.
  //
  // 观看记录每个标题只保存一个位置; 只有来源, 线路和剧集完全一致时才使用.
  const resumeStartFor = useCallback((input: PlayerState, episodeIndex = input.currentEpisodeIndex): number => {
    const item = watchItemRef.current;
    const matches = item !== null
      && !item.completed
      && item.source_key === input.currentSourceKey
      && item.video_id === sourceVideoID(input)
      && item.group_index === input.currentLineIndex
      && item.episode_index === episodeIndex;
    return matches && item.progress_sec > 0 ? item.progress_sec : input.skipIntroSeconds;
  }, []);

  const setResumeStartFor = useCallback((input: PlayerState, episodeIndex = input.currentEpisodeIndex) => {
    const nextResumeStart = resumeStartFor(input, episodeIndex);
    resumeStartRef.current = nextResumeStart;
    lastSavedTimeRef.current = nextResumeStart;
    setResumeConsumed(false);
  }, [resumeStartFor]);

  // Seed skip-intro / skip-outro from MMKV.
  //
  // 由 MMKV 加载跳过片头片尾设置.
  useEffect(() => {
    dispatch({ type: "loadSkipSettings", settings: loadPlaybackSettings(serverURL, destination.title) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once the watch record gate opens, select the record's line and episode on the open source,
  // whatever source the record was written on; detailLoaded clamps them to what that source has.
  // A completed record selects nothing. Runs once per screen.
  //
  // 观看记录等待结束后, 在当前来源上选中记录的线路和剧集, 不论记录来自哪个来源; detailLoaded 会
  // 把它们限制在该来源实际拥有的范围内. 已完成的记录不做选择. 每个屏幕只执行一次.
  useEffect(() => {
    if (resumeAppliedRef.current || resume.pending) return;
    resumeAppliedRef.current = true;
    const item = resume.item;
    if (item && !item.completed) {
      dispatch({ type: "switchLine", index: item.group_index });
      dispatch({ type: "switchEpisode", index: item.episode_index });
    }
    setHistoryReady(true);
  }, [resume.item, resume.pending]);

	// Load detail only after the watch record gate has opened and chosen the initial line/episode.
	//
	// 等观看记录确定初始线路与分集后再加载详情.
	useEffect(() => {
		if (!historyReady) return;
		let cancelled = false;
		void (async () => {
			try {
				const sourceKey = stateRef.current.currentSourceKey;
				const videoId = sourceVideoID(stateRef.current) || destination.videoId;
				const detail = await detailAPI.detail(sourceKey, videoId);
        if (cancelled) return;
        dispatch({ type: "detailLoaded", detail });
        // The indices are final only after detailLoaded clamps them, so match the resume position now.
        //
        // 索引在 detailLoaded 限制范围后才最终确定, 因此此时再匹配续播位置.
        setResumeStartFor(playerReducer(stateRef.current, { type: "detailLoaded", detail }));
      } catch (err) {
        if (cancelled) return;
        dispatch({ type: "error", message: err instanceof Error ? err.message : "load failed" });
      }
    })();
    return () => { cancelled = true; };
	}, [destination.videoId, detailAPI, historyReady, setResumeStartFor]);

  // Pure transition over (state, episode) → next state with either urlResolved or error.
  //
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
  //
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
  //
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
    // A startup fallback to another source, line, or episode matches the resume position again,
    // so the record's position applies only to the exact episode it was saved for.
    //
    // 起播时回退到其他来源, 线路或剧集后重新匹配续播位置, 记录的位置只用于保存它的那一集.
    if (after.currentSourceKey !== before.currentSourceKey
        || after.currentLineIndex !== before.currentLineIndex
        || after.currentEpisodeIndex !== before.currentEpisodeIndex) {
      setResumeStartFor(after);
    } else {
      setResumeConsumed(false);
    }
  }, [commitFinalState, playFrom, setResumeStartFor]);

  const onError = useCallback(async (message: string) => {
    const before = playerReducer(stateRef.current, { type: "error", message });
    const after = await playFrom(before);
    commitFinalState(stateRef.current, after);
  }, [commitFinalState, playFrom]);

  const markResumeConsumed = useCallback(() => { setResumeConsumed(true); }, []);

  // Persist progress using either the latest reducer state (parameterless call from unmount /
  // public action) OR an explicit time/duration pair passed by timeUpdate so we don't depend on
  // a not-yet-committed dispatch.
  //
  // 持久化进度: 不带参数读 reducer 最新 state (卸载或外部调用); 带参数时直接使用 timeUpdate 传入
  // 的 currentTime / duration, 避免依赖尚未 commit 的 dispatch.
  const persistProgressNow = useCallback((current?: number, total?: number) => {
    const ep = currentEpisode(stateRef.current);
    const videoId = sourceVideoID(stateRef.current);
    if (!ep || !videoId) return;
    const { detail, currentSourceKey, currentEpisodeIndex } = stateRef.current;
    const currentTime = current ?? stateRef.current.currentTime;
    const duration = total ?? stateRef.current.duration;
    if (!Number.isFinite(currentTime) || currentTime <= 0 || !Number.isFinite(duration)) return;
    lastSavedTimeRef.current = currentTime;
    const checkpoint = [currentSourceKey, videoId, stateRef.current.currentLineIndex, currentEpisodeIndex, Math.floor(currentTime)].join("|");
    if (checkpoint === lastCheckpointRef.current) return;
    lastCheckpointRef.current = checkpoint;
    const list = selectEpisodes(stateRef.current);
    const completed = currentEpisodeIndex === list.length - 1
      && duration > 0
      && (duration - currentTime <= 30 || currentTime / duration >= 0.95);
    saveWatch?.({
      title: detail?.title ?? destination.title,
      cover: detail?.cover ?? destination.coverHint ?? "",
      source_key: currentSourceKey,
      video_id: videoId,
      episode: ep.name,
      group_index: stateRef.current.currentLineIndex,
      episode_index: currentEpisodeIndex,
      progress_sec: currentTime,
      duration_sec: duration,
      completed,
    });
  }, [destination.coverHint, destination.title, saveWatch]);

  // checkpointOutgoing saves the episode being left and pushes it before a source, line, or
  // episode switch, so another device resumes from the latest position.
  //
  // checkpointOutgoing 在切换来源, 线路或剧集前保存即将离开的剧集并推送, 让其他设备从最新位置继续.
  const checkpointOutgoing = useCallback(() => {
    persistProgressNow();
    flushWatch?.();
  }, [flushWatch, persistProgressNow]);

  const switchSource = useCallback(async (sourceKey: string) => {
    const source = stateRef.current.sources.find((s) => s.source_key === sourceKey);
    if (!source) return;
    checkpointOutgoing();
    const before = stateRef.current;
    // Remember the current episode name so we can re-pick by name after the new source's episode
    // list lands (iOS PlayerViewModel.matchEpisode). Numeric matching falls back to episodeIndex.
    //
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
      autoAdvanceBlockedRef.current = false;
      setResumeStartFor(seed);
      const after = await playFrom(seed);
      commitFinalState(before, after);
    } catch (err) {
      dispatch({ type: "error", message: err instanceof Error ? err.message : "switch source failed" });
    }
  }, [checkpointOutgoing, commitFinalState, detailAPI, playFrom, setResumeStartFor]);

  const switchLine = useCallback(async (index: number) => {
    checkpointOutgoing();
    const before = stateRef.current;
    const seed = applyAll(before, [
      { type: "switchLine", index },
      { type: "urlCleared" },
      { type: "clearError" },
    ]);
    autoAdvanceBlockedRef.current = false;
    setResumeStartFor(seed);
    const after = await playFrom(seed);
    commitFinalState(before, after);
  }, [checkpointOutgoing, commitFinalState, playFrom, setResumeStartFor]);

  const switchEpisode = useCallback(async (index: number) => {
    // Past the last episode nothing is left to play: save the finished episode and stop. Falling
    // back to another line or source would replay content and overwrite the completed record.
    //
    // 超过最后一集时已没有可播放的内容: 保存已看完的剧集并停止. 回退到其他线路或来源会重播
    // 内容, 并覆盖已完成的记录.
    if (index >= selectEpisodes(stateRef.current).length) {
      checkpointOutgoing();
      dispatch({ type: "playState", value: false });
      return;
    }
    checkpointOutgoing();
    const before = stateRef.current;
    const seed = applyAll(before, [
      { type: "switchEpisode", index },
      { type: "urlCleared" },
      { type: "clearError" },
    ]);
    setResumeStartFor(seed);
    const after = await playFrom(seed);
    commitFinalState(before, after);
  }, [checkpointOutgoing, commitFinalState, playFrom, setResumeStartFor]);

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

  const timeUpdate = useCallback((currentTime: number, duration: number) => {
    const ignoreProgress = shouldIgnoreProgressDuringPendingSeek(stateRef.current, currentTime);
    dispatch({ type: "timeUpdate", currentTime, duration });
    if (ignoreProgress) return;
    if (Math.abs(currentTime - lastSavedTimeRef.current) >= PROGRESS_SAVE_INTERVAL_S) {
      persistProgressNow(currentTime, duration);
    }
    const { currentSourceKey, currentLineIndex, skipOutroSeconds, currentEpisodeIndex, isSeeking } = stateRef.current;
    const list = selectEpisodes(stateRef.current);
    if (autoAdvanceBlockedRef.current) {
      const awayFromEnd = duration <= 0 || duration - currentTime > END_ADVANCE_EPSILON_S;
      if (awayFromEnd) {
        autoAdvanceBlockedRef.current = false;
      } else {
        return;
      }
    }
    if (duration > 0 && !isSeeking && currentEpisodeIndex < list.length - 1) {
      const remaining = duration - currentTime;
      const shouldSkipOutro = skipOutroSeconds > 0 && remaining > 0 && remaining <= skipOutroSeconds;
      const reachedEnd = remaining >= 0 && remaining <= END_ADVANCE_EPSILON_S;
      const advanceKey = `${currentSourceKey}:${currentLineIndex}:${currentEpisodeIndex}`;
      if ((shouldSkipOutro || reachedEnd) && autoAdvanceKeyRef.current !== advanceKey) {
        autoAdvanceKeyRef.current = advanceKey;
        autoAdvanceBlockedRef.current = true;
        void switchEpisode(currentEpisodeIndex + 1);
      }
    }
  }, [persistProgressNow, switchEpisode]);

  const commitSeek = useCallback((currentTime: number, duration?: number) => {
    const total = duration ?? stateRef.current.duration;
    const target = total > 0 ? Math.min(Math.max(0, currentTime), total) : Math.max(0, currentTime);
    dispatch({ type: "commitSeek", currentTime: target, duration: total });
    persistProgressNow(target, total);
  }, [persistProgressNow]);

  const setBuffering = useCallback((value: boolean) => dispatch({ type: "setBuffering", value }), []);
  const setSeeking = useCallback((value: boolean) => dispatch({ type: "setSeeking", value }), []);
  const setPlaying = useCallback((value: boolean) => dispatch({ type: "playState", value }), []);

  const actions = useMemo(() => ({
    startPlayback, switchSource, switchLine, switchEpisode,
    setRate, setSkipIntro, setSkipOutro, timeUpdate, commitSeek, setBuffering, setSeeking, setPlaying,
    onError, persistProgressNow, markResumeConsumed,
  }), [startPlayback, switchSource, switchLine, switchEpisode, setRate, setSkipIntro, setSkipOutro, timeUpdate, commitSeek, setBuffering, setSeeking, setPlaying, onError, persistProgressNow, markResumeConsumed]);

	return {
		state,
		historyReady,
    resumeStartSeconds: resumeConsumed ? 0 : resumeStartRef.current,
    actions,
    stateRef,
  };
}
