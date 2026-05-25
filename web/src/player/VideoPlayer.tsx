/**
 * VideoPlayer — HLS video player component backed by hls.js for non-native browsers.
 * VideoPlayer — HLS 视频播放组件, 在不支持原生 HLS 的浏览器中使用 hls.js.
 *
 * Responsibilities / 职责:
 *   - Choose the playback engine via choosePlaybackEngine() (native HLS → hls.js → unsupported).
 *     通过 choosePlaybackEngine() 选择播放引擎 (原生 HLS → hls.js → 不支持).
 *   - For "native" engine: set video.src directly; the browser negotiates HLS natively.
 *     "native" 引擎: 直接设置 video.src; 浏览器原生协商 HLS.
 *   - For "hlsjs" engine: dynamically import hls.js, attach to the <video> ref, and destroy on cleanup.
 *     "hlsjs" 引擎: 动态导入 hls.js, 附加到 <video> ref, cleanup 时销毁.
 *   - Surface fatal HLS errors as inline error text.
 *     将致命 HLS 错误以内联错误文本形式显示.
 *   - Show a placeholder when url is null (no episode selected).
 *     url 为 null 时显示占位符 (未选择剧集).
 *
 * Key exports / 主要导出:
 *   VideoPlayer
 *
 * Callers / 调用方:
 *   viewer/playback/PlaybackPanel.tsx (passes the resolved HLS proxy URL)
 *
 * ADR-013 LOCKED — ArtPlayer is the approved Web playback shell.
 * NOTE: This file is a lower-level hls.js adapter and is NOT the ArtPlayer wrapper itself.
 * The ArtPlayer boundary lives in viewer/playback/PlaybackPanel.tsx which uses ArtPlayer
 * with customType.m3u8 backed by hls.js.  Do NOT replace this component, remove hls.js,
 * or change the exported API surface without architect approval.
 * ADR-013 锁定 — ArtPlayer 是已批准的 Web 播放外壳.
 * 注意: 此文件是较低层级的 hls.js 适配器, 并非 ArtPlayer 封装本身.
 * ArtPlayer 边界在 viewer/playback/PlaybackPanel.tsx 中, 它通过 customType.m3u8 使用 ArtPlayer + hls.js.
 * 未经架构师批准不得替换此组件、移除 hls.js 或更改导出的 API 接口.
 *
 * VideoPlayer init flow (for reference):
 *   1. PlaybackPanel resolves the playback URL via api.playbackURL() and may mount VideoPlayer
 *      for the native/hlsjs path outside the ArtPlayer boundary.
 *   2. VideoPlayer receives `url` as a prop.
 *   3. useEffect runs: choosePlaybackEngine() selects "native" | "hlsjs" | "unsupported".
 *   4a. "native": video.src = url — Safari / iOS handle HLS natively via AppleCoreMedia.
 *   4b. "hlsjs": dynamic import("hls.js") → Hls.loadSource(url) → Hls.attachMedia(video).
 *   5. On cleanup (url change or unmount): disposed flag prevents late async callbacks;
 *      hls.destroy() reclaims media resources.
 *
 * AppleCoreMedia caveat (ADR-004):
 *   AVPlayer / AppleCoreMedia does NOT share the browser's cookie jar or Authorization header.
 *   The native engine path is only reached in Safari where the browser itself is the HLS parser.
 *   React Web playback uses URL-bound media tokens so proxy URLs are auth-free after resolution.
 *   AppleCoreMedia 注意事项 (ADR-004):
 *   AVPlayer / AppleCoreMedia 不共享浏览器的 cookie jar 或 Authorization header.
 *   原生引擎路径仅在 Safari 中触发, 此时浏览器自身作为 HLS 解析器.
 *   React Web 播放使用 URL 绑定的媒体 token, 解析后代理 URL 无需认证.
 *
 * Why excluded from vitest:
 *   - hls.js requires a real HTMLMediaElement with MediaSource API support.
 *   - happy-dom stubs HTMLVideoElement but does not implement MediaSource, so Hls.isSupported()
 *     returns false and the dynamic import path cannot be exercised faithfully.
 *   - ArtPlayer itself has a DOM event loop that conflicts with the test environment.
 *   - The component is therefore listed in vitest.config.ts coverage exclude:
 *     "src/player/VideoPlayer.tsx".
 *   为何从 vitest 中排除:
 *   - hls.js 需要真实的 HTMLMediaElement 与 MediaSource API 支持.
 *   - happy-dom 仅 stub HTMLVideoElement, 未实现 MediaSource, 导致 Hls.isSupported() 返回 false,
 *     动态 import 路径无法被真实执行.
 *   - ArtPlayer 本身具有与测试环境冲突的 DOM 事件循环.
 *   - 因此该组件在 vitest.config.ts 的覆盖率 exclude 中列出:
 *     "src/player/VideoPlayer.tsx".
 */
