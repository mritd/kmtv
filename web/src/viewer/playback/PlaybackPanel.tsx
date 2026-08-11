/**
 * PlaybackPanel — ArtPlayer host + playback state UI for the detail page.
 *
 * PlaybackPanel — 详情页的 ArtPlayer 宿主 + 播放状态 UI.
 *
 * Responsibilities / 职责:
 *   - Mount and destroy ArtPlayer dynamically (see ADR-012) — 动态挂载和销毁 ArtPlayer (见 ADR-012)
 *   - Delegate HLS demuxing to hls.js when native HLS is unavailable — 原生 HLS 不可用时委托 hls.js 解码
 *   - Apply one persisted resume seek after "video:loadedmetadata" without saving that programmatic seek as new progress
 *
 *     — 元数据加载后执行一次持久化恢复 seek, 且不把该程序化 seek 再保存为新进度
 *
 *   - Checkpoint every 30 s and flush after manual seek, tab hide, or teardown
 *
 *     — 每 30 秒保存检查点, 并在手动 seek, tab 隐藏或组件卸载后立即补写
 *
 *   - Surface HLS bundle-load / hls.js unsupported / fatal-error banners — 展示 HLS bundle 加载 / hls.js 不支持 / 致命错误横幅
 *   - Show placeholder when no URL is ready; resolving/idle copy differs — 无 URL 时显示占位符; resolving/idle 文案不同
 *   - Show state pills (source name + mode chip) — 显示状态 pill (源名称 + 模式 chip)
 *
 * ADR-012 LOCK — ArtPlayer is the required player; do NOT replace with a native <video> or other lib.
 *
 * ADR-012 锁定 — ArtPlayer 是必需的播放器; 不得替换为原生 <video> 或其他库.
 *
 * Boundary note / 边界说明:
 *   VideoPlayer.tsx is the native <video> + hls.js adapter (no ArtPlayer).
 *   This file (PlaybackPanel.tsx) is the ArtPlayer boundary — the two are NOT interchangeable.
 *
 *   VideoPlayer.tsx 是原生 <video> + hls.js 适配器 (无 ArtPlayer).
 *   本文件 (PlaybackPanel.tsx) 是 ArtPlayer 边界 — 两者不可互换.
 *
 * Callers / 调用方:
 *   viewer/detail/DetailPage.tsx
 *
 * Testing note / 测试说明:
 *   ArtPlayer is mocked via vi.mock("artplayer") in PlaybackPanel.test.tsx.
 *   hls.js is exercised only through the m3u8 customType callback, not mounted at unit-test level.
 *
 *   ArtPlayer 在 PlaybackPanel.test.tsx 中通过 vi.mock("artplayer") 模拟.
 *   hls.js 仅通过 m3u8 customType 回调测试, 不在单元测试层面挂载.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/ui/Button";
import { HLS_BUFFER_CONFIG } from "@/player/hlsConfig";
import { choosePlaybackEngine, hasManagedMediaSourceOnly, hasMediaSourceSupport } from "@/player/playback";

import type { PlaybackState } from "./playbackState";

/**
 * POSITION_SAVE_INTERVAL_MS — throttle interval for persisting playback position.
 *
 * POSITION_SAVE_INTERVAL_MS — 持久化播放进度的节流间隔.
 *
 * The player can report progress several times per second, but resume only needs a coarse checkpoint.
 * A 30-second interval bounds storage or API traffic; explicit lifecycle flushes capture newer progress.
 *
 * 播放器每秒可多次报告进度, 但恢复播放只需要粗粒度检查点.
 * 30 秒间隔限制存储或 API 流量, 显式生命周期补写负责捕获更新的进度.
 */
const POSITION_SAVE_INTERVAL_MS = 30_000;

/**
 * RESUME_MIN_SEC — minimum persisted position required to apply an initial seek.
 *
 * RESUME_MIN_SEC — 应用初始 seek 所需的最小持久化位置.
 *
 * Positions below this threshold are treated as the beginning. The same threshold also prevents
 * resuming within the final seconds, where restarting the episode is less surprising.
 *
 * 小于此阈值的位置视为片头. 同一阈值也用于避免从最后几秒恢复,
 * 此时从头播放比跳到片尾更符合预期.
 */
const RESUME_MIN_SEC = 3;

