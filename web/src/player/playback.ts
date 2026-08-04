/**
 * playback — pure engine-selection logic for HLS video playback.
 * playback — HLS 视频播放的纯引擎选择逻辑.
 *
 * Responsibilities / 职责:
 *   - Expose a capability-injection interface (PlaybackCapabilities) that allows the selection
 *     logic to be tested without a real browser environment.
 *     暴露能力注入接口 (PlaybackCapabilities), 允许在无真实浏览器环境下测试选择逻辑.
 *   - Implement the priority order: hls.js > native HLS > unsupported.
 *     实现优先级顺序: hls.js > 原生 HLS > 不支持.
 *
 * Key exports / 主要导出:
 *   PlaybackEngine, PlaybackCapabilities, choosePlaybackEngine, hasMediaSourceSupport
 *
 * Callers / 调用方:
 *   player/VideoPlayer.tsx, viewer/playback/PlaybackPanel.tsx
 *
 * NOTE: choosePlaybackEngine is pure logic (no DOM, no React, no side-effects) and is
 * fully testable in vitest. hasMediaSourceSupport reads `window` and is therefore the
 * one impure export; it is a thin feature probe with no branching of its own.
 * 注意: choosePlaybackEngine 是纯逻辑 (无 DOM, 无 React, 无副作用), 可在 vitest 中完整测试.
 * hasMediaSourceSupport 会读取 `window`, 是唯一的非纯导出; 它只是一个特性探针, 自身无分支逻辑.
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
 * Priority: hlsjs > native > unsupported. This is the order hls.js itself recommends.
 * 优先级: hlsjs > native > unsupported. 这也是 hls.js 官方推荐的顺序.
 *
 * This used to prefer native, on the assumption that only Apple WebKit returns a
 * non-empty string from canPlayType("application/vnd.apple.mpegurl"). That is no
 * longer true — Chrome 151 on macOS returns "maybe" — so the probe can no longer
 * identify Apple WebKit, and Chrome silently took the native path. Native playback
 * exposes no buffer controls at all, so every buffer setting in hlsConfig.ts was
 * bypassed there. Native is now strictly the fallback for browsers without
 * MediaSource (notably iPhone Safari), which keeps AppleCoreMedia integration
 * exactly where it is the only option.
 * 此前优先 native, 前提假设是只有 Apple WebKit 会让
 * canPlayType("application/vnd.apple.mpegurl") 返回非空字符串. 该假设已不成立 —
 * macOS 上的 Chrome 151 会返回 "maybe" — 因此该探针无法再识别 Apple WebKit,
 * Chrome 会静默走 native. 原生播放完全不暴露缓冲控制, 于是 hlsConfig.ts 里的
 * 所有缓冲设置在这条路径上都被绕过. 现在 native 严格作为无 MediaSource 浏览器
 * (主要是 iPhone Safari) 的兜底, 从而把 AppleCoreMedia 集成保留在它是唯一选择的场合.
 *
 * @param capabilities - Runtime capability probes; injected for testability.
 *                       运行时能力探针; 注入以支持可测试性.
 * @returns The selected PlaybackEngine variant.
 *          返回选择的 PlaybackEngine 变体.
 */
export function choosePlaybackEngine(capabilities: PlaybackCapabilities): PlaybackEngine {
  // hls.js first: it is the only path where buffer sizing is under our control.
  // hls.js 优先: 只有这条路径的缓冲大小由我们控制.
  if (capabilities.hlsSupported()) {
    return "hlsjs";
  }

  // Native is the fallback for browsers without MediaSource (iPhone Safari).
  // 原生作为无 MediaSource 浏览器 (iPhone Safari) 的兜底.
  if (capabilities.canPlayNativeHLS()) {
    return "native";
  }

  return "unsupported";
}

/**
 * hasMediaSourceSupport reports whether hls.js has a usable MediaSource backend.
 * hasMediaSourceSupport 判断 hls.js 是否有可用的 MediaSource 后端.
 *
 * This is a cheap stand-in for Hls.isSupported(), which cannot be called before the
 * ~300 KB bundle is dynamically imported — and the engine choice has to happen first.
 * ManagedMediaSource is included because iOS 17.1+ exposes only that variant.
 * Callers must still honour the real Hls.isSupported() once the bundle resolves.
 * 这是 Hls.isSupported() 的廉价替身: 后者必须等 ~300 KB 的包动态导入之后才能调用,
 * 而引擎选择必须发生在那之前. 纳入 ManagedMediaSource 是因为 iOS 17.1+ 只暴露该变体.
 * 调用方在包加载完成后仍须遵从真正的 Hls.isSupported() 结果.
 */
export function hasMediaSourceSupport(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  // Indexed access rather than `window.MediaSource`: ManagedMediaSource is not in
  // TypeScript's DOM lib, and MediaSource is declared as a global rather than a
  // Window member, so neither is reachable through the typed Window interface.
  // 使用索引访问而非 `window.MediaSource`: ManagedMediaSource 不在 TypeScript 的
  // DOM lib 中, 而 MediaSource 声明为全局变量而非 Window 成员,
  // 两者都无法通过带类型的 Window 接口访问.
  const scope = window as unknown as Record<string, unknown>;
  return typeof scope.MediaSource !== "undefined" || typeof scope.ManagedMediaSource !== "undefined";
}
