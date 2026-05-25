/**
 * playbackState.test.ts — full TDD coverage for the pure playbackReducer + createInitialPlaybackState.
 * playbackState.test.ts — 纯 playbackReducer + createInitialPlaybackState 的完整 TDD 覆盖.
 *
 * All tests operate on plain data with no React, DOM, or ArtPlayer involvement.
 * 所有测试仅操作纯数据, 不涉及 React、DOM 或 ArtPlayer.
 */

import { describe, expect, it } from "vitest";

import { createInitialPlaybackState, playbackReducer } from "./playbackState";

// Episode fixtures shared across test groups.
// 跨测试组共享的 Episode 固定值.
const episodes = [
  [
    { name: "01", url: "https://cdn.example/1.m3u8" },
    { name: "02", url: "https://cdn.example/2.m3u8" },
  ],
  [{ name: "01", url: "https://cdn-b.example/1.m3u8" }],
];

describe("createInitialPlaybackState", () => {
  it("returns idle state with null episode, url, mode, and error", () => {
    const state = createInitialPlaybackState();

    expect(state.status).toBe("idle");
    expect(state.groupIndex).toBe(0);
    expect(state.episodeIndex).toBe(0);
    expect(state.selectedEpisode).toBeNull();
    expect(state.url).toBeNull();
    expect(state.mode).toBeNull();
    expect(state.error).toBeNull();
  });
});

