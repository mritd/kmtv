/**
 * playback.test.ts — full TDD coverage for player/playback.ts pure helpers.
 *
 * playback.test.ts — player/playback.ts 纯辅助函数的完整 TDD 覆盖.
 *
 * All tests use controlled PlaybackCapabilities stubs so no real browser APIs are needed.
 *
 * 所有测试使用受控的 PlaybackCapabilities stub, 无需真实浏览器 API.
 *
 * NOTE: VideoPlayer.tsx itself is excluded from vitest (needs real MediaSource / hls.js DOM).
 * These tests cover the pure selection logic that VideoPlayer delegates to.
 *
 * 注意: VideoPlayer.tsx 本身从 vitest 中排除 (需要真实的 MediaSource / hls.js DOM).
 * 这些测试覆盖 VideoPlayer 委托的纯选择逻辑.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  choosePlaybackEngine,
  hasManagedMediaSourceOnly,
  hasMediaSourceSupport,
  type PlaybackCapabilities,
  type PlaybackEngine,
} from "./playback";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a PlaybackCapabilities stub with controlled boolean flags.
 *
 * 构造一个由布尔标记控制的 PlaybackCapabilities stub.
 */
function caps(native: boolean, hls: boolean, managedOnly = false): PlaybackCapabilities {
  return {
    canPlayNativeHLS: () => native,
    hlsSupported: () => hls,
    managedBufferOnly: () => managedOnly,
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
    //
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
      //
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

  describe("when ManagedMediaSource is the only backend", () => {
    // iPhone WebKit. hls.js reports itself supported here, so the plain "hls.js wins"
    // rule sent playback down a path where ManagedMediaSource gives WebKit the buffer:
    // measured on an iOS 18.7 simulator, the forward buffer peaked at 38.6s and fell
    // back to ~10s, against 139.4s held by native playback on the same stream. hls.js
    // also forces disableRemotePlayback there, which turns AirPlay off.
    //
    // iPhone WebKit. hls.js 在这里报告自己可用, 于是 "hls.js 优先" 的简单规则
    // 把播放送上了 ManagedMediaSource 让 WebKit 掌控缓冲的路径:
    // 在 iOS 18.7 模拟器上实测, 前向缓冲峰值 38.6s 并回落到约 10s,
    // 而同一条流的原生播放稳定在 139.4s. 该路径下 hls.js 还会强制
    // disableRemotePlayback, 从而关闭 AirPlay.
    it("prefers native playback even though hls.js reports itself supported", () => {
      const engine = choosePlaybackEngine(caps(true, true, true));
      expect(engine).toBe("native" satisfies PlaybackEngine);
    });

    it("still uses hls.js when the platform cannot play HLS natively", () => {
      // Managed-only without native HLS is not a shipping platform today, but the
      // fallback has to degrade to something playable rather than to "unsupported".
      //
      // 只有 managed 且无原生 HLS 的平台目前并不存在, 但兜底必须退到可播放的选项,
      // 而不是退成 "unsupported".
      const engine = choosePlaybackEngine(caps(false, true, true));
      expect(engine).toBe("hlsjs" satisfies PlaybackEngine);
    });

    it("keeps hls.js on platforms that expose a full MediaSource as well", () => {
      // iPad and macOS Safari expose both, and there hls.js keeps buffer control.
      //
      // iPad 与 macOS Safari 两者都暴露, 那里 hls.js 仍掌握缓冲控制权.
      const engine = choosePlaybackEngine(caps(true, true, false));
      expect(engine).toBe("hlsjs" satisfies PlaybackEngine);
    });
  });

  describe("capability probe isolation", () => {
    it("does not consult canPlayNativeHLS when hls.js wins", () => {
      // Verify the short-circuit: canPlayNativeHLS should not be called when hlsjs wins.
      //
      // 验证短路: hlsjs 胜出时 canPlayNativeHLS 不应被调用.
      let nativeCallCount = 0;
      const engine = choosePlaybackEngine({
        canPlayNativeHLS: () => { nativeCallCount++; return true; },
        hlsSupported: () => true,
        managedBufferOnly: () => false,
      });
      expect(engine).toBe("hlsjs");
      expect(nativeCallCount).toBe(0);
    });

    it("calls canPlayNativeHLS when hlsSupported returns false", () => {
      let nativeCallCount = 0;
      const engine = choosePlaybackEngine({
        canPlayNativeHLS: () => { nativeCallCount++; return true; },
        hlsSupported: () => false,
        managedBufferOnly: () => false,
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

describe("hasManagedMediaSourceOnly", () => {
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

  it("reports true for the iPhone WebKit signature", () => {
    // Confirmed on an iOS 18.7 simulator: typeof MediaSource is "undefined" and
    // typeof ManagedMediaSource is "function".
    //
    // 已在 iOS 18.7 模拟器确认: typeof MediaSource 为 "undefined",
    // typeof ManagedMediaSource 为 "function".
    delete w.MediaSource;
    setGlobal("ManagedMediaSource", function ManagedMediaSourceStub() {});
    expect(hasManagedMediaSourceOnly()).toBe(true);
  });

  it("reports false when a full MediaSource is also present (iPad, macOS Safari)", () => {
    setGlobal("MediaSource", function MediaSourceStub() {});
    setGlobal("ManagedMediaSource", function ManagedMediaSourceStub() {});
    expect(hasManagedMediaSourceOnly()).toBe(false);
  });

  it("reports false on browsers with no managed variant at all (Chrome)", () => {
    setGlobal("MediaSource", function MediaSourceStub() {});
    delete w.ManagedMediaSource;
    expect(hasManagedMediaSourceOnly()).toBe(false);
  });

  it("reports false when neither exists", () => {
    delete w.MediaSource;
    delete w.ManagedMediaSource;
    expect(hasManagedMediaSourceOnly()).toBe(false);
  });
});
