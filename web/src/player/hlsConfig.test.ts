/**
 * hlsConfig.test.ts — locks the buffer tuning values and their invariants.
 * hlsConfig.test.ts — 锁定缓冲调优值及其不变量.
 *
 * These values are load-bearing: hls.js caps the forward buffer at
 * `maxBufferLength` whenever the upstream playlist declares no BANDWIDTH,
 * which is the common case for this project's sources. `realBitrate` does not
 * rescue that case — hls.js only assigns it under `abrMaxWithRealBitrate`,
 * which defaults to false.
 * 这些值很关键: 上游 playlist 未声明 BANDWIDTH 时 (本项目源的常见情况),
 * hls.js 会把前向缓冲限制在 maxBufferLength. `realBitrate` 无法挽救这种情况 —
 * hls.js 仅在 `abrMaxWithRealBitrate` 下才为其赋值, 而该项默认为 false.
 */
import { describe, expect, it } from "vitest";

import { HLS_BUFFER_CONFIG } from "./hlsConfig";

/** Longest episode this project is expected to serve, in seconds. / 本项目预期承载的最长剧集时长, 单位秒. */
const FEATURE_LENGTH_EPISODE_SECONDS = 2797;

describe("HLS_BUFFER_CONFIG", () => {
  // The zero-bitrate branch of getMaxBufferLength is what actually runs for these
  // sources, so maxBufferLength alone decides the target. This was verified live:
  // at 300 the forward buffer sat at exactly 301s and stopped.
  // 这些源实际走的是 getMaxBufferLength 的零码率分支, 因此目标完全由 maxBufferLength 决定.
  // 该结论经线上实测验证: 取 300 时前向缓冲恰好停在 301s.
  it("targets a whole episode so the browser quota is what stops the buffer", () => {
    expect(HLS_BUFFER_CONFIG.maxBufferLength).toBe(3600);
    expect(HLS_BUFFER_CONFIG.maxBufferLength).toBeGreaterThanOrEqual(FEATURE_LENGTH_EPISODE_SECONDS);
  });

  // hls.js applies Math.min(maxBufLen, maxMaxBufferLength) unconditionally. If the
  // ceiling sat below maxBufferLength it would silently undo the value above, which
  // is exactly how a previous 600 capped the buffer at 10 minutes.
  // hls.js 无条件执行 Math.min(maxBufLen, maxMaxBufferLength).
  // 若上限低于 maxBufferLength, 就会静默抵消上面那个值 —
  // 此前取 600 时把缓冲卡在 10 分钟正是这么来的.
  it("keeps maxMaxBufferLength at the same target so it never clamps maxBufferLength", () => {
    expect(HLS_BUFFER_CONFIG.maxMaxBufferLength).toBe(3600);
    expect(HLS_BUFFER_CONFIG.maxMaxBufferLength).toBeGreaterThanOrEqual(
      HLS_BUFFER_CONFIG.maxBufferLength,
    );
  });

  // maxBufferSize cannot bind while the length floor equals the ceiling — the size
  // term only ever reaches getMaxBufferLength through Math.max(sizeTerm, maxBufferLength)
  // and is then clamped by the equal maxMaxBufferLength. Setting it would be dead
  // config that reads as if it were doing something.
  // 当长度下限等于上限时 maxBufferSize 无法生效: 体积项只能经由
  // Math.max(体积项, maxBufferLength) 进入 getMaxBufferLength, 随后又被相等的
  // maxMaxBufferLength 夹住. 设置它只会变成看似有用的死配置.
  it("omits maxBufferSize, which provably cannot bind at these length values", () => {
    expect("maxBufferSize" in HLS_BUFFER_CONFIG).toBe(false);
  });

  // hls.js defaults preferManagedMediaSource to true, and ManagedMediaSource gives the
  // buffer to WebKit — every length in this object becomes advisory the moment it is
  // chosen. Measured on one stream: Safari held 34.8s of forward buffer under the
  // default and 250.6s with it off; iPad went from ~35s to 159.6s.
  // hls.js 的 preferManagedMediaSource 默认为 true, 而 ManagedMediaSource
  // 把缓冲交给 WebKit — 一旦选中它, 本对象里的所有长度都沦为建议值.
  // 单条流实测: Safari 在默认值下前向缓冲为 34.8s, 关闭后为 250.6s;
  // iPad 从约 35s 提升到 159.6s.
  it("refuses ManagedMediaSource wherever a full MediaSource exists", () => {
    expect(HLS_BUFFER_CONFIG.preferManagedMediaSource).toBe(false);
  });

  it("bounds the back buffer so it cannot starve the forward buffer of MSE quota", () => {
    expect(HLS_BUFFER_CONFIG.backBufferLength).toBe(60);
    expect(Number.isFinite(HLS_BUFFER_CONFIG.backBufferLength)).toBe(true);
  });

  it("prefetches the first fragment to cut one round-trip from startup", () => {
    expect(HLS_BUFFER_CONFIG.startFragPrefetch).toBe(true);
  });
});