/**
 * stripEmoji — remove emoji and symbol pictographs from a source name.
 *
 * stripEmoji — 去掉源名称中的 emoji 和符号象形文字.
 *
 * Source names from upstream providers often include decorative emoji
 * (e.g. "🎬iKun资源"). The chip in the player state bar is compact; stripping
 * them keeps the label readable without truncation.
 *
 * 上游提供商的源名称通常包含装饰性 emoji (如 "🎬iKun资源").
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
 *
 * PlaybackPanel — 渲染 ArtPlayer 宿主容器 + 所有播放状态 UI 覆盖层.
 *
 * @param state              — current PlaybackState from DetailPage's useReducer — DetailPage useReducer 的当前 PlaybackState
 * @param sourceName         — raw source name used for the state pill chip — 用于状态 pill chip 的原始源名称
 * @param onPlaying          — called when ArtPlayer fires "video:play" — ArtPlayer 触发 "video:play" 时调用
 * @param onRetry            — called when the user clicks any retry button — 用户点击任意重试按钮时调用
 * @param initialPositionSec — optional persisted resume position in seconds — 可选的持久化恢复位置, 单位为秒
 * @param onPositionChange   — receives (currentTime, duration) for each checkpoint flush — 每次检查点补写时接收 (currentTime, duration)
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
  // Keep changing callbacks in refs so the player effect can call the latest versions without
  // adding them to its dependency list and rebuilding ArtPlayer on every render.
  //
  // 用 ref 保存频繁变化的回调, 使播放器副作用无需增加依赖或在每次渲染时重建 ArtPlayer,
  // 仍能调用最新版本.
  const onPlayingRef = useRef(onPlaying);
  const onPositionChangeRef = useRef(onPositionChange);
  // initialPositionRef holds the latest requested resume point without triggering a player rebuild.
  //
  // initialPositionRef 持有最新请求的恢复点, 不触发播放器重建.
  const initialPositionRef = useRef(initialPositionSec);
  const [playerError, setPlayerError] = useState<string | null>(null);
  // playerAttempt increments on retry to force the ArtPlayer useEffect to re-run.
  //
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
  //
  // 不重建播放器, 只是记录最新的恢复点.
  useEffect(() => {
    initialPositionRef.current = initialPositionSec;
  }, [initialPositionSec]);

  useEffect(() => {
    const container = playerRef.current;
    if (!container || !state.url) {
      // No-op when the URL is not yet resolved; ArtPlayer will be mounted once state.url is set.
      //
      // URL 尚未解析时无操作; state.url 设置后将挂载 ArtPlayer.
      return;
    }

    let disposed = false;
    let cleanupArtPlayer: (() => void) | undefined;
    let cleanupHLS: (() => void) | undefined;
    let saveTimer: ReturnType<typeof setInterval> | undefined;
    // Prevent duplicate metadata events from applying the persisted resume position more than once.
    //
    // 防止重复元数据事件多次应用持久化恢复位置.
    let appliedInitialSeek = false;
    // Identifies the next seek event as a possible resume restoration. The first seek event clears
    // the target; it is suppressed only when currentTime is still within one second of that target.
    // A mismatched event is treated as a later manual seek and saved normally.
    //
    // 把下一个 seek 事件标记为可能由恢复播放触发. 首个 seek 事件会清除目标;
    // 仅当 currentTime 与该目标相差不足 1 秒时才跳过保存. 不匹配的事件视为后续手动 seek 并正常保存.
    let pendingResumeSeekTarget: number | null = null;
    setPlayerError(null);

    // The player is created after a dynamic import. Store it in an effect-local object so lifecycle
    // handlers registered before the import can read the eventual instance without a React render.
    //
    // 播放器在动态 import 后才创建. 将它保存在副作用内的对象中,
    // 使 import 完成前注册的生命周期 handler 无需触发 React 渲染即可读取最终实例.
    const artSlot: { player: import("artplayer").default | null } = { player: null };

    // Flush the latest readable position when the page becomes hidden or leaves the session.
    // The parent callback chooses anonymous local storage or authenticated remote storage.
    //
    // 页面隐藏或离开会补写最后可读进度. 父级回调决定写入匿名本地存储还是已认证远端存储.
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
        //
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
            // ArtPlayer's urlMix waits one macrotask before invoking customType. Episode changes or
            // navigation can therefore destroy the player while this callback is still queued.
            // Guard before every playback branch so native HLS cannot assign video.src after teardown
            // and start an orphaned media load. This matters on iPhone WebKit, which selects native HLS.
            //
            // ArtPlayer 的 urlMix 会等待一个宏任务后再调用 customType. 切换剧集或离开页面时,
            // 播放器可能已销毁, 但该回调仍在队列中. 因此必须在所有播放分支前检查拆卸状态,
            // 避免原生 HLS 在拆卸后赋值 video.src 并启动无人清理的媒体加载.
            // iPhone WebKit 会选择原生 HLS, 因而必须覆盖此分支.
            if (disposed) {
              return;
            }

            const canPlayNativeHLS = () => video.canPlayType("application/vnd.apple.mpegurl") !== "";

            // Delegate the choice to choosePlaybackEngine so this panel and VideoPlayer
            // cannot drift apart; the rationale for the ordering lives there.
            //
            // 把选择委托给 choosePlaybackEngine, 使本面板与 VideoPlayer 不会各自漂移;
            // 排序理由见该函数.
            const engine = choosePlaybackEngine({
              canPlayNativeHLS,
              hlsSupported: hasMediaSourceSupport,
              managedBufferOnly: hasManagedMediaSourceOnly,
            });

            if (engine === "native") {
              video.src = url;
              return;
            }

            if (engine === "unsupported") {
              if (!disposed) {
                setPlayerError(t("player.errors.noHlsSupport"));
              }
              return;
            }

            let Hls: typeof import("hls.js").default;
            try {
              ({ default: Hls } = await import("hls.js"));
            } catch {
              // hls.js bundle failed to load (offline / CDN outage); surface a friendly error.
              //
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
              // MediaSource exists but hls.js rejected it (e.g. required codecs missing).
              // Fall back to native HLS before surfacing an error.
              //
              // MediaSource 存在但 hls.js 判定不可用 (例如缺少所需编解码器).
              // 报错之前先回退到原生 HLS.
              if (canPlayNativeHLS()) {
                video.src = url;
                return;
              }
              setPlayerError(t("player.errors.noHlsSupport"));
              return;
            }

            // Shared tuning; see player/hlsConfig.ts for the sizing rationale.
            //
            // 共享调优参数; 取值依据见 player/hlsConfig.ts.
            const hls = new Hls(HLS_BUFFER_CONFIG);
            hls.loadSource(url);
            hls.attachMedia(video);
            hls.on(Hls.Events.ERROR, (_, data) => {
              // Only fatal errors require user intervention; recoverable errors are retried internally by hls.js.
              //
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
      // Save completed manual seeks immediately instead of waiting for the 30-second timer.
      // Ignore the one seek generated by resume restoration, then queue the callback after the
      // current player event finishes so storage work is not performed inside ArtPlayer's handler.
      //
      // 手动 seek 完成后立即保存, 无需等待 30 秒定时器. 由恢复播放生成的首次 seek 会被忽略,
      // 其余保存回调排到当前播放器事件之后执行, 避免在 ArtPlayer handler 内直接处理存储工作.
      art.on("video:seeked", () => {
        if (pendingResumeSeekTarget !== null) {
          const resumeTarget = pendingResumeSeekTarget;
          pendingResumeSeekTarget = null;
          if (Number.isFinite(art.currentTime) && Math.abs(art.currentTime - resumeTarget) < 1) {
            return;
          }
        }
        queueMicrotask(flushNow);
      });
      // Duration is reliable only after metadata loads. Apply the resume target once, before normal playback.
      //
      // duration 仅在元数据加载后可靠. 此时只应用一次恢复位置, 再进入正常播放.
      art.on("video:loadedmetadata", () => {
        if (appliedInitialSeek) return;
        appliedInitialSeek = true;
        const target = initialPositionRef.current;
        const duration = typeof art.duration === "number" && Number.isFinite(art.duration) ? art.duration : 0;
        // Only seek when target is meaningful and not within RESUME_MIN_SEC of the end.
        //
        // 仅在 target 有意义且距结尾大于 RESUME_MIN_SEC 时 seek.
        if (typeof target === "number" && target >= RESUME_MIN_SEC && (duration === 0 || target < duration - RESUME_MIN_SEC)) {
          pendingResumeSeekTarget = target;
          try {
            art.currentTime = target;
          } catch {
            pendingResumeSeekTarget = null;
            // Some HLS streams disallow seeking until the first segment is buffered; fall back silently.
            //
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
        // Teardown is the last chance to capture progress during episode changes, navigation, or refresh.
        //
        // 切换集数, 导航或刷新时, 拆卸阶段是捕获最新进度的最后机会.
        const cb = onPositionChangeRef.current;
        if (cb) {
          const currentTime = typeof art.currentTime === "number" ? art.currentTime : 0;
          const duration = typeof art.duration === "number" ? art.duration : 0;
          if (currentTime > 0) cb(currentTime, duration);
        }
        // destroy(false) tears down ArtPlayer internals without removing the host DOM element,
        // since React owns the <div> and will handle its removal.
        //
        // destroy(false) 卸载 ArtPlayer 内部但不移除宿主 DOM 元素,
        // 因为 React 拥有该 <div> 并会处理其移除.
        art.destroy(false);
        container.replaceChildren();
      };
    }).catch(() => {
      // ArtPlayer dynamic import itself failed (extremely rare; usually a network issue).
      //
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
    // Include a retry counter in the player effect dependencies so retrying the same URL rebuilds
    // ArtPlayer even though the URL itself has not changed.
    //
    // 将重试计数器纳入播放器副作用依赖, 即使 URL 未变化, 重试同一地址也会重建 ArtPlayer.
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
