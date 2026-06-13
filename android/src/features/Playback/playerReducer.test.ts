// playerReducer tests — every transition exhaustively covered including clamp edges.
// playerReducer 测试 — 穷尽覆盖每个转移, 含 clamp 边界.

import type { SourceResult, VideoDetail } from "@/api/types";
import { initialPlayerState, playerReducer, type PlayerState } from "./playerReducer";

const src = (key: string): SourceResult => ({
  source_key: key, source_name: `name-${key}`, is_adult: false, video_id: `v-${key}`,
  duration_ms: 0, episodes: [],
});
const detail: VideoDetail = {
  id: "1", title: "T", type: "Movie", year: "2024", cover: "", desc: "",
  director: "", actor: "", area: "", episodes: [[{ name: "E1", url: "u1" }, { name: "E2", url: "u2" }]],
};

function seed(over: Partial<PlayerState> = {}): PlayerState {
  return { ...initialPlayerState([src("a")], "a", "v-a", 0), ...over };
}

test("initialPlayerState seeds sources, key, episodeIndex; defaults everything else", () => {
  const s = initialPlayerState([src("a")], "a", "v-a", 0);
  expect(s.sources).toHaveLength(1);
  expect(s.currentSourceKey).toBe("a");
  expect(s.currentEpisodeIndex).toBe(0);
  expect(s.currentLineIndex).toBe(0);
  expect(s.isPlaying).toBe(false);
  expect(s.isBuffering).toBe(false);
  expect(s.playbackRate).toBe(1);
  expect(s.playbackURL).toBeNull();
  expect(s.urlGeneration).toBe(0);
});

test("initialPlayerState seeds a placeholder source when destination.sources is empty", () => {
  // Continue-watching entry: only sourceKey + videoId are known. We seed a placeholder so the
  // selection helpers have a current source to anchor to until detailLoaded replaces it.
  // 继续观看入口仅有 sourceKey + videoId. 占位 source 让选择器在 detailLoaded 替换之前有锚点.
  const s = initialPlayerState([], "k1", "v1", 2);
  expect(s.sources).toHaveLength(1);
  expect(s.sources[0]).toMatchObject({ source_key: "k1", video_id: "v1" });
  expect(s.currentEpisodeIndex).toBe(2);
});

test("detailLoaded sets detail; clampedIndex stays within [0, episodes-1]", () => {
  const s = seed({ currentEpisodeIndex: 99 });
  const next = playerReducer(s, { type: "detailLoaded", detail });
  expect(next.detail).toBe(detail);
  expect(next.currentEpisodeIndex).toBe(1);
});

test("detailLoaded with empty episodes resets episodeIndex to 0", () => {
  const next = playerReducer(seed(), { type: "detailLoaded", detail: { ...detail, episodes: [] } });
  expect(next.currentEpisodeIndex).toBe(0);
});

test("switchEpisode updates index", () => {
  const next = playerReducer(seed(), { type: "switchEpisode", index: 5 });
  expect(next.currentEpisodeIndex).toBe(5);
});

test("switchLine resets episodeIndex to 0", () => {
  const next = playerReducer(seed({ currentEpisodeIndex: 7 }), { type: "switchLine", index: 2 });
  expect(next.currentLineIndex).toBe(2);
  expect(next.currentEpisodeIndex).toBe(0);
});

test("switchSource sets sourceKey, resets lineIndex to 0", () => {
  const next = playerReducer(
    seed({ sources: [src("a"), src("b")], currentLineIndex: 3 }),
    { type: "switchSource", sourceKey: "b" },
  );
  expect(next.currentSourceKey).toBe("b");
  expect(next.currentLineIndex).toBe(0);
});

test("removeSource drops the matching source, leaves currentSourceKey alone", () => {
  const next = playerReducer(
    seed({ sources: [src("a"), src("b"), src("c")] }),
    { type: "removeSource", sourceKey: "b" },
  );
  expect(next.sources.map((s) => s.source_key)).toEqual(["a", "c"]);
});

test("timeUpdate updates currentTime + duration unless seeking", () => {
  const seeking = seed({ isSeeking: true, currentTime: 10 });
  const next = playerReducer(seeking, { type: "timeUpdate", currentTime: 25, duration: 100 });
  expect(next.currentTime).toBe(10);
  expect(next.duration).toBe(100);

  const not = seed({ isSeeking: false });
  const next2 = playerReducer(not, { type: "timeUpdate", currentTime: 30, duration: 60 });
  expect(next2.currentTime).toBe(30);
  expect(next2.duration).toBe(60);
});

test("error sets message, clears buffering, clears playbackURL", () => {
  const next = playerReducer(seed({ isBuffering: true, playbackURL: "https://x" }), { type: "error", message: "boom" });
  expect(next.errorMessage).toBe("boom");
  expect(next.isBuffering).toBe(false);
  expect(next.playbackURL).toBeNull();
});

test("loadSkipSettings populates skip intro/outro + rate", () => {
  const next = playerReducer(seed(), {
    type: "loadSkipSettings",
    settings: { skipIntroSeconds: 30, skipOutroSeconds: 60, playbackRate: 1.5 },
  });
  expect(next.skipIntroSeconds).toBe(30);
  expect(next.skipOutroSeconds).toBe(60);
  expect(next.playbackRate).toBe(1.5);
});

test("setSkipIntro and setSkipOutro clamp to [0, 300]", () => {
  expect(playerReducer(seed(), { type: "setSkipIntro", value: -5 }).skipIntroSeconds).toBe(0);
  expect(playerReducer(seed(), { type: "setSkipIntro", value: 999 }).skipIntroSeconds).toBe(300);
  expect(playerReducer(seed(), { type: "setSkipOutro", value: 150 }).skipOutroSeconds).toBe(150);
});

test("setRate stores within [0.5, 4]", () => {
  expect(playerReducer(seed(), { type: "setRate", rate: 0.1 }).playbackRate).toBe(0.5);
  expect(playerReducer(seed(), { type: "setRate", rate: 5 }).playbackRate).toBe(4);
  expect(playerReducer(seed(), { type: "setRate", rate: 2 }).playbackRate).toBe(2);
});

test("setSeeking sets the isSeeking flag", () => {
  expect(playerReducer(seed(), { type: "setSeeking", value: true }).isSeeking).toBe(true);
});

test("playState toggles isPlaying", () => {
  expect(playerReducer(seed(), { type: "playState", value: true }).isPlaying).toBe(true);
});

test("setBuffering toggles isBuffering", () => {
  expect(playerReducer(seed(), { type: "setBuffering", value: true }).isBuffering).toBe(true);
});

test("urlResolved sets playbackURL, bumps generation, clears error", () => {
  const s = seed({ errorMessage: "old" });
  const next = playerReducer(s, { type: "urlResolved", url: "https://p/m3u8?mt=t" });
  expect(next.playbackURL).toBe("https://p/m3u8?mt=t");
  expect(next.urlGeneration).toBe(1);
  expect(next.errorMessage).toBe("");
});

test("urlCleared resets playbackURL without bumping generation", () => {
  const s = seed({ playbackURL: "x", urlGeneration: 5 });
  const next = playerReducer(s, { type: "urlCleared" });
  expect(next.playbackURL).toBeNull();
  expect(next.urlGeneration).toBe(5);
});
