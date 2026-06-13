// createPlaybackAPI tests — covers POST body, response shape, empty source case.
// createPlaybackAPI 测试 — 校验 POST body、响应结构与空 source 情况.

import type { APIClient } from "./client";
import { createPlaybackAPI } from "./playback";

function fakeClient(): APIClient & { post: jest.Mock } {
  const post = jest.fn().mockResolvedValue({ mode: "proxy", url: "https://p/m3u8?mt=x" });
  return {
    baseURL: "http://x",
    get: jest.fn(),
    post,
    put: jest.fn(),
    del: jest.fn(),
  } as never;
}

test("playbackURL POSTs body and returns response", async () => {
  const client = fakeClient();
  const api = createPlaybackAPI(client);
  const got = await api.playbackURL("https://raw/m3u8", "src-key");
  expect(client.post).toHaveBeenCalledWith(
    "/playback/url",
    { url: "https://raw/m3u8", source: "src-key" },
  );
  expect(got.mode).toBe("proxy");
  expect(got.url).toContain("mt=x");
});

test("playbackURL accepts empty source", async () => {
  const client = fakeClient();
  const api = createPlaybackAPI(client);
  await api.playbackURL("https://raw/m3u8", "");
  expect(client.post).toHaveBeenCalledWith(
    "/playback/url",
    { url: "https://raw/m3u8", source: "" },
  );
});
