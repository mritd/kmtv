// Compile-only sanity check that the home discovery type shapes match the iOS contract.
// 编译期校验首页发现类型与 iOS 契约一致.

import type {
  CategoryGroup, DoubanCategoriesResponse, DoubanHomeResponse, DoubanItem, DoubanListResponse,
  DoubanRecommendFilter, HomeSection, Region, SearchProgress, SearchResponse, SearchResult,
  SearchStreamEvent, SourceResult, SubCategory,
} from "./types";

describe("DoubanHomeResponse types", () => {
  it("HomeSection items use DoubanItem shape", () => {
    const item: DoubanItem = { id: "i1", title: "t", cover: "/c.jpg", rate: "8.4", year: "2024" };
    const section: HomeSection = { name: "热门", tag: "hot", type: "movie", items: [item] };
    const resp: DoubanHomeResponse = { sections: [section] };
    expect(resp.sections[0]!.items[0]!.rate).toBe("8.4");
  });
});

describe("M3 wire types", () => {
  it("SubCategory accepts optional kind/format overrides", () => {
    const sub: SubCategory = { name: "热门", tag: "hot", kind: "movie", format: "" };
    expect(sub.kind).toBe("movie");
    const subNoKind: SubCategory = { name: "全部", tag: "" };
    expect(subNoKind.kind).toBeUndefined();
  });

  it("CategoryGroup carries douban_kind + format + subcategories + regions", () => {
    const group: CategoryGroup = {
      key: "movie", name: "电影", douban_kind: "movie", format: "",
      subcategories: [{ name: "全部", tag: "" }],
      regions: [{ name: "华语", value: "华语" } satisfies Region],
    };
    expect(group.subcategories).toHaveLength(1);
    expect(group.regions[0]!.value).toBe("华语");
  });

  it("DoubanCategoriesResponse wraps a categories array", () => {
    const resp: DoubanCategoriesResponse = { categories: [] };
    expect(Array.isArray(resp.categories)).toBe(true);
  });

  it("DoubanRecommendFilter requires kind, allows optional pagination", () => {
    const filter: DoubanRecommendFilter = { kind: "movie", start: 0, count: 20 };
    expect(filter.kind).toBe("movie");
    expect(filter.tag).toBeUndefined();
  });

  it("DoubanListResponse wraps items", () => {
    const resp: DoubanListResponse = { items: [] };
    expect(resp.items).toEqual([]);
  });

  it("SourceResult mirrors server snake_case fields including episodes", () => {
    const src: SourceResult = {
      source_key: "s1", source_name: "Source 1", is_adult: false,
      video_id: "v1", duration_ms: 123, episodes: [{ name: "01", url: "https://x/1.m3u8" }],
    };
    expect(src.source_key).toBe("s1");
    expect(src.episodes[0]!.url).toBe("https://x/1.m3u8");
  });

  it("SearchResult mirrors server fields (no synthetic id on wire)", () => {
    const result: SearchResult = {
      title: "Title", type: "tv", year: "2024", cover: "", desc: "",
      sources: [{
        source_key: "s1", source_name: "Source 1", is_adult: false,
        video_id: "v1", duration_ms: 0, episodes: [],
      }],
    };
    expect(result.title).toBe("Title");
    // No `id` field on the wire — RN code synthesises a list key.
    // wire 上没有 `id` 字段, RN 端自行合成列表 key.
    expect((result as { id?: unknown }).id).toBeUndefined();
  });

  it("SearchResponse wraps results", () => {
    const resp: SearchResponse = { results: [] };
    expect(resp.results).toEqual([]);
  });

  it("SearchProgress + SearchStreamEvent discriminants", () => {
    const progress: SearchProgress = { phase: "searching", completed: 1, total: 5 };
    const event: SearchStreamEvent = { type: "progress", progress };
    expect(event.type).toBe("progress");
    const done: SearchStreamEvent = { type: "result", response: { results: [] } };
    expect(done.type).toBe("result");
    const err: SearchStreamEvent = { type: "error", message: "oops" };
    expect(err.type).toBe("error");
  });
});
