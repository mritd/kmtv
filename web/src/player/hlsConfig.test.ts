/**
 * hlsConfig.test.ts — locks the buffer tuning values and their invariants.
 * hlsConfig.test.ts — 锁定缓冲调优值及其不变量.
 *
 * These values are load-bearing: hls.js caps the forward buffer at
 * `maxBufferLength` whenever the upstream playlist declares no BANDWIDTH,
 * which is the common case for this project's sources.
 * 这些值很关键: 上游 playlist 未声明 BANDWIDTH 时 (本项目源的常见情况),
 * hls.js 会把前向缓冲限制在 maxBufferLength.
 */
import { describe, expect, it } from "vitest";

import { HLS_BUFFER_CONFIG } from "./hlsConfig";

describe("HLS_BUFFER_CONFIG", () => {
  it("targets a 300 second forward buffer", () => {
    expect(HLS_BUFFER_CONFIG.maxBufferLength).toBe(300);
  });

  it("bounds the back buffer so it cannot starve the forward buffer of MSE quota", () => {
    expect(HLS_BUFFER_CONFIG.backBufferLength).toBe(60);
    expect(Number.isFinite(HLS_BUFFER_CONFIG.backBufferLength)).toBe(true);
  });

  it("prefetches the first fragment to cut one round-trip from startup", () => {
    expect(HLS_BUFFER_CONFIG.startFragPrefetch).toBe(true);
  });

  it("raises maxBufferSize for master-playlist sources where the bitrate branch runs", () => {
    expect(HLS_BUFFER_CONFIG.maxBufferSize).toBe(200 * 1000 * 1000);
  });

  // hls.js applies Math.min(maxBufLen, maxMaxBufferLength) unconditionally,
  // so a maxMaxBufferLength below maxBufferLength would silently clamp it.
  // hls.js 无条件执行 Math.min(maxBufLen, maxMaxBufferLength),
  // 因此 maxMaxBufferLength 低于 maxBufferLength 会静默夹住后者.
  it("keeps maxMaxBufferLength above maxBufferLength so it never silently clamps", () => {
    expect(HLS_BUFFER_CONFIG.maxMaxBufferLength).toBe(600);
    expect(HLS_BUFFER_CONFIG.maxMaxBufferLength).toBeGreaterThan(HLS_BUFFER_CONFIG.maxBufferLength);
  });
});
