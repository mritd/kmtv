// usePlayer tests — detail load, URL resolve, line failover, rate + progress wires.
//
// usePlayer 测试 — 详情加载、URL 解析、线路 failover、倍速与进度写入.

import { act, renderHook, waitFor } from "@testing-library/react-native";
import React from "react";

import type { DetailAPI } from "@/api/detail";
import type { PlaybackAPI } from "@/api/playback";
import type { PlayDestination, SourceResult, VideoDetail } from "@/api/types";
import { savePlaybackSettings } from "@/storage/playbackSettings";
import type { WatchPayload } from "@/sync/types";

import { usePlayer } from "./usePlayer";

const src = (k: string): SourceResult => ({
  source_key: k, source_name: `n-${k}`, is_adult: false, video_id: `v-${k}`,
  duration_ms: 0, episodes: [],
});
const detail: VideoDetail = {
  id: "1", title: "T", type: "Movie", year: "2024", cover: "", desc: "",
  director: "", actor: "", area: "",
  episodes: [[{ name: "E1", url: "raw://e1" }, { name: "E2", url: "raw://e2" }]],
};

function mkAPIs(over: { detail?: Partial<DetailAPI>; playback?: Partial<PlaybackAPI> } = {}) {
  return {
    detail: { detail: jest.fn().mockResolvedValue(detail), ...over.detail } as DetailAPI,
    playback: { playbackURL: jest.fn().mockResolvedValue({ mode: "proxy", url: "https://p/m3u8?mt=t" }), ...over.playback } as PlaybackAPI,
  };
}

function watchRecord(over: Partial<WatchPayload> = {}): WatchPayload {
  return {
    title: "T", cover: "", source_key: "a", video_id: "v-a", episode: "E1", group_index: 0,
    episode_index: 0, progress_sec: 95, duration_sec: 100, completed: false, ...over,
  };
}

const dest: PlayDestination = {
  title: "T", sources: [src("a")], sourceKey: "a", videoId: "v-a", coverHint: "",
};

test("loadDetail then startPlayback resolves URL via playbackAPI and stores it in state", async () => {
  const apis = mkAPIs();
  const { result } = renderHook(() =>
    usePlayer({ serverURL: "http://srv-a-start", destination: dest, detailAPI: apis.detail, playbackAPI: apis.playback }),
  );

  await waitFor(() => expect(result.current.state.detail).not.toBeNull());

  await act(async () => { await result.current.actions.startPlayback(); });

  expect(apis.detail.detail).toHaveBeenCalledWith("a", "v-a");
  expect(apis.playback.playbackURL).toHaveBeenCalledWith("raw://e1", "a");
  expect(result.current.state.errorMessage).toBe("");
  expect(result.current.state.playbackURL).toBe("https://p/m3u8?mt=t");
  expect(result.current.state.urlGeneration).toBeGreaterThan(0);
});

test("playbackURL failure on line 0 promotes to line 1 via pure failover", async () => {
  const apis = mkAPIs();
  apis.detail.detail = jest.fn().mockResolvedValue({
    ...detail, episodes: [[{ name: "E1", url: "raw://l1e1" }], [{ name: "E1", url: "raw://l2e1" }]],
  });
  apis.playback.playbackURL = jest.fn()
    .mockRejectedValueOnce(new Error("boom"))
    .mockResolvedValueOnce({ mode: "direct", url: "https://ok/m3u8" });

  const { result } = renderHook(() =>
    usePlayer({ serverURL: "http://srv-a-fail", destination: dest, detailAPI: apis.detail, playbackAPI: apis.playback }),
  );
  await waitFor(() => expect(result.current.state.detail).not.toBeNull());
  await act(async () => { await result.current.actions.startPlayback(); });

  expect(result.current.state.currentLineIndex).toBe(1);
  expect(result.current.state.playbackURL).toBe("https://ok/m3u8");
  expect(apis.playback.playbackURL).toHaveBeenCalledTimes(2);
});

