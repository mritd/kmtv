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

describe("createDoubanAPI.doubanCategories", () => {
  it("calls /douban/categories and returns response verbatim", async () => {
    const payload = {
      categories: [
        { key: "movie", name: "电影", douban_kind: "movie", format: "",
          subcategories: [{ name: "全部", tag: "" }],
          regions: [{ name: "华语", value: "华语" }] },
      ],
    };
    const get = jest.fn(async () => payload);
    const api = createDoubanAPI(mockClient({ get: get as unknown as APIClient["get"] }));
    await expect(api.doubanCategories()).resolves.toEqual(payload);
    expect(get).toHaveBeenCalledWith("/douban/categories");
  });
});

describe("createDoubanAPI.doubanRecommendFilter", () => {
  it("encodes only present filter keys + start/count into the query string", async () => {
    const get = jest.fn(async () => ({ items: [] }));
    const api = createDoubanAPI(mockClient({ get: get as unknown as APIClient["get"] }));
    await api.doubanRecommendFilter({ kind: "movie", tag: "热门", format: "", region: "华语", start: 0, count: 20 });
    expect(get).toHaveBeenCalledTimes(1);
    const path = (get.mock.calls[0] as unknown as [string])[0];
    expect(path.startsWith("/douban/recommend/filter?")).toBe(true);
    const params = new URLSearchParams(path.slice(path.indexOf("?") + 1));
    expect(params.get("kind")).toBe("movie");
    expect(params.get("tag")).toBe("热门");
    expect(params.get("format")).toBe("");
    expect(params.get("region")).toBe("华语");
    expect(params.get("start")).toBe("0");
    expect(params.get("count")).toBe("20");
  });

  it("omits start/count when caller does not provide them", async () => {
    const get = jest.fn(async () => ({ items: [] }));
    const api = createDoubanAPI(mockClient({ get: get as unknown as APIClient["get"] }));
    await api.doubanRecommendFilter({ kind: "tv" });
    const path = (get.mock.calls[0] as unknown as [string])[0];
    const params = new URLSearchParams(path.slice(path.indexOf("?") + 1));
    expect(params.has("start")).toBe(false);
    expect(params.has("count")).toBe(false);
  });

  it("normalises a missing items array to []", async () => {
    const get = jest.fn(async () => ({}));
    const api = createDoubanAPI(mockClient({ get: get as unknown as APIClient["get"] }));
    await expect(api.doubanRecommendFilter({ kind: "movie" })).resolves.toEqual({ items: [] });
  });
});
