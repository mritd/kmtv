// listPerf constants smoke tests; lock spec-derived values to prevent silent regressions.
// listPerf 常量冒烟测试, 锁定 spec 派生值, 防止静默回归.

import { LIST_PERF_DEFAULT, LIST_PERF_GRID, LIST_PERF_HORIZONTAL } from "./listPerf";

describe("listPerf constants", () => {
  it("default list spreads Android-safe perf knobs", () => {
    expect(LIST_PERF_DEFAULT).toEqual({
      removeClippedSubviews: true,
      windowSize: 5,
      initialNumToRender: 10,
      maxToRenderPerBatch: 8,
      updateCellsBatchingPeriod: 50,
    });
  });

  it("grid variant raises initial render to fill the screen", () => {
    expect(LIST_PERF_GRID.initialNumToRender).toBe(15);
    expect(LIST_PERF_GRID.removeClippedSubviews).toBe(true);
  });

  it("horizontal variant keeps a wider window for paging swipe", () => {
    expect(LIST_PERF_HORIZONTAL.windowSize).toBe(7);
    expect(LIST_PERF_HORIZONTAL.removeClippedSubviews).toBe(true);
  });
});