import { useEffect, useRef, useState } from "react";

import { choosePlaybackEngine } from "./playback";

/**
 * VideoPlayer props.
 * VideoPlayer 属性.
 *
 * @param url - The resolved HLS proxy URL, or null when no episode is selected.
 *              解析后的 HLS 代理 URL, 未选择剧集时为 null.
 */
export function VideoPlayer({ url }: { url: string | null }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    // Nothing to mount yet — url arrives when the viewer selects an episode.
    // 尚无 url — url 在观看者选择剧集后才到达.
    if (!video || !url) {
      return;
    }

    setError(null);
    // Probe engine capabilities at runtime; canPlayType is the standard browser API
    // for HLS MIME type negotiation (returns "" when unsupported).
    // 运行时探测引擎能力; canPlayType 是 HLS MIME 类型协商的标准浏览器 API
    // (不支持时返回 "").
    const engine = choosePlaybackEngine({
      canPlayNativeHLS: () => video.canPlayType("application/vnd.apple.mpegurl") !== "",
      // hlsSupported is always true here; the actual Hls.isSupported() check runs inside the
      // dynamic import to avoid importing the 300 KB bundle when native HLS is available.
      // hlsSupported 此处始终为 true; 实际的 Hls.isSupported() 检查在动态 import 内部运行,
      // 以避免在原生 HLS 可用时引入 300 KB 的包.
      hlsSupported: () => true,
    });

    if (engine === "native") {
      // Safari / iOS handle HLS natively; AppleCoreMedia reads the MIME type directly.
      // Safari / iOS 原生处理 HLS; AppleCoreMedia 直接读取 MIME 类型.
      video.src = url;
      return;
    }

    if (engine === "hlsjs") {
      // `disposed` prevents a stale async callback from calling setError after the effect is cleaned up
      // (e.g. when the user switches episodes before the dynamic import resolves).
      // `disposed` 防止异步回调在 effect 清理后调用 setError
      // (例如用户在动态 import 解析前切换剧集).
      let disposed = false;
      let cleanup: (() => void) | undefined;

      void import("hls.js").then(({ default: Hls }) => {
        if (disposed) {
          return;
        }
        if (!Hls.isSupported()) {
          // MediaSource API unavailable — browser cannot play HLS via hls.js.
          // MediaSource API 不可用 — 浏览器无法通过 hls.js 播放 HLS.
          setError("This browser cannot play HLS streams.");
          return;
        }

        const hls = new Hls();
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_, data) => {
          // Only fatal errors need user-visible feedback; recoverable errors are handled internally by hls.js.
          // 只有致命错误需要显示给用户; 可恢复错误由 hls.js 内部处理.
          if (data.fatal) {
            setError("Playback failed. Try another source.");
          }
        });
        cleanup = () => hls.destroy();
      });

      return () => {
        // Signal the async callback that this render cycle is gone, then run sync cleanup.
        // 通知异步回调此渲染周期已结束, 然后运行同步清理.
        disposed = true;
        cleanup?.();
      };
    }

    // "unsupported" engine — neither native HLS nor hls.js MediaSource available.
    // "unsupported" 引擎 — 原生 HLS 和 hls.js MediaSource 均不可用.
    setError("This browser cannot play HLS streams.");
  }, [url]);

  return (
    <section className="player-panel" aria-label="Player">
      {url ? (
        <video ref={videoRef} className="player" controls playsInline />
      ) : (
        <div className="player-placeholder">Select an episode to start playback.</div>
      )}
      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
}