test("setRate stores rate and timeUpdate routes through reducer", async () => {
  const apis = mkAPIs();
  const { result } = renderHook(() =>
    usePlayer({ serverURL: "http://srv-a-rate", destination: dest, detailAPI: apis.detail, playbackAPI: apis.playback }),
  );
  // Wait for detailLoaded so the hook is in its final mounted state.
  //
  // 等待详情加载完成, 让 hook 处于稳定状态.
  await waitFor(() => expect(result.current.state.detail).not.toBeNull());
  act(() => { result.current.actions.setRate(1.5); });
  expect(result.current.state.playbackRate).toBe(1.5);

  act(() => { result.current.actions.timeUpdate(12, 100); });
  expect(result.current.state.currentTime).toBe(12);
  expect(result.current.state.duration).toBe(100);
});

test("persistProgressNow hands a full watch checkpoint to saveWatch", async () => {
  const apis = mkAPIs();
  const saveWatch = jest.fn();
  const { result } = renderHook(() =>
    usePlayer({ serverURL: "http://srv-persist", destination: dest, detailAPI: apis.detail, playbackAPI: apis.playback, saveWatch }),
  );
  await waitFor(() => expect(result.current.state.detail).not.toBeNull());
  act(() => { result.current.actions.timeUpdate(42, 100); });
  act(() => { result.current.actions.persistProgressNow(); });
  expect(saveWatch).toHaveBeenLastCalledWith({
    title: "T", cover: "", source_key: "a", video_id: "v-a", episode: "E1", group_index: 0,
    episode_index: 0, progress_sec: 42, duration_sec: 100, completed: false,
  });
});

test("persistProgressNow skips a checkpoint that did not move", async () => {
  const apis = mkAPIs();
  const saveWatch = jest.fn();
  const { result } = renderHook(() =>
    usePlayer({ serverURL: "http://srv-dedupe", destination: dest, detailAPI: apis.detail, playbackAPI: apis.playback, saveWatch }),
  );
  await waitFor(() => expect(result.current.state.detail).not.toBeNull());
  act(() => { result.current.actions.timeUpdate(42, 100); });
  act(() => { result.current.actions.persistProgressNow(); });
  act(() => { result.current.actions.persistProgressNow(); });
  expect(saveWatch).toHaveBeenCalledTimes(1);
  act(() => { result.current.actions.timeUpdate(43, 100); });
  act(() => { result.current.actions.persistProgressNow(); });
  expect(saveWatch).toHaveBeenCalledTimes(2);
  expect(saveWatch).toHaveBeenLastCalledWith(expect.objectContaining({ progress_sec: 43 }));
});

test("commitSeek keeps the target time stable while stale native progress arrives", async () => {
  const apis = mkAPIs();
  const { result } = renderHook(() =>
    usePlayer({ serverURL: "http://srv-seek", destination: dest, detailAPI: apis.detail, playbackAPI: apis.playback }),
  );
  await waitFor(() => expect(result.current.state.detail).not.toBeNull());
  act(() => { result.current.actions.timeUpdate(10, 100); });
  act(() => { result.current.actions.setSeeking(true); });
  act(() => { result.current.actions.commitSeek(80, 100); });
  expect(result.current.state.currentTime).toBe(80);

  act(() => { result.current.actions.timeUpdate(11, 100); });
  expect(result.current.state.currentTime).toBe(80);

  act(() => { result.current.actions.timeUpdate(80.4, 100); });
  expect(result.current.state.currentTime).toBe(80.4);
});

test("switchSource loads new detail and starts playback on the new source", async () => {
  const multiSrcDest: PlayDestination = {
    title: "T2", sources: [src("a"), src("b")], sourceKey: "a", videoId: "v-a", coverHint: "",
  };
  const apis = mkAPIs();
  apis.detail.detail = jest.fn()
    .mockResolvedValueOnce(detail) // initial mount: "a"
    .mockResolvedValueOnce({ ...detail, title: "T-from-b" }); // switchSource
  const { result } = renderHook(() =>
    usePlayer({ serverURL: "http://srv-switch", destination: multiSrcDest, detailAPI: apis.detail, playbackAPI: apis.playback }),
  );
  await waitFor(() => expect(result.current.state.detail).not.toBeNull());
  await act(async () => { await result.current.actions.switchSource("b"); });
  expect(result.current.state.currentSourceKey).toBe("b");
  expect(result.current.state.detail?.title).toBe("T-from-b");
});

