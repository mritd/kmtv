/**
 * PlaybackPanel — ArtPlayer host + playback state UI for the detail page.
 * PlaybackPanel — 详情页的 ArtPlayer 宿主 + 播放状态 UI.
 *
 * Responsibilities / 职责:
 *   - Mount and destroy ArtPlayer dynamically (see ADR-013) — 动态挂载和销毁 ArtPlayer (见 ADR-013)
 *   - Delegate HLS demuxing to hls.js when native HLS is unavailable — 原生 HLS 不可用时委托 hls.js 解码
 *   - Seek to persisted resume position after "video:loadedmetadata" — 元数据加载后 seek 到持久化恢复点
 *   - Throttle position saves (every 5 s) + flush on tab-hide / component teardown — 节流位置保存 (每 5 秒) + tab 隐藏/组件卸载时 flush
 *   - Surface HLS bundle-load / hls.js unsupported / fatal-error banners — 展示 HLS bundle 加载 / hls.js 不支持 / 致命错误横幅
 *   - Show placeholder when no URL is ready; resolving/idle copy differs — 无 URL 时显示占位符; resolving/idle 文案不同
 *   - Show state pills (source name + mode chip) — 显示状态 pill (源名称 + 模式 chip)
 *
 * ADR-013 LOCK — ArtPlayer is the required player; do NOT replace with a native <video> or other lib.
 * ADR-013 锁定 — ArtPlayer 是必需的播放器; 不得替换为原生 <video> 或其他库.
 *
 * Boundary note / 边界说明:
 *   VideoPlayer.tsx is the native <video> + hls.js adapter (no ArtPlayer).
 *   This file (PlaybackPanel.tsx) is the ArtPlayer boundary — the two are NOT interchangeable.
 *   VideoPlayer.tsx 是原生 <video> + hls.js 适配器 (无 ArtPlayer).
 *   本文件 (PlaybackPanel.tsx) 是 ArtPlayer 边界 — 两者不可互换.
 *
 * Callers / 调用方:
 *   viewer/detail/DetailPage.tsx
 *
 * Testing note / 测试说明:
 *   ArtPlayer is mocked via vi.mock("artplayer") in PlaybackPanel.test.tsx.
 *   hls.js is exercised only through the m3u8 customType callback, not mounted at unit-test level.
 *   ArtPlayer 在 PlaybackPanel.test.tsx 中通过 vi.mock("artplayer") 模拟.
 *   hls.js 仅通过 m3u8 customType 回调测试, 不在单元测试层面挂载.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/ui/Button";

import type { PlaybackState } from "./playbackState";

/**
 * POSITION_SAVE_INTERVAL_MS — throttle interval for persisting playback position.
 * POSITION_SAVE_INTERVAL_MS — 持久化播放进度的节流间隔.
 *
 * timeupdate fires ~4 Hz but we only need a coarse resume point;
 * 5 seconds is granular enough without hammering localStorage.
 * timeupdate 约 4 Hz 触发, 但只需粗粒度恢复点;
 * 5 秒间隔既足够精细又不会频繁写 localStorage.
 */
const POSITION_SAVE_INTERVAL_MS = 5000;

/**
 * RESUME_MIN_SEC — minimum persisted position required to apply an initial seek.
 * RESUME_MIN_SEC — 应用初始 seek 所需的最小持久化位置.
 *
 * Positions below this threshold are ignored to avoid jumping the user back
 * from a tiny earlier replay (e.g. the last 2 seconds of a cold-start).
 * 小于此阈值的位置被忽略, 避免用户从微小的早期重放被跳回
 * (例如冷启动的最后 2 秒).
 */
const RESUME_MIN_SEC = 3;

/**
 * stripEmoji — remove leading emoji/symbol pictographs from a source name.
 * stripEmoji — 去掉源名称前的 emoji/符号象形文字.
 *
 * Source names from upstream providers often include decorative emoji prefixes
 * (e.g. "🎬iKun资源"). The chip in the player state bar is compact; stripping
 * them keeps the label readable without truncation.
 * 上游提供商的源名称通常包含装饰性 emoji 前缀 (如 "🎬iKun资源").
 * 播放器状态栏中的 chip 空间有限; 去除后标签无需截断即可完整显示.
 *
 * @param value — raw source name or undefined — 原始源名称或 undefined
 * @returns     — trimmed name without emoji; "" when value is falsy — 去除 emoji 后的修剪名称; 当 value 为假值时返回 ""
 */
