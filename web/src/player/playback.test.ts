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
import { afterEach, describe, expect, it } from "vitest";

import {
  choosePlaybackEngine,
  hasMediaSourceSupport,
  type PlaybackCapabilities,
  type PlaybackEngine,
} from "./playback";

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
  describe("when MediaSource is available", () => {
    // This is the regression case. Chrome 151 answers "maybe" to
    // canPlayType("application/vnd.apple.mpegurl"), so both probes report true.
    // Preferring native there routes playback around hls.js and silently discards
    // every setting in HLS_BUFFER_CONFIG, because native playback has no buffer API.
    // 这是回归用例. Chrome 151 对 canPlayType("application/vnd.apple.mpegurl")
    // 返回 "maybe", 因此两个探针都为 true.
    // 此时若优先 native, 播放就绕开了 hls.js, 并静默丢弃 HLS_BUFFER_CONFIG 的全部设置,
    // 因为原生播放没有缓冲 API.
    it("prefers hls.js even when the browser also claims native HLS support", () => {
      const engine = choosePlaybackEngine(caps(true, true));
      expect(engine).toBe("hlsjs" satisfies PlaybackEngine);
    });

    it("chooses hls.js when native HLS is NOT available", () => {
      const engine = choosePlaybackEngine(caps(false, true));
      expect(engine).toBe("hlsjs" satisfies PlaybackEngine);
    });
  });

  describe("when MediaSource is NOT available", () => {
    it("falls back to native HLS", () => {
      // iPhone Safari: no MediaSource, native HLS only. AppleCoreMedia integration
      // is preserved exactly where it is the only option.
      // iPhone Safari: 无 MediaSource, 只有原生 HLS.
      // AppleCoreMedia 集成恰好保留在它是唯一选择的场合.
      const engine = choosePlaybackEngine(caps(true, false));
      expect(engine).toBe("native" satisfies PlaybackEngine);
    });

    it("reports unsupported when neither native HLS nor MediaSource is available", () => {
      const engine = choosePlaybackEngine(caps(false, false));
      expect(engine).toBe("unsupported" satisfies PlaybackEngine);
    });
  });

  describe("capability probe isolation", () => {
    it("does not consult canPlayNativeHLS when hls.js wins", () => {
      // Verify the short-circuit: canPlayNativeHLS should not be called when hlsjs wins.
      // 验证短路: hlsjs 胜出时 canPlayNativeHLS 不应被调用.
      let nativeCallCount = 0;
      const engine = choosePlaybackEngine({
        canPlayNativeHLS: () => { nativeCallCount++; return true; },
        hlsSupported: () => true,
      });
      expect(engine).toBe("hlsjs");
      expect(nativeCallCount).toBe(0);
    });

    it("calls canPlayNativeHLS when hlsSupported returns false", () => {
      let nativeCallCount = 0;
      const engine = choosePlaybackEngine({
        canPlayNativeHLS: () => { nativeCallCount++; return true; },
        hlsSupported: () => false,
      });
      expect(engine).toBe("native");
      expect(nativeCallCount).toBe(1);
    });
  });
});

describe("hasMediaSourceSupport", () => {
  const w = window as unknown as Record<string, unknown>;
  const originalMediaSource = Object.getOwnPropertyDescriptor(window, "MediaSource");
  const originalManaged = Object.getOwnPropertyDescriptor(window, "ManagedMediaSource");

  function setGlobal(name: string, value: unknown) {
    Object.defineProperty(window, name, { value, configurable: true, writable: true });
  }

  function restore(name: string, descriptor: PropertyDescriptor | undefined) {
    if (descriptor) {
      Object.defineProperty(window, name, descriptor);
    } else {
      delete w[name];
    }
  }

  afterEach(() => {
    restore("MediaSource", originalMediaSource);
    restore("ManagedMediaSource", originalManaged);
  });

  it("reports true when MediaSource exists", () => {
    setGlobal("MediaSource", function MediaSourceStub() {});
    delete w.ManagedMediaSource;
    expect(hasMediaSourceSupport()).toBe(true);
  });

  it("reports true when only ManagedMediaSource exists (iOS 17.1+)", () => {
    delete w.MediaSource;
    setGlobal("ManagedMediaSource", function ManagedMediaSourceStub() {});
    expect(hasMediaSourceSupport()).toBe(true);
  });

  it("reports false when neither exists (iPhone Safari)", () => {
    delete w.MediaSource;
    delete w.ManagedMediaSource;
    expect(hasMediaSourceSupport()).toBe(false);
  });
});
