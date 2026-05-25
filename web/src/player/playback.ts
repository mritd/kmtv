/**
 * playback — pure engine-selection logic for HLS video playback.
 * playback — HLS 视频播放的纯引擎选择逻辑.
 *
 * Responsibilities / 职责:
 *   - Expose a capability-injection interface (PlaybackCapabilities) that allows the selection
 *     logic to be tested without a real browser environment.
 *     暴露能力注入接口 (PlaybackCapabilities), 允许在无真实浏览器环境下测试选择逻辑.
 *   - Implement the priority order: native HLS > hls.js > unsupported.
 *     实现优先级顺序: 原生 HLS > hls.js > 不支持.
 *
 * Key exports / 主要导出:
 *   PlaybackEngine, PlaybackCapabilities, choosePlaybackEngine
 *
 * Callers / 调用方:
 *   player/VideoPlayer.tsx (calls choosePlaybackEngine at mount time with live canPlayType results)
 *
 * NOTE: This module is pure logic (no DOM, no React, no side-effects).
 * It is fully testable in vitest without the vitest exclude workarounds needed by VideoPlayer.
 * 注意: 此模块是纯逻辑 (无 DOM, 无 React, 无副作用).
 * 无需 VideoPlayer 所需的 vitest exclude 即可完整测试.
 */

/**
 * PlaybackEngine identifies the HLS rendering strategy selected for the current browser.
 * PlaybackEngine 标识为当前浏览器选择的 HLS 渲染策略.
 *
 * - "native"      — browser parses HLS natively (Safari / iOS WebKit).
 *                   浏览器原生解析 HLS (Safari / iOS WebKit).
 * - "hlsjs"       — hls.js via MediaSource Extension is available.
 *                   通过 MediaSource Extension 使用 hls.js.
 * - "unsupported" — neither path is available; caller should display an error.
 *                   两条路径均不可用; 调用方应显示错误.
 */
export type PlaybackEngine = "native" | "hlsjs" | "unsupported";

/**
 * PlaybackCapabilities is a dependency-injection seam for browser feature detection.
 * PlaybackCapabilities 是浏览器特性检测的依赖注入接口.
 *
 * Pass live results from `video.canPlayType(...)` and `Hls.isSupported()` in production.
 * Pass controlled stubs in tests.
 * 生产中传入来自 `video.canPlayType(...)` 和 `Hls.isSupported()` 的实时结果.
 * 测试中传入受控 stub.
 */
export interface PlaybackCapabilities {
  /** Returns true when the browser can play HLS natively (e.g. Safari). / 浏览器能原生播放 HLS 时返回 true (如 Safari). */
  canPlayNativeHLS(): boolean;
  /** Returns true when hls.js MediaSource API is available. / hls.js MediaSource API 可用时返回 true. */
  hlsSupported(): boolean;
}

/**
 * choosePlaybackEngine selects the best available HLS playback strategy.
 * choosePlaybackEngine 选择最佳可用的 HLS 播放策略.
 *
 * Priority: native > hlsjs > unsupported.
 * Native HLS is preferred because it avoids loading the hls.js bundle (~300 KB gzipped)
 * and integrates with AppleCoreMedia system controls on Safari/iOS.
 * 优先级: native > hlsjs > unsupported.
 * 优先使用原生 HLS 以避免加载 hls.js 包 (~300 KB gzip), 并与 Safari/iOS 上的
 * AppleCoreMedia 系统控件集成.
 *
 * @param capabilities - Runtime capability probes; injected for testability.
 *                       运行时能力探针; 注入以支持可测试性.
 * @returns The selected PlaybackEngine variant.
 *          返回选择的 PlaybackEngine 变体.
 */
export function choosePlaybackEngine(capabilities: PlaybackCapabilities): PlaybackEngine {
  // Native HLS has highest priority: no bundle overhead, works with AppleCoreMedia.
  // 原生 HLS 优先级最高: 无包开销, 可与 AppleCoreMedia 配合使用.
  if (capabilities.canPlayNativeHLS()) {
    return "native";
  }

  // hls.js path requires MediaSource support; if available, prefer it over "unsupported".
  // hls.js 路径需要 MediaSource 支持; 若可用, 优先于 "unsupported".
  if (capabilities.hlsSupported()) {
    return "hlsjs";
  }

  return "unsupported";
}