test("switchLine then switchEpisode update reducer state and resolve a URL", async () => {
  const apis = mkAPIs();
  apis.detail.detail = jest.fn().mockResolvedValue({
    ...detail,
    episodes: [
      [{ name: "L1E1", url: "raw://l1e1" }, { name: "L1E2", url: "raw://l1e2" }],
      [{ name: "L2E1", url: "raw://l2e1" }],
    ],
  });
  const { result } = renderHook(() =>
    usePlayer({ serverURL: "http://srv-line-ep", destination: dest, detailAPI: apis.detail, playbackAPI: apis.playback }),
  );
  await waitFor(() => expect(result.current.state.detail).not.toBeNull());
  await act(async () => { await result.current.actions.switchLine(1); });
  expect(result.current.state.currentLineIndex).toBe(1);
  expect(result.current.state.playbackURL).toBe("https://p/m3u8?mt=t");

  await act(async () => { await result.current.actions.switchEpisode(0); });
  expect(result.current.state.currentEpisodeIndex).toBe(0);
});

test("timeUpdate auto-advances to the next episode when progress reaches the end", async () => {
  const apis = mkAPIs();
  apis.detail.detail = jest.fn().mockResolvedValue({
    ...detail,
    episodes: [[
      { name: "E1", url: "raw://e1" },
      { name: "E2", url: "raw://e2" },
      { name: "E3", url: "raw://e3" },
    ]],
  });
  apis.playback.playbackURL = jest.fn()
    .mockResolvedValueOnce({ mode: "proxy", url: "https://p/e1.m3u8" })
    .mockResolvedValueOnce({ mode: "proxy", url: "https://p/e2.m3u8" })
    .mockResolvedValueOnce({ mode: "proxy", url: "https://p/e3.m3u8" });
  const { result } = renderHook(() =>
    usePlayer({ serverURL: "http://srv-auto-next", destination: dest, detailAPI: apis.detail, playbackAPI: apis.playback }),
  );
  await waitFor(() => expect(result.current.state.detail).not.toBeNull());
  await act(async () => { await result.current.actions.startPlayback(); });
  expect(result.current.state.currentEpisodeIndex).toBe(0);

  act(() => { result.current.actions.timeUpdate(99.5, 100); });

  await waitFor(() => expect(result.current.state.currentEpisodeIndex).toBe(1));
  expect(result.current.state.playbackURL).toBe("https://p/e2.m3u8");
  expect(apis.playback.playbackURL).toHaveBeenLastCalledWith("raw://e2", "a");

  act(() => { result.current.actions.timeUpdate(99.7, 100); });
  expect(result.current.state.currentEpisodeIndex).toBe(1);
  expect(apis.playback.playbackURL).toHaveBeenCalledTimes(2);

  act(() => { result.current.actions.timeUpdate(2, 100); });
  act(() => { result.current.actions.timeUpdate(99.5, 100); });
  await waitFor(() => expect(result.current.state.currentEpisodeIndex).toBe(2));
  expect(result.current.state.playbackURL).toBe("https://p/e3.m3u8");
});

test("setSkipIntro and setSkipOutro persist to MMKV", async () => {
  const { loadPlaybackSettings } = require("@/storage/playbackSettings");
  const apis = mkAPIs();
  const { result } = renderHook(() =>
    usePlayer({ serverURL: "http://srv-skip", destination: dest, detailAPI: apis.detail, playbackAPI: apis.playback }),
  );
  await waitFor(() => expect(result.current.state.detail).not.toBeNull());
  act(() => { result.current.actions.setSkipIntro(45); });
  act(() => { result.current.actions.setSkipOutro(30); });
  expect(loadPlaybackSettings("http://srv-skip", "T")).toEqual({
    skipIntroSeconds: 45,
    skipOutroSeconds: 30,
    playbackRate: 1,
  });
});

test("onError walks line then source fallback, surfaces final error when all drained", async () => {
  const apis = mkAPIs();
  // Single-line detail + single source → both line and source fallback drain.
  //
  // 单线路 detail + 单源 → 线路与源 fallback 都会耗尽.
  apis.detail.detail = jest.fn().mockResolvedValue({ ...detail, episodes: [[{ name: "E1", url: "raw://e1" }]] });
  apis.playback.playbackURL = jest.fn().mockRejectedValue(new Error("transport dead"));
  const { result } = renderHook(() =>
    usePlayer({ serverURL: "http://srv-onerror", destination: dest, detailAPI: apis.detail, playbackAPI: apis.playback }),
  );
  await waitFor(() => expect(result.current.state.detail).not.toBeNull());
  await act(async () => { await result.current.actions.onError("player kicked"); });
  expect(result.current.state.errorMessage).toBe("All sources failed");
  expect(result.current.state.playbackURL).toBeNull();
});

