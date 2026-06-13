// createDetailAPI tests — covers query encoding + return shape.
// createDetailAPI 测试 — 校验查询参数编码与返回结构.

import type { APIClient } from "./client";
import { createDetailAPI } from "./detail";
import type { VideoDetail } from "./types";

const detail: VideoDetail = {
  id: "1", title: "T", type: "Movie", year: "2024", cover: "c", desc: "d",
  director: "", actor: "", area: "", episodes: [[{ name: "01", url: "u" }]],
};

function fakeClient(): APIClient & { get: jest.Mock } {
  const get = jest.fn().mockResolvedValue(detail);
  return {
    baseURL: "http://x",
    get,
    post: jest.fn(),
    put: jest.fn(),
    del: jest.fn(),
  } as never;
}

test("detail encodes source + id, returns VideoDetail", async () => {
  const client = fakeClient();
  const api = createDetailAPI(client);
  const got = await api.detail("source key", "video/1?x=y");
  expect(client.get).toHaveBeenCalledWith(
    "/detail?source=source+key&id=video%2F1%3Fx%3Dy",
  );
  expect(got.title).toBe("T");
});
