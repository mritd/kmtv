/**
 * Tests for categoriesStore — browse-page filter selection store.
 * categoriesStore 测试 — 浏览页筛选选择 store.
 *
 * Covers: initial state, selectGroup reset semantics + same-key no-op, selectSub/selectRegion,
 * and reset().
 * 覆盖: 初始状态、selectGroup 重置语义 + 同 key 无操作、selectSub/selectRegion、reset().
 */

import { beforeEach, describe, expect, it } from "vitest";

import { categoriesStore } from "./categoriesStore";

beforeEach(() => {
  categoriesStore.getState().reset();
});

describe("categoriesStore", () => {
  it("starts with all selections null", () => {
    const s = categoriesStore.getState();
    expect(s.groupKey).toBeNull();
    expect(s.subName).toBeNull();
    expect(s.regionName).toBeNull();
  });

  it("selectGroup sets the group and clears sub + region", () => {
    categoriesStore.getState().selectSub("喜剧");
    categoriesStore.getState().selectRegion("美国");
    categoriesStore.getState().selectGroup("movie");
    const s = categoriesStore.getState();
    expect(s.groupKey).toBe("movie");
    expect(s.subName).toBeNull();
    expect(s.regionName).toBeNull();
  });

  it("selectGroup is a no-op when the key is unchanged (preserves sub/region)", () => {
    categoriesStore.getState().selectGroup("movie");
    categoriesStore.getState().selectSub("喜剧");
    categoriesStore.getState().selectRegion("美国");
    categoriesStore.getState().selectGroup("movie");
    const s = categoriesStore.getState();
    expect(s.subName).toBe("喜剧");
    expect(s.regionName).toBe("美国");
  });

  it("selectSub and selectRegion update only their field", () => {
    categoriesStore.getState().selectGroup("movie");
    categoriesStore.getState().selectSub("喜剧");
    categoriesStore.getState().selectRegion("美国");
    const s = categoriesStore.getState();
    expect(s.subName).toBe("喜剧");
    expect(s.regionName).toBe("美国");
  });

  it("reset clears every selection back to null", () => {
    categoriesStore.getState().selectGroup("movie");
    categoriesStore.getState().selectSub("喜剧");
    categoriesStore.getState().reset();
    const s = categoriesStore.getState();
    expect(s.groupKey).toBeNull();
    expect(s.subName).toBeNull();
    expect(s.regionName).toBeNull();
  });
});