function stripEmoji(value: string | undefined): string {
  if (!value) return "";
  return value.replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\u{FE0F}\u{200D}]/gu, "").trim();
}

/**
 * PlaybackPanel — renders the ArtPlayer host container + all playback-state UI overlays.
 * PlaybackPanel — 渲染 ArtPlayer 宿主容器 + 所有播放状态 UI 覆盖层.
 *
 * @param state              — current PlaybackState from DetailPage's useReducer — DetailPage useReducer 的当前 PlaybackState
 * @param sourceName         — raw source name used for the state pill chip — 用于状态 pill chip 的原始源名称
 * @param onPlaying          — called when ArtPlayer fires "video:play" — ArtPlayer 触发 "video:play" 时调用
 * @param onRetry            — called when the user clicks any retry button — 用户点击任意重试按钮时调用
 * @param initialPositionSec — persisted resume position in seconds (optional) — 持久化恢复位置（秒, 可选）
 * @param onPositionChange   — called with (currentTime, duration) on throttled interval + teardown — 节流间隔 + 卸载时调用，参数为 (currentTime, duration)
 */
export function PlaybackPanel({
  state,
  sourceName,
  onPlaying,
  onRetry,
  initialPositionSec,
  onPositionChange,
}: {
  state: PlaybackState;
  sourceName?: string;
  onPlaying(): void;
  onRetry(): void;
  initialPositionSec?: number;
  onPositionChange?(positionSec: number, durationSec: number): void;
}) {
  const { t } = useTranslation("viewer");
  const playerRef = useRef<HTMLDivElement | null>(null);
  // Ref-pattern for callbacks that change frequently — avoids re-creating ArtPlayer on every render.
  // 回调频繁变化时使用 ref 模式 — 避免每次渲染都重建 ArtPlayer.
  const onPlayingRef = useRef(onPlaying);
  const onPositionChangeRef = useRef(onPositionChange);
  // initialPositionRef holds the latest requested resume point without triggering a player rebuild.
  // initialPositionRef 持有最新请求的恢复点, 不触发播放器重建.
  const initialPositionRef = useRef(initialPositionSec);
  const [playerError, setPlayerError] = useState<string | null>(null);
  // playerAttempt increments on retry to force the ArtPlayer useEffect to re-run.
  // playerAttempt 在重试时递增, 强制 ArtPlayer useEffect 重新运行.
  const [playerAttempt, setPlayerAttempt] = useState(0);
  const selectedName = state.selectedEpisode?.name ?? t("player.currentEpisodeFallback");

  useEffect(() => {
    onPlayingRef.current = onPlaying;
  }, [onPlaying]);
  useEffect(() => {
    onPositionChangeRef.current = onPositionChange;
  }, [onPositionChange]);
  // Keep the latest requested initial position available without re-creating the player.
  // 不重建播放器, 只是记录最新的恢复点.
  useEffect(() => {
    initialPositionRef.current = initialPositionSec;
  }, [initialPositionSec]);

  useEffect(() => {
    const container = playerRef.current;
    if (!container || !state.url) {
      // No-op when the URL is not yet resolved; ArtPlayer will be mounted once state.url is set.
      // URL 尚未解析时无操作; state.url 设置后将挂载 ArtPlayer.
      return;
    }

    let disposed = false;
    let cleanupArtPlayer: (() => void) | undefined;
    let cleanupHLS: (() => void) | undefined;
    let saveTimer: ReturnType<typeof setInterval> | undefined;
    // appliedInitialSeek guards a one-shot seek on "video:loadedmetadata".
    // appliedInitialSeek 在 "video:loadedmetadata" 时保护单次 seek.
    let appliedInitialSeek = false;
    setPlayerError(null);

    // Slot pattern: the artPlayer reference is assigned asynchronously after dynamic import.
    // Slot 模式: artPlayer 引用在动态 import 后异步赋值, 同时保留 effect 内同步访问.
    const artSlot: { player: import("artplayer").default | null } = { player: null };

    // Final-save handlers fire on tab hide / page unload so we don't lose progress when the user closes the tab.
    // pagehide / visibilitychange 在关闭 tab 时触发, 避免 5 秒间隔尚未到时丢进度.
    function flushNow() {
      const cb = onPositionChangeRef.current;
      const art = artSlot.player;
      if (!cb || !art) return;
      const currentTime = typeof art.currentTime === "number" ? art.currentTime : 0;
      const duration = typeof art.duration === "number" ? art.duration : 0;
      if (currentTime > 0) cb(currentTime, duration);
    }
    function onVisibility() {
      if (document.visibilityState === "hidden") flushNow();
    }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flushNow);

    void import("artplayer").then(({ default: ArtPlayer }) => {
      if (disposed) {
        // Cleanup beat the import — discard the instance to prevent a dangling ArtPlayer.
        // cleanup 先于 import 完成 — 丢弃实例以防悬挂的 ArtPlayer.
        return;
      }

      const art: import("artplayer").default = new ArtPlayer({
        container,
        url: state.url!,
        type: "m3u8",
        autoplay: true,
        playsInline: true,
        setting: true,
        hotkey: true,
        pip: true,
        fullscreen: true,
        fullscreenWeb: true,
        miniProgressBar: true,
        mutex: true,
        playbackRate: true,
        aspectRatio: true,
        customType: {
          m3u8: async (video, url) => {
            // Safari (and WKWebView on iOS/tvOS) supports HLS natively; skip hls.js when canPlayType returns a non-empty string.
            // Safari (及 iOS/tvOS 上的 WKWebView) 原生支持 HLS; canPlayType 返回非空字符串时跳过 hls.js.
            if (video.canPlayType("application/vnd.apple.mpegurl") !== "") {
              video.src = url;
              return;
            }

            let Hls: typeof import("hls.js").default;
            try {
              ({ default: Hls } = await import("hls.js"));
            } catch {
              // hls.js bundle failed to load (offline / CDN outage); surface a friendly error.
              // hls.js bundle 加载失败 (离线/CDN 中断); 展示友好错误.
              if (!disposed) {
                setPlayerError(t("player.errors.bundleLoadFailed"));
              }
              return;
            }
            if (disposed) {
              return;
            }
            if (!Hls.isSupported()) {
              // Browser has neither native HLS nor MediaSource API support (rare, but seen in some embedded webviews).
              // 浏览器既不支持原生 HLS 也不支持 MediaSource API (少见, 但某些嵌入式 webview 存在).
              setPlayerError(t("player.errors.noHlsSupport"));
              return;
            }

            const hls = new Hls();
            hls.loadSource(url);
            hls.attachMedia(video);
            hls.on(Hls.Events.ERROR, (_, data) => {
              // Only fatal errors require user intervention; recoverable errors are retried internally by hls.js.
              // 仅致命错误需要用户介入; 可恢复错误由 hls.js 内部重试.
              if (data.fatal) {
                setPlayerError(t("player.errors.playbackFatal"));
              }
            });
            cleanupHLS = () => hls.destroy();
          },
        },
      });
      artSlot.player = art;
      art.on("video:play", () => onPlayingRef.current());
      // Seek to the persisted position once metadata is available; happens before play starts.
      // 等元数据加载完后再 seek, 避免被覆盖.
      art.on("video:loadedmetadata", () => {
        if (appliedInitialSeek) return;
        appliedInitialSeek = true;
        const target = initialPositionRef.current;
        const duration = typeof art.duration === "number" && Number.isFinite(art.duration) ? art.duration : 0;
        // Only seek when target is meaningful and not within RESUME_MIN_SEC of the end.
        // 仅在 target 有意义且距结尾大于 RESUME_MIN_SEC 时 seek.
        if (typeof target === "number" && target >= RESUME_MIN_SEC && (duration === 0 || target < duration - RESUME_MIN_SEC)) {
          try {
            art.currentTime = target;
          } catch {
            // Some HLS streams disallow seeking until the first segment is buffered; fall back silently.
            // 某些 HLS 流首段缓冲完成前不允许 seek, 静默忽略.
          }
        }
      });
      saveTimer = setInterval(() => {
        const cb = onPositionChangeRef.current;
        if (!cb) return;
        const currentTime = typeof art.currentTime === "number" ? art.currentTime : 0;
        const duration = typeof art.duration === "number" ? art.duration : 0;
        if (currentTime > 0) {
          cb(currentTime, duration);
        }
      }, POSITION_SAVE_INTERVAL_MS);
      cleanupArtPlayer = () => {
        cleanupHLS?.();
        if (saveTimer) clearInterval(saveTimer);
        // Final save on teardown so route nav / refresh captures the latest position.
        // 卸载时再写一次, 确保跳走/刷新前的进度被保留.
        const cb = onPositionChangeRef.current;
        if (cb) {
          const currentTime = typeof art.currentTime === "number" ? art.currentTime : 0;
          const duration = typeof art.duration === "number" ? art.duration : 0;
          if (currentTime > 0) cb(currentTime, duration);
        }
        // destroy(false) tears down ArtPlayer internals without removing the host DOM element,
        // since React owns the <div> and will handle its removal.
        // destroy(false) 卸载 ArtPlayer 内部但不移除宿主 DOM 元素,
        // 因为 React 拥有该 <div> 并会处理其移除.
        art.destroy(false);
        container.replaceChildren();
      };
    }).catch(() => {
      // ArtPlayer dynamic import itself failed (extremely rare; usually a network issue).
      // ArtPlayer 动态 import 本身失败 (极少见; 通常是网络问题).
      if (!disposed) {
        setPlayerError(t("player.errors.playerInitFailed"));
      }
    });

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flushNow);
      cleanupArtPlayer?.();
      artSlot.player = null;
    };
  }, [state.url, playerAttempt]);

  function retryPlayer() {
    setPlayerError(null);
    // Incrementing playerAttempt is the only way to force the ArtPlayer useEffect to re-run
    // for the same URL (React skips re-running an effect with identical deps).
    // 递增 playerAttempt 是强制 ArtPlayer useEffect 对相同 URL 重新运行的唯一方式
    // (相同 deps 时 React 会跳过).
    setPlayerAttempt((attempt) => attempt + 1);
    onRetry();
  }

  return (
    <section className="playback-panel" aria-label={t("player.sectionAria")}>
      {state.url ? (
        <div key="artplayer" ref={playerRef} className="player artplayer-host" aria-label={t("player.hostAria")} />
      ) : (
        <div key="placeholder" className="player-placeholder">
          <div className="player-placeholder-copy">
            <span className="play-button-mark">▶</span>
            <strong>{state.status === "resolving" ? t("player.statusResolving", { name: selectedName }) : t("player.statusEmpty")}</strong>
            <span>{state.selectedEpisode?.name ?? t("player.statusEmptyHint")}</span>
          </div>
        </div>
      )}
      <div className="player-state-pills">
        <span>{stripEmoji(sourceName) || t("player.routeChip", { index: state.groupIndex + 1 })}</span>
        <span>{state.mode === "direct" ? t("player.directChip") : t("player.proxyChip")}</span>
      </div>
      {state.status === "failed" ? (
        <div className="playback-error">
          <p>{t("detail.playbackFailed")}</p>
          {state.selectedEpisode ? (
            <Button type="button" variant="primary" onClick={onRetry}>
              {t("player.retry", { name: state.selectedEpisode.name })}
            </Button>
          ) : null}
        </div>
      ) : null}
      {playerError ? (
        <div className="playback-error">
          <p>{playerError}</p>
          <Button type="button" variant="primary" onClick={retryPlayer}>
            {t("player.retry", { name: state.selectedEpisode?.name ?? t("player.currentEpisodeFallback") })}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