describe("playback reducer", () => {
  // ── selectEpisode ──────────────────────────────────────────────────────────

  describe("selectEpisode", () => {
    it("selects an episode and enters resolving", () => {
      const state = playbackReducer(createInitialPlaybackState(), {
        type: "selectEpisode",
        groupIndex: 0,
        episodeIndex: 1,
        episode: episodes[0][1],
      });

      expect(state.status).toBe("resolving");
      expect(state.groupIndex).toBe(0);
      expect(state.episodeIndex).toBe(1);
      expect(state.selectedEpisode?.name).toBe("02");
    });

    it("clears url, mode, and error on selectEpisode", () => {
      // Start from a ready state so we can verify fields are cleared.
      // 从 ready 状态开始, 验证 url/mode/error 是否被清空.
      const ready = playbackReducer(createInitialPlaybackState(), {
        type: "selectEpisode",
        groupIndex: 0,
        episodeIndex: 0,
        episode: episodes[0][0],
      });
      const resolved = playbackReducer(ready, {
        type: "resolveSuccess",
        url: "https://proxy.example/1.m3u8",
        mode: "proxy",
      });
      const reselected = playbackReducer(resolved, {
        type: "selectEpisode",
        groupIndex: 0,
        episodeIndex: 1,
        episode: episodes[0][1],
      });

      expect(reselected.url).toBeNull();
      expect(reselected.mode).toBeNull();
      expect(reselected.error).toBeNull();
      expect(reselected.status).toBe("resolving");
    });
  });

  // ── selectSource ───────────────────────────────────────────────────────────

  describe("selectSource", () => {
    it("preserves episode index when switching to a source with the same episode", () => {
      const selected = playbackReducer(createInitialPlaybackState(), {
        type: "selectEpisode",
        groupIndex: 0,
        episodeIndex: 1,
        episode: episodes[0][1],
      });
      const switched = playbackReducer(selected, { type: "selectSource", groupIndex: 0, groups: episodes });

      expect(switched.groupIndex).toBe(0);
      expect(switched.episodeIndex).toBe(1);
    });

    it("falls back to first episode when selected index is missing in the new source", () => {
      const selected = playbackReducer(createInitialPlaybackState(), {
        type: "selectEpisode",
        groupIndex: 0,
        episodeIndex: 1,
        episode: episodes[0][1],
      });
      const switched = playbackReducer(selected, { type: "selectSource", groupIndex: 1, groups: episodes });

      expect(switched.groupIndex).toBe(1);
      expect(switched.episodeIndex).toBe(0);
      expect(switched.selectedEpisode?.name).toBe("01");
    });

    it("enters idle when the selected group has no episodes", () => {
      // Empty group simulates a source that has not yet loaded its episode list.
      // 空组模拟尚未加载集数列表的 source.
      const switched = playbackReducer(createInitialPlaybackState(), {
        type: "selectSource",
        groupIndex: 0,
        groups: [[]],
      });

      expect(switched.status).toBe("idle");
      expect(switched.selectedEpisode).toBeNull();
    });

    it("enters resolving when the selected group has at least one episode", () => {
      const switched = playbackReducer(createInitialPlaybackState(), {
        type: "selectSource",
        groupIndex: 0,
        groups: episodes,
      });

      expect(switched.status).toBe("resolving");
      expect(switched.selectedEpisode?.name).toBe("01");
    });

    it("clears url, mode, and error on selectSource", () => {
      // Start from a ready state so we can verify fields are cleared.
      // 从 ready 状态开始, 验证 url/mode/error 是否被清空.
      const ready = playbackReducer(createInitialPlaybackState(), {
        type: "resolveSuccess",
        url: "https://proxy.example/1.m3u8",
        mode: "direct",
      });
      const switched = playbackReducer(ready, {
        type: "selectSource",
        groupIndex: 0,
        groups: episodes,
      });

      expect(switched.url).toBeNull();
      expect(switched.mode).toBeNull();
      expect(switched.error).toBeNull();
    });

    it("uses the out-of-bounds group index and selects first episode from the fallback empty slice", () => {
      // When groupIndex points beyond the groups array, episodes falls back to [].
      // groupIndex 超出数组范围时, episodes 回退到 [].
      const switched = playbackReducer(createInitialPlaybackState(), {
        type: "selectSource",
        groupIndex: 99,
        groups: episodes,
      });

      // groups[99] is undefined → episodes = [] → status = "idle".
      // groups[99] 为 undefined → episodes = [] → status = "idle".
      expect(switched.status).toBe("idle");
      expect(switched.groupIndex).toBe(99);
      expect(switched.selectedEpisode).toBeNull();
    });
  });

  // ── resolveSuccess ─────────────────────────────────────────────────────────

  describe("resolveSuccess", () => {
    it("moves to ready after URL resolution", () => {
      const resolving = playbackReducer(createInitialPlaybackState(), {
        type: "selectEpisode",
        groupIndex: 0,
        episodeIndex: 0,
        episode: episodes[0][0],
      });
      const ready = playbackReducer(resolving, {
        type: "resolveSuccess",
        url: "https://proxy.example/1.m3u8",
        mode: "proxy",
      });

      expect(ready.status).toBe("ready");
      expect(ready.url).toBe("https://proxy.example/1.m3u8");
      expect(ready.mode).toBe("proxy");
    });

    it("accepts direct mode", () => {
      const resolving = playbackReducer(createInitialPlaybackState(), {
        type: "selectEpisode",
        groupIndex: 0,
        episodeIndex: 0,
        episode: episodes[0][0],
      });
      const ready = playbackReducer(resolving, {
        type: "resolveSuccess",
        url: "https://cdn.example/1.m3u8",
        mode: "direct",
      });

      expect(ready.mode).toBe("direct");
      expect(ready.error).toBeNull();
    });

    it("preserves selectedEpisode and indexes from prior state", () => {
      const resolving = playbackReducer(createInitialPlaybackState(), {
        type: "selectEpisode",
        groupIndex: 1,
        episodeIndex: 0,
        episode: episodes[1][0],
      });
      const ready = playbackReducer(resolving, {
        type: "resolveSuccess",
        url: "https://cdn-b.example/1.m3u8",
        mode: "proxy",
      });

      expect(ready.groupIndex).toBe(1);
      expect(ready.episodeIndex).toBe(0);
      expect(ready.selectedEpisode?.name).toBe("01");
    });
  });

  // ── resolveFailure ─────────────────────────────────────────────────────────

  describe("resolveFailure", () => {
    it("keeps selected context after failure", () => {
      const resolving = playbackReducer(createInitialPlaybackState(), {
        type: "selectEpisode",
        groupIndex: 0,
        episodeIndex: 0,
        episode: episodes[0][0],
      });
      const failed = playbackReducer(resolving, {
        type: "resolveFailure",
        message: "Unable to create playback URL.",
      });

      expect(failed.status).toBe("failed");
      expect(failed.selectedEpisode?.name).toBe("01");
      expect(failed.error).toBe("Unable to create playback URL.");
    });

    it("clears url and mode on failure", () => {
      // Start from a ready state to ensure url+mode are cleared, not just absent.
      // 从 ready 状态开始, 确认 url+mode 被清除.
      const ready = playbackReducer(createInitialPlaybackState(), {
        type: "resolveSuccess",
        url: "https://proxy.example/1.m3u8",
        mode: "proxy",
      });
      const failed = playbackReducer(ready, {
        type: "resolveFailure",
        message: "CDN error",
      });

      expect(failed.url).toBeNull();
      expect(failed.mode).toBeNull();
    });
  });

  // ── playing ────────────────────────────────────────────────────────────────

  describe("playing", () => {
    it("transitions from ready to playing and clears error", () => {
      const ready = playbackReducer(createInitialPlaybackState(), {
        type: "resolveSuccess",
        url: "https://proxy.example/1.m3u8",
        mode: "proxy",
      });
      const playing = playbackReducer(ready, { type: "playing" });

      expect(playing.status).toBe("playing");
      expect(playing.error).toBeNull();
    });

    it("preserves all other fields when transitioning to playing", () => {
      const resolving = playbackReducer(createInitialPlaybackState(), {
        type: "selectEpisode",
        groupIndex: 1,
        episodeIndex: 0,
        episode: episodes[1][0],
      });
      const ready = playbackReducer(resolving, {
        type: "resolveSuccess",
        url: "https://cdn-b.example/1.m3u8",
        mode: "direct",
      });
      const playing = playbackReducer(ready, { type: "playing" });

      expect(playing.groupIndex).toBe(1);
      expect(playing.episodeIndex).toBe(0);
      expect(playing.selectedEpisode?.name).toBe("01");
      expect(playing.url).toBe("https://cdn-b.example/1.m3u8");
      expect(playing.mode).toBe("direct");
    });
  });

  // ── reset ──────────────────────────────────────────────────────────────────

  describe("reset", () => {
    it("returns to initial idle state from any state", () => {
      const playing = playbackReducer(createInitialPlaybackState(), {
        type: "resolveSuccess",
        url: "https://proxy.example/1.m3u8",
        mode: "proxy",
      });
      const reset = playbackReducer(playing, { type: "reset" });

      expect(reset).toEqual(createInitialPlaybackState());
    });

    it("reset from failed state returns idle with no error", () => {
      const failed = playbackReducer(createInitialPlaybackState(), {
        type: "resolveFailure",
        message: "boom",
      });
      const reset = playbackReducer(failed, { type: "reset" });

      expect(reset.status).toBe("idle");
      expect(reset.error).toBeNull();
      expect(reset.selectedEpisode).toBeNull();
    });
  });
});
