// playbackSettings tests — round-trip + server/title isolation.
// playbackSettings 测试 — 往返存取 + 服务器/标题隔离.

import {
  defaultPlaybackSettings, loadPlaybackSettings, savePlaybackSettings,
} from "./playbackSettings";

const URL = "http://srv-a";

test("defaultPlaybackSettings returns 0/0/1", () => {
  expect(defaultPlaybackSettings()).toEqual({ skipIntroSeconds: 0, skipOutroSeconds: 0, playbackRate: 1 });
});

test("loadPlaybackSettings returns defaults when nothing stored", () => {
  expect(loadPlaybackSettings(URL, "Show A")).toEqual({ skipIntroSeconds: 0, skipOutroSeconds: 0, playbackRate: 1 });
});

test("save then load round-trips per title", () => {
  savePlaybackSettings(URL, "Show A", { skipIntroSeconds: 90, skipOutroSeconds: 45, playbackRate: 1.5 });
  expect(loadPlaybackSettings(URL, "Show A")).toEqual({ skipIntroSeconds: 90, skipOutroSeconds: 45, playbackRate: 1.5 });
});

test("titles isolate within the same server", () => {
  savePlaybackSettings(URL, "Show A", { skipIntroSeconds: 60, skipOutroSeconds: 0, playbackRate: 1 });
  savePlaybackSettings(URL, "Show B", { skipIntroSeconds: 0, skipOutroSeconds: 30, playbackRate: 2 });
  expect(loadPlaybackSettings(URL, "Show A").skipIntroSeconds).toBe(60);
  expect(loadPlaybackSettings(URL, "Show B").skipOutroSeconds).toBe(30);
});

test("servers isolate same title", () => {
  savePlaybackSettings(URL, "Show A", { skipIntroSeconds: 60, skipOutroSeconds: 0, playbackRate: 1 });
  savePlaybackSettings("http://srv-b", "Show A", { skipIntroSeconds: 5, skipOutroSeconds: 0, playbackRate: 1 });
  expect(loadPlaybackSettings(URL, "Show A").skipIntroSeconds).toBe(60);
  expect(loadPlaybackSettings("http://srv-b", "Show A").skipIntroSeconds).toBe(5);
});
