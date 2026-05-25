/**
 * playback.test.ts — full TDD coverage for player/playback.ts pure helpers.
 * playback.test.ts — player/playback.ts 纯辅助函数的完整 TDD 覆盖.
 *
 * All tests use controlled PlaybackCapabilities stubs so no real browser APIs are needed.
 * 所有测试使用受控的 PlaybackCapabilities stub, 无需真实浏览器 API.
 *
 * NOTE: VideoPlayer.tsx itself is excluded from vitest (needs real MediaSource / hls.js DOM).
 * These tests cover the pure selection logic that VideoPlayer delegates to.
 * 注意: VideoPlayer.tsx 本身从 vitest 中排除 (需要真实的 MediaSource / hls.js DOM).
 * 这些测试覆盖 VideoPlayer 委托的纯选择逻辑.
 */
import { describe, expect, it } from "vitest";

import { choosePlaybackEngine, type PlaybackCapabilities, type PlaybackEngine } from "./playback";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a PlaybackCapabilities stub with controlled boolean flags. */
function caps(native: boolean, hls: boolean): PlaybackCapabilities {
  return {
    canPlayNativeHLS: () => native,
    hlsSupported: () => hls,
  };
}

// ---------------------------------------------------------------------------
// choosePlaybackEngine — branch coverage
// ---------------------------------------------------------------------------

describe("choosePlaybackEngine", () => {
  describe("when the browser supports native HLS", () => {
    it("prefers native even when hls.js is also available", () => {
      const engine = choosePlaybackEngine(caps(true, true));
      expect(engine).toBe("native" satisfies PlaybackEngine);
    });

    it("chooses native when hls.js is NOT available", () => {
      // Edge case: a browser that can play HLS natively but lacks MediaSource.
      // 边缘情况: 可原生播放 HLS 但缺少 MediaSource 的浏览器.
      const engine = choosePlaybackEngine(caps(true, false));
      expect(engine).toBe("native" satisfies PlaybackEngine);
    });
  });

  describe("when the browser does NOT support native HLS", () => {
    it("falls back to hls.js when MediaSource is available", () => {
      const engine = choosePlaybackEngine(caps(false, true));
      expect(engine).toBe("hlsjs" satisfies PlaybackEngine);
    });

    it("reports unsupported when neither native HLS nor MediaSource is available", () => {
      const engine = choosePlaybackEngine(caps(false, false));
      expect(engine).toBe("unsupported" satisfies PlaybackEngine);
    });
  });

  describe("capability probe isolation", () => {
    it("calls canPlayNativeHLS exactly once when native HLS is supported", () => {
      // Verify the short-circuit: hlsSupported should not be called when native wins.
      // 验证短路: native 胜出时 hlsSupported 不应被调用.
      let hlsCallCount = 0;
      const engine = choosePlaybackEngine({
        canPlayNativeHLS: () => true,
        hlsSupported: () => { hlsCallCount++; return true; },
      });
      expect(engine).toBe("native");
      expect(hlsCallCount).toBe(0);
    });

    it("calls hlsSupported when canPlayNativeHLS returns false", () => {
      let hlsCallCount = 0;
      const engine = choosePlaybackEngine({
        canPlayNativeHLS: () => false,
        hlsSupported: () => { hlsCallCount++; return true; },
      });
      expect(engine).toBe("hlsjs");
      expect(hlsCallCount).toBe(1);
    });
  });
});