test("resumeStartSeconds defaults to skipIntro until consumed", async () => {
  const apis = mkAPIs();
  savePlaybackSettings("http://srv-resume", "T", { skipIntroSeconds: 12, skipOutroSeconds: 0, playbackRate: 1 });
  const { result } = renderHook(() =>
    usePlayer({ serverURL: "http://srv-resume", destination: dest, detailAPI: apis.detail, playbackAPI: apis.playback }),
  );
  await waitFor(() => expect(result.current.resumeStartSeconds).toBeGreaterThan(0));
  expect(result.current.resumeStartSeconds).toBe(12);
  act(() => { result.current.actions.markResumeConsumed(); });
  expect(result.current.resumeStartSeconds).toBe(0);
});

const twoLineDetail: VideoDetail = {
  ...detail,
  episodes: [
    [{ name: "L1E1", url: "raw://l1e1" }],
    [{ name: "L2E1", url: "raw://l2e1" }, { name: "L2E2", url: "raw://l2e2" }],
  ],
};

test("waits for the watch record and selects its line and episode on the open source", async () => {
  const apis = mkAPIs();
  apis.detail.detail = jest.fn().mockResolvedValue(twoLineDetail);
  savePlaybackSettings("http://srv-remote-resume", "T", { skipIntroSeconds: 7, skipOutroSeconds: 0, playbackRate: 1 });
  const remoteDestination: PlayDestination = { ...dest, sources: [src("a"), src("b")] };
  const { result, rerender } = renderHook(
    ({ resume }: { resume: { pending: boolean; item: WatchPayload | null } }) => usePlayer({
      serverURL: "http://srv-remote-resume",
      destination: remoteDestination,
      detailAPI: apis.detail,
      playbackAPI: apis.playback,
      resume,
    }),
    { initialProps: { resume: { pending: true, item: null } } },
  );
  expect(result.current.historyReady).toBe(false);
  expect(apis.detail.detail).not.toHaveBeenCalled();

  // The record was written on source b; the open source a keeps playing, at the record's episode.
  //
  // 记录写于来源 b; 继续使用当前来源 a, 但定位到记录中的剧集.
  rerender({ resume: { pending: false, item: watchRecord({ source_key: "b", video_id: "v-b", group_index: 1, episode_index: 1, progress_sec: 45 }) } });

  await waitFor(() => expect(apis.detail.detail).toHaveBeenCalledWith("a", "v-a"));
  await waitFor(() => expect(result.current.resumeStartSeconds).toBe(7));
  expect(result.current.historyReady).toBe(true);
  expect(result.current.state.currentSourceKey).toBe("a");
  expect(result.current.state.currentLineIndex).toBe(1);
  expect(result.current.state.currentEpisodeIndex).toBe(1);
});

test("resumes the position when source, video, line, and episode all match", async () => {
  const apis = mkAPIs();
  apis.detail.detail = jest.fn().mockResolvedValue(twoLineDetail);
  const { result } = renderHook(() => usePlayer({
    serverURL: "http://srv-exact-resume",
    destination: dest,
    detailAPI: apis.detail,
    playbackAPI: apis.playback,
    resume: { pending: false, item: watchRecord({ group_index: 1, episode_index: 1, progress_sec: 45 }) },
  }));
  await waitFor(() => expect(result.current.resumeStartSeconds).toBe(45));
  expect(result.current.state.currentLineIndex).toBe(1);
  expect(result.current.state.currentEpisodeIndex).toBe(1);
});

test("ignores finished watch records", async () => {
  const apis = mkAPIs();
  apis.detail.detail = jest.fn().mockResolvedValue(twoLineDetail);
  savePlaybackSettings("http://srv-ignore", "T", { skipIntroSeconds: 7, skipOutroSeconds: 0, playbackRate: 1 });
  const { result } = renderHook(() => usePlayer({
    serverURL: "http://srv-ignore",
    destination: dest,
    detailAPI: apis.detail,
    playbackAPI: apis.playback,
    resume: { pending: false, item: watchRecord({ group_index: 1, episode_index: 1, progress_sec: 300, completed: true }) },
  }));
  await waitFor(() => expect(result.current.state.detail).not.toBeNull());
  await waitFor(() => expect(result.current.resumeStartSeconds).toBe(7));
  expect(result.current.state.currentLineIndex).toBe(0);
  expect(result.current.state.currentEpisodeIndex).toBe(0);
});

