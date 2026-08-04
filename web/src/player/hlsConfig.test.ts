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

  // maxBufferSize is the governing lever once hls.js has a bitrate to divide by,
  // which is almost immediately: these sources serve a master playlist declaring
  // BANDWIDTH, and level.maxBitrate also picks up the measured realBitrate.
  // maxBufferSize 在 hls.js 拿到可用于相除的码率后就是主控杆, 而这几乎是立刻发生的:
  // 这些源返回的是声明了 BANDWIDTH 的 master playlist,
  // 且 level.maxBitrate 还会采纳实测得到的 realBitrate.
  it("sizes maxBufferSize to cover a full episode so only the browser quota binds", () => {
    expect(HLS_BUFFER_CONFIG.maxBufferSize).toBe(400 * 1000 * 1000);

    // A measured 2797s episode at 948 kbps needs 332 MB. The size term must ask for
    // at least the whole episode, otherwise this config — not the browser — is the
    // limit on browsers whose quota would have allowed more.
    // 实测: 2797s 的剧集在 948 kbps 下需要 332 MB. 体积项必须至少要求整集,
    // 否则在配额本可支持更多的浏览器上, 限制就来自本配置而非浏览器.
    const measuredEpisodeBytes = (2797 * 948_000) / 8;
    expect(HLS_BUFFER_CONFIG.maxBufferSize).toBeGreaterThan(measuredEpisodeBytes);
  });

  // hls.js applies Math.min(maxBufLen, maxMaxBufferLength) unconditionally, so this
  // ceiling must stay clear of the largest target the size term can ask for —
  // otherwise it silently caps low-bitrate sources before the browser quota does.
  // hls.js 无条件执行 Math.min(maxBufLen, maxMaxBufferLength), 因此该上限必须高于
  // 体积项可能要求的最大目标, 否则会在浏览器配额生效之前就静默截断低码率源.
  it("keeps maxMaxBufferLength clear of the size-derived target so it never silently clamps", () => {
    expect(HLS_BUFFER_CONFIG.maxMaxBufferLength).toBe(3600);
    expect(HLS_BUFFER_CONFIG.maxMaxBufferLength).toBeGreaterThan(HLS_BUFFER_CONFIG.maxBufferLength);

    // A 1 Mbps source — the low end this project sees — derives 8 * maxBufferSize /
    // bitrate seconds from the size term. The ceiling must not cut that down.
    // 1 Mbps (本项目所见的低端码率) 下, 体积项推导出 8 * maxBufferSize / bitrate 秒.
    // 上限不得将其截断.
    const lowBitrateTarget = (8 * HLS_BUFFER_CONFIG.maxBufferSize) / 1_000_000;
    expect(HLS_BUFFER_CONFIG.maxMaxBufferLength).toBeGreaterThanOrEqual(lowBitrateTarget);
  });
});
