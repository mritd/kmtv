// categoryFilter pure-function tests (resolveSelection + resolveRecommendFilter).
// categoryFilter 纯函数测试 (resolveSelection + resolveRecommendFilter).

import type { CategoryGroup } from "@/api/types";

import { resolveRecommendFilter, resolveSelection } from "./categoryFilter";

const groups: CategoryGroup[] = [
  {
    key: "movie", name: "电影", douban_kind: "movie", format: "",
    subcategories: [
      { name: "全部", tag: "" },
      { name: "热门", tag: "热门", kind: "movie", format: "kw" },
      { name: "经典", tag: "经典" },
    ],
    regions: [{ name: "全部", value: "" }, { name: "华语", value: "华语" }],
  },
  {
    key: "tv", name: "剧集", douban_kind: "tv", format: "season",
    subcategories: [{ name: "全部", tag: "" }],
    regions: [],
  },
];

describe("resolveSelection", () => {
  it("falls back to the first group when groupKey is null", () => {
    const r = resolveSelection(groups, { groupKey: null, subName: null, regionName: null });
    expect(r.group?.key).toBe("movie");
    expect(r.sub?.name).toBe("全部");
    expect(r.region?.name).toBe("全部");
  });

  it("falls back to the first group when groupKey unknown", () => {
    const r = resolveSelection(groups, { groupKey: "ghost", subName: null, regionName: null });
    expect(r.group?.key).toBe("movie");
  });

  it("resolves the exact sub + region when names known", () => {
    const r = resolveSelection(groups, { groupKey: "movie", subName: "热门", regionName: "华语" });
    expect(r.sub?.name).toBe("热门");
    expect(r.region?.name).toBe("华语");
  });

  it("falls back to first sub + first region when names unknown in the active group", () => {
    const r = resolveSelection(groups, { groupKey: "movie", subName: "ghost", regionName: "ghost" });
    expect(r.sub?.name).toBe("全部");
    expect(r.region?.name).toBe("全部");
  });

  it("returns null fields when groups list is empty", () => {
    const r = resolveSelection([], { groupKey: null, subName: null, regionName: null });
    expect(r.group).toBeNull();
    expect(r.sub).toBeNull();
    expect(r.region).toBeNull();
  });

  it("region becomes null when active group has no regions", () => {
    const r = resolveSelection(groups, { groupKey: "tv", subName: null, regionName: null });
    expect(r.group?.key).toBe("tv");
    expect(r.region).toBeNull();
  });
});

describe("resolveRecommendFilter", () => {
  it("returns empty kind when group is null (disables the infinite query)", () => {
    expect(resolveRecommendFilter({ group: null, sub: null, region: null }))
      .toEqual({ kind: "", tag: "", format: "", region: "" });
  });

  it("uses group douban_kind + group format when sub has no kind override", () => {
    const r = resolveSelection(groups, { groupKey: "tv", subName: "全部", regionName: null });
    expect(resolveRecommendFilter(r)).toEqual({ kind: "tv", tag: "", format: "season", region: "" });
  });

  it("uses sub.kind + sub.format ?? \"\" when sub has its own kind override", () => {
    const r = resolveSelection(groups, { groupKey: "movie", subName: "热门", regionName: "华语" });
    expect(resolveRecommendFilter(r)).toEqual({ kind: "movie", tag: "热门", format: "kw", region: "华语" });
  });

  it("when sub has kind explicitly but no format, format collapses to empty (presence test)", () => {
    const synth: CategoryGroup = {
      key: "x", name: "x", douban_kind: "movie", format: "GROUP_FORMAT",
      subcategories: [{ name: "s1", tag: "t1", kind: "movie" }], regions: [],
    };
    const r = resolveSelection([synth], { groupKey: "x", subName: "s1", regionName: null });
    expect(resolveRecommendFilter(r).format).toBe("");
  });
});