test("switchEpisode checkpoints the outgoing episode and flushes it", async () => {
  const apis = mkAPIs();
  const saveWatch = jest.fn();
  const flushWatch = jest.fn();
  const { result } = renderHook(() =>
    usePlayer({ serverURL: "http://srv-switch-flush", destination: dest, detailAPI: apis.detail, playbackAPI: apis.playback, saveWatch, flushWatch }),
  );
  await waitFor(() => expect(result.current.state.detail).not.toBeNull());
  act(() => { result.current.actions.timeUpdate(3, 100); });
  await act(async () => { await result.current.actions.switchEpisode(1); });
  expect(saveWatch).toHaveBeenLastCalledWith(expect.objectContaining({ episode_index: 0, progress_sec: 3 }));
  expect(flushWatch).toHaveBeenCalledTimes(1);
});

test("switchEpisode recomputes resume position for the target episode", async () => {
  const serverURL = "http://srv-resume-target";
  savePlaybackSettings(serverURL, "T", { skipIntroSeconds: 12, skipOutroSeconds: 0, playbackRate: 1 });
  const apis = mkAPIs();
  const { result } = renderHook(() =>
    usePlayer({ serverURL, destination: dest, detailAPI: apis.detail, playbackAPI: apis.playback, resume: { pending: false, item: watchRecord() } }),
  );
  await waitFor(() => expect(result.current.resumeStartSeconds).toBe(95));
  act(() => { result.current.actions.markResumeConsumed(); });

  await act(async () => { await result.current.actions.switchEpisode(1); });

  expect(result.current.state.currentEpisodeIndex).toBe(1);
  expect(result.current.resumeStartSeconds).toBe(12);
});

test("switchEpisode past the last episode keeps the title finished and plays nothing new", async () => {
  const apis = mkAPIs();
  const saveWatch = jest.fn();
  const flushWatch = jest.fn();
  const multiSrcDest: PlayDestination = { ...dest, sources: [src("a"), src("b")] };
  const { result } = renderHook(() =>
    usePlayer({ serverURL: "http://srv-last-episode", destination: multiSrcDest, detailAPI: apis.detail, playbackAPI: apis.playback, saveWatch, flushWatch }),
  );
  await waitFor(() => expect(result.current.state.detail).not.toBeNull());
  await act(async () => { await result.current.actions.switchEpisode(1); });
  act(() => { result.current.actions.setPlaying(true); });
  act(() => { result.current.actions.timeUpdate(99.5, 100); });
  expect(saveWatch).toHaveBeenLastCalledWith(expect.objectContaining({ episode_index: 1, completed: true }));
  const resolves = (apis.playback.playbackURL as jest.Mock).mock.calls.length;
  const details = (apis.detail.detail as jest.Mock).mock.calls.length;
  flushWatch.mockClear();

  await act(async () => { await result.current.actions.switchEpisode(2); });

  expect(flushWatch).toHaveBeenCalledTimes(1);
  expect(apis.playback.playbackURL).toHaveBeenCalledTimes(resolves);
  expect(apis.detail.detail).toHaveBeenCalledTimes(details);
  expect(result.current.state.currentSourceKey).toBe("a");
  expect(result.current.state.currentEpisodeIndex).toBe(1);
  expect(result.current.state.isPlaying).toBe(false);
  expect(result.current.state.errorMessage).toBe("");

  act(() => { result.current.actions.timeUpdate(99.9, 100); });
  act(() => { result.current.actions.persistProgressNow(); });
  expect(saveWatch).not.toHaveBeenCalledWith(expect.objectContaining({ completed: false }));
});

test("persistProgressNow ignores a non-finite position", async () => {
  const apis = mkAPIs();
  const saveWatch = jest.fn();
  const { result } = renderHook(() =>
    usePlayer({ serverURL: "http://srv-non-finite", destination: dest, detailAPI: apis.detail, playbackAPI: apis.playback, saveWatch }),
  );
  await waitFor(() => expect(result.current.state.detail).not.toBeNull());
  act(() => { result.current.actions.persistProgressNow(Number.NaN, 100); });
  act(() => { result.current.actions.persistProgressNow(Number.POSITIVE_INFINITY, 100); });
  act(() => { result.current.actions.timeUpdate(Number.POSITIVE_INFINITY, 100); });
  expect(saveWatch).not.toHaveBeenCalled();
});

