/**
 * Tests for categoryFilter — selection resolution + recommend-filter derivation.
 * categoryFilter 测试 — 选择解析 + 推荐筛选参数推导.
 *
 * Focus: the non-obvious format rule (sub overrides format only when it has its own kind),
 * the group-switch reset behaviour via fallback, and empty-list edge cases.
 * 重点: 不直观的 format 规则 (子分类仅在自带 kind 时覆盖 format)、通过回退实现的切组重置行为、空列表边界.
 */

import { describe, expect, it } from "vitest";

import type { CategoryGroup } from "@/api/types";
import { resolveRecommendFilter, resolveSelection } from "./categoryFilter";

// movieGroup: a group whose sub-categories do NOT carry their own kind (format follows the group).
// movieGroup: 子分类不自带 kind 的分组 (format 跟随分组).
const movieGroup: CategoryGroup = {
  key: "movie",
  name: "电影",
  douban_kind: "movie",
  format: "",
  subcategories: [
    { name: "全部", tag: "" },
    { name: "喜剧", tag: "喜剧" },
  ],
  regions: [
    { name: "全部", value: "" },
    { name: "美国", value: "美国" },
  ],
};

// showGroup: a group whose sub-categories carry their own kind+format (sub overrides format).
// showGroup: 子分类自带 kind+format 的分组 (子分类覆盖 format).
const showGroup: CategoryGroup = {
  key: "show",
  name: "综艺",
  douban_kind: "tv",
  format: "tv",
  subcategories: [
    { name: "综艺", tag: "综艺", kind: "tv", format: "show" },
    { name: "纪录片", tag: "纪录片", kind: "tv", format: "" },
  ],
  regions: [],
};

const groups = [movieGroup, showGroup];

describe("resolveSelection", () => {
  it("returns all null for empty groups", () => {
    expect(resolveSelection([], { groupKey: null, subName: null, regionName: null })).toEqual({
      group: null,
      sub: null,
      region: null,
    });
  });

  it("falls back to first group/sub/region when selection is null", () => {
    const resolved = resolveSelection(groups, { groupKey: null, subName: null, regionName: null });
    expect(resolved.group?.key).toBe("movie");
    expect(resolved.sub?.name).toBe("全部");
    expect(resolved.region?.name).toBe("全部");
  });

  it("resolves an explicit matching selection", () => {
    const resolved = resolveSelection(groups, { groupKey: "movie", subName: "喜剧", regionName: "美国" });
    expect(resolved.sub?.name).toBe("喜剧");
    expect(resolved.region?.name).toBe("美国");
  });

  it("resets sub and region to the new group's first option when names do not exist there", () => {
    // Selection still carries movie-group names, but the group switched to "show".
    // 选择仍带着电影分组的名称, 但分组已切到「综艺」.
    const resolved = resolveSelection(groups, { groupKey: "show", subName: "喜剧", regionName: "美国" });
    expect(resolved.group?.key).toBe("show");
    expect(resolved.sub?.name).toBe("综艺");
    expect(resolved.region).toBeNull();
  });

  it("resolves region to null for a group without regions", () => {
    const resolved = resolveSelection(groups, { groupKey: "show", subName: null, regionName: null });
    expect(resolved.region).toBeNull();
  });

  it("falls back to the first group when groupKey is unknown", () => {
    const resolved = resolveSelection(groups, { groupKey: "nope", subName: null, regionName: null });
    expect(resolved.group?.key).toBe("movie");
  });
});

describe("resolveRecommendFilter", () => {
  it("returns an empty kind when group is null (disables the query)", () => {
    expect(resolveRecommendFilter({ group: null, sub: null, region: null })).toEqual({
      kind: "",
      tag: "",
      format: "",
      region: "",
    });
  });

  it("uses group kind and group format when the sub-category has no kind", () => {
    const resolved = resolveSelection(groups, { groupKey: "movie", subName: "喜剧", regionName: "美国" });
    expect(resolveRecommendFilter(resolved)).toEqual({
      kind: "movie",
      tag: "喜剧",
      format: "",
      region: "美国",
    });
  });

  it("uses the sub-category kind and format when the sub-category carries its own kind", () => {
    const resolved = resolveSelection(groups, { groupKey: "show", subName: "综艺", regionName: null });
    expect(resolveRecommendFilter(resolved)).toEqual({
      kind: "tv",
      tag: "综艺",
      format: "show",
      region: "",
    });
  });

  it("yields an empty format when the sub-category has a kind but a blank format", () => {
    const resolved = resolveSelection(groups, { groupKey: "show", subName: "纪录片", regionName: null });
    // sub has kind "tv" so format follows the sub (""), NOT the group format ("tv").
    // 子分类自带 kind "tv", 因此 format 跟随子分类 (""), 而非分组 format ("tv").
    expect(resolveRecommendFilter(resolved)).toMatchObject({ kind: "tv", format: "" });
  });

  it("treats a present-but-empty sub kind as 'has kind' (iOS != nil parity), overriding group format", () => {
    const group: CategoryGroup = {
      key: "g",
      name: "G",
      douban_kind: "movie",
      format: "groupfmt",
      // kind is present but empty: iOS `sub?.kind != nil` is true, so format follows the sub ("subfmt").
      // kind 存在但为空: iOS `sub?.kind != nil` 为真, 因此 format 跟随子分类 ("subfmt").
      subcategories: [{ name: "S", tag: "t", kind: "", format: "subfmt" }],
      regions: [],
    };
    const resolved = resolveSelection([group], { groupKey: "g", subName: "S", regionName: null });
    expect(resolveRecommendFilter(resolved).format).toBe("subfmt");
  });

  it("defaults tag to empty and format to the group format when no sub-category exists", () => {
    const emptyGroup: CategoryGroup = {
      key: "x",
      name: "X",
      douban_kind: "movie",
      format: "groupfmt",
      subcategories: [],
      regions: [],
    };
    const resolved = resolveSelection([emptyGroup], { groupKey: "x", subName: null, regionName: null });
    expect(resolved.sub).toBeNull();
    expect(resolveRecommendFilter(resolved)).toEqual({
      kind: "movie",
      tag: "",
      format: "groupfmt",
      region: "",
    });
  });
});
