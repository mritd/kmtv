/**
 * storage/watchHistoryClock.test.ts - shared watch-history event clock regression coverage.
 *
 * storage/watchHistoryClock.test.ts - 共享观看历史事件时钟回归覆盖.
 *
 * Responsibilities / 职责:
 *   - Verify same-millisecond calls still receive strictly increasing timestamps
 *
 *     - 验证同一毫秒内的调用仍获得严格递增的时间戳
 *
 * Callers / 调用方:
 *   Vitest test runner - Vitest 测试运行器
 */

import { describe, expect, it, vi } from "vitest";

import { nextWatchHistoryEventTime } from "./watchHistoryClock";

describe("watchHistoryClock", () => {
  it("generates strictly increasing event times within one mocked millisecond", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_808_000_100_000);

    const first = nextWatchHistoryEventTime();
    const second = nextWatchHistoryEventTime();

    expect(second).toBe(first + 1);

    vi.restoreAllMocks();
  });
});
