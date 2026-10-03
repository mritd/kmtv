/**
 * syncClock tests cover per-record increasing event times and server offset estimation.
 *
 * syncClock 测试覆盖按记录递增的事件时间与服务端时间差估算.
 */
import { describe, expect, it } from "vitest";

import { createSyncClock } from "./syncClock";

describe("createSyncClock", () => {
  it("beats the previous event time of the same record even when the wall clock stands still", () => {
    const clock = createSyncClock(0, () => 1_000);
    expect(clock.next()).toBe(1_000);
    expect(clock.next(1_000)).toBe(1_001);
    expect(clock.next(5_000)).toBe(5_001);
    expect(clock.next(10)).toBe(1_000);
  });

  it("aligns to the server using the request midpoint", () => {
    let wall = 10_000;
    const clock = createSyncClock(0, () => wall);
    clock.observe(15_100, 10_000, 10_200);
    expect(clock.offsetMs()).toBe(5_000);
    wall = 10_300;
    expect(clock.next()).toBe(15_300);
  });

  it("stays monotonic per record when the offset moves backwards", () => {
    let wall = 10_000;
    const clock = createSyncClock(5_000, () => wall);
    const first = clock.next();
    expect(first).toBe(15_000);
    clock.observe(9_000, 10_000, 10_000);
    wall = 10_001;
    expect(clock.next()).toBe(9_001);
    expect(clock.next(first)).toBe(15_001);
  });

  it("ignores invalid observations", () => {
    const clock = createSyncClock(42, () => 0);
    clock.observe(Number.NaN, 0, 10);
    clock.observe(0, 0, 10);
    clock.observe(5_000, 20, 10);
    expect(clock.offsetMs()).toBe(42);
  });
});
