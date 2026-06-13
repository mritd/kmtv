// categoriesStore tests cover MMKV-persisted selection, per-server isolation, group reset rule.
// categoriesStore 测试覆盖 MMKV 持久化选择、按服务器隔离、切换分组重置规则.

import { _resetForTests } from "@/storage/mmkv";

import { categoriesStore } from "./categoriesStore";

describe("categoriesStore", () => {
  beforeEach(() => {
    _resetForTests();
    categoriesStore.getState().resetAll();
  });

  it("starts with null selection (no server bound yet)", () => {
    const s = categoriesStore.getState();
    expect(s.groupKey).toBeNull();
    expect(s.subName).toBeNull();
    expect(s.regionName).toBeNull();
  });

  it("selectGroup with a new key clears sub + region", () => {
    categoriesStore.getState().hydrate("https://a.test");
    categoriesStore.getState().selectGroup("movie");
    categoriesStore.getState().selectSub("热门");
    categoriesStore.getState().selectRegion("华语");

    categoriesStore.getState().selectGroup("tv");
    const s = categoriesStore.getState();
    expect(s.groupKey).toBe("tv");
    expect(s.subName).toBeNull();
    expect(s.regionName).toBeNull();
  });

  it("re-selecting current group is a no-op (preserves sub/region)", () => {
    categoriesStore.getState().hydrate("https://a.test");
    categoriesStore.getState().selectGroup("movie");
    categoriesStore.getState().selectSub("热门");
    categoriesStore.getState().selectGroup("movie");
    expect(categoriesStore.getState().subName).toBe("热门");
  });

  it("hydrate(serverURL) loads from MMKV, then mutations write back", () => {
    categoriesStore.getState().hydrate("https://a.test");
    categoriesStore.getState().selectGroup("movie");
    categoriesStore.getState().selectSub("热门");

    categoriesStore.setState({ groupKey: null, subName: null, regionName: null, serverURL: null });
    categoriesStore.getState().hydrate("https://a.test");
    const s = categoriesStore.getState();
    expect(s.groupKey).toBe("movie");
    expect(s.subName).toBe("热门");
  });

  it("hydrate isolates state per server URL", () => {
    categoriesStore.getState().hydrate("https://a.test");
    categoriesStore.getState().selectGroup("movie");

    categoriesStore.getState().hydrate("https://b.test");
    expect(categoriesStore.getState().groupKey).toBeNull();

    categoriesStore.getState().hydrate("https://a.test");
    expect(categoriesStore.getState().groupKey).toBe("movie");
  });

  it("resetAll clears in-memory and MMKV slot for current server", () => {
    categoriesStore.getState().hydrate("https://a.test");
    categoriesStore.getState().selectGroup("movie");
    categoriesStore.getState().resetAll();

    expect(categoriesStore.getState().groupKey).toBeNull();
    categoriesStore.setState({ groupKey: "ghost", subName: null, regionName: null, serverURL: null });
    categoriesStore.getState().hydrate("https://a.test");
    expect(categoriesStore.getState().groupKey).toBeNull();
  });
});