test("a startup line fallback does not seek to the record's position for another episode", async () => {
  const serverURL = "http://srv-fallback-resume";
  savePlaybackSettings(serverURL, "T", { skipIntroSeconds: 7, skipOutroSeconds: 0, playbackRate: 1 });
  const apis = mkAPIs();
  apis.detail.detail = jest.fn().mockResolvedValue({
    ...detail,
    episodes: [
      [{ name: "L1E1", url: "raw://l1e1" }, { name: "L1E2", url: "raw://l1e2" }],
      [{ name: "L2E1", url: "raw://l2e1" }],
    ],
  });
  apis.playback.playbackURL = jest.fn()
    .mockRejectedValueOnce(new Error("line 1 down"))
    .mockResolvedValueOnce({ mode: "direct", url: "https://ok/m3u8" });
  const { result } = renderHook(() => usePlayer({
    serverURL,
    destination: dest,
    detailAPI: apis.detail,
    playbackAPI: apis.playback,
    resume: { pending: false, item: watchRecord({ group_index: 0, episode_index: 1, progress_sec: 45 }) },
  }));
  await waitFor(() => expect(result.current.resumeStartSeconds).toBe(45));

  await act(async () => { await result.current.actions.startPlayback(); });

  expect(result.current.state.currentLineIndex).toBe(1);
  expect(result.current.state.currentEpisodeIndex).toBe(0);
  expect(result.current.resumeStartSeconds).toBe(7);
});

test("a checkpoint after an auto-advance and before the next episode loads writes nothing for it", async () => {
  const saveWatch = jest.fn();
  const apis = mkAPIs();
  const { result } = renderHook(() => usePlayer({
    serverURL: "http://srv-advance-stale",
    destination: dest,
    detailAPI: apis.detail,
    playbackAPI: apis.playback,
    saveWatch,
    flushWatch: jest.fn(),
  }));
  await waitFor(() => expect(result.current.state.detail).not.toBeNull());
  await act(async () => { await result.current.actions.startPlayback(); });

  await act(async () => { result.current.actions.timeUpdate(2699.5, 2700); });
  await waitFor(() => expect(result.current.state.currentEpisodeIndex).toBe(1));
  // Pause, background, or unmount before the new episode's onLoad.
  //
  // 新剧集 onLoad 之前暂停, 退到后台或卸载.
  act(() => { result.current.actions.persistProgressNow(); });

  expect(saveWatch.mock.calls.map(([payload]) => payload.episode_index)).not.toContain(1);
  expect(result.current.state).toMatchObject({ currentTime: 0, duration: 0 });
});

test("a checkpoint after an onError line fallback and before the new line loads writes nothing for it", async () => {
  const saveWatch = jest.fn();
  const apis = mkAPIs();
  apis.detail.detail = jest.fn().mockResolvedValue({
    ...detail,
    episodes: [[{ name: "L1E1", url: "raw://l1e1" }], [{ name: "L2E1", url: "raw://l2e1" }]],
  });
  apis.playback.playbackURL = jest.fn()
    .mockResolvedValueOnce({ mode: "direct", url: "https://line1/m3u8" })
    .mockRejectedValueOnce(new Error("line 1 down"))
    .mockResolvedValueOnce({ mode: "direct", url: "https://line2/m3u8" });
  const { result } = renderHook(() => usePlayer({
    serverURL: "http://srv-onerror-stale",
    destination: dest,
    detailAPI: apis.detail,
    playbackAPI: apis.playback,
    saveWatch,
  }));
  await waitFor(() => expect(result.current.state.detail).not.toBeNull());
  await act(async () => { await result.current.actions.startPlayback(); });
  act(() => { result.current.actions.timeUpdate(40, 100); });

  await act(async () => { await result.current.actions.onError("stream died"); });
  expect(result.current.state.currentLineIndex).toBe(1);
  act(() => { result.current.actions.persistProgressNow(); });

  expect(saveWatch.mock.calls.map(([payload]) => payload.group_index)).not.toContain(1);
});
