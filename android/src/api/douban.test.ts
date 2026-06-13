// DoubanAPI tests exercise the home endpoint with a stub client.
// DoubanAPI 测试使用 stub client 覆盖首页接口.

import type { APIClient } from "./client";
import { createDoubanAPI } from "./douban";

function mockClient(overrides: Partial<APIClient> = {}): APIClient {
  return {
    baseURL: "https://x",
    get: jest.fn(async () => ({}) as unknown),
    post: jest.fn(async () => ({}) as unknown),
    put: jest.fn(async () => ({}) as unknown),
    del: jest.fn(async () => undefined),
    ...overrides,
  } as APIClient;
}

describe("DoubanAPI", () => {
  it("doubanHome GETs /douban/home and returns the typed response", async () => {
    const payload = { sections: [{ name: "热门", tag: "hot", type: "movie", items: [] }] };
    const get = jest.fn(async () => payload);
    const api = createDoubanAPI(mockClient({ get: get as unknown as APIClient["get"] }));
    const r = await api.doubanHome();
    expect(get).toHaveBeenCalledWith("/douban/home");
    expect(r.sections[0]!.name).toBe("热门");
  });
});
