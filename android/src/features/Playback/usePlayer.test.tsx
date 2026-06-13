// usePlayer tests — detail load, URL resolve, line failover, rate + progress wires.
// usePlayer 测试 — 详情加载、URL 解析、线路 failover、倍速与进度写入.

import { act, renderHook, waitFor } from "@testing-library/react-native";
import React from "react";

import type { DetailAPI } from "@/api/detail";
import type { PlaybackAPI } from "@/api/playback";
import type { PlayDestination, SourceResult, VideoDetail } from "@/api/types";
import { savePlaybackSettings } from "@/storage/playbackSettings";
import { loadWatchHistory } from "@/storage/watchHistory";

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
  // 等待详情加载完成, 让 hook 处于稳定状态.
  await waitFor(() => expect(result.current.state.detail).not.toBeNull());
  act(() => { result.current.actions.setRate(1.5); });
  expect(result.current.state.playbackRate).toBe(1.5);

  act(() => { result.current.actions.timeUpdate(12, 100); });
  expect(result.current.state.currentTime).toBe(12);
  expect(result.current.state.duration).toBe(100);
});

test("persistProgressNow writes the full WatchHistoryItem to MMKV", async () => {
  const apis = mkAPIs();
  const { result } = renderHook(() =>
    usePlayer({ serverURL: "http://srv-persist", destination: dest, detailAPI: apis.detail, playbackAPI: apis.playback }),
  );
  await waitFor(() => expect(result.current.state.detail).not.toBeNull());
  act(() => { result.current.actions.timeUpdate(42, 100); });
  act(() => { result.current.actions.persistProgressNow(); });

  const items = loadWatchHistory("http://srv-persist", 50);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    sourceKey: "a",
    videoId: "v-a",
    title: "T",
    episode: "E1",
    episodeIndex: 0,
    progress: 42,
    duration: 100,
  });
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
