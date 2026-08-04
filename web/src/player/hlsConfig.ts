/**
 * hlsConfig — shared hls.js buffer tuning for every playback surface.
 * hlsConfig — 所有播放入口共用的 hls.js 缓冲调优.
 *
 * Why this is a separate module / 为何独立成模块:
 *   Two call sites construct hls.js (PlaybackPanel's ArtPlayer customType and
 *   VideoPlayer's direct adapter). Keeping the values here prevents drift and
 *   makes them directly assertable — VideoPlayer.tsx is excluded from vitest,
 *   and PlaybackPanel's customType callback is never invoked by the suite.
 *   有两处构造 hls.js (PlaybackPanel 的 ArtPlayer customType 与 VideoPlayer
 *   的直接适配器). 值集中于此可避免漂移, 并让其可被直接断言 — VideoPlayer.tsx
 *   被 vitest 排除, 而 PlaybackPanel 的 customType 回调不会被测试触发.
 *
 * Callers / 调用方:
 *   viewer/playback/PlaybackPanel.tsx, player/VideoPlayer.tsx
 */

/**
 * HLS_BUFFER_CONFIG holds the buffer-related subset of hls.js config.
 * HLS_BUFFER_CONFIG 保存 hls.js 配置中与缓冲相关的部分.
 *
 * Sizing rationale / 取值依据:
 *   hls.js computes its forward target as
 *     levelBitrate ? min(max(8 * maxBufferSize / levelBitrate, maxBufferLength), maxMaxBufferLength)
 *                  : min(maxBufferLength, maxMaxBufferLength)
 *   (base-stream-controller.ts getMaxBufferLength). The bitrate passed in is
 *   `level.maxBitrate` = max(realBitrate, bitrate), and `realBitrate` is MEASURED from
 *   completed downloads (abr-controller.ts). So even for the bare fragment lists these
 *   sources serve — no BANDWIDTH declared, bitrate 0 — the zero branch only applies to
 *   the first few fragments. After that `maxBufferSize` is the governing lever, not
 *   `maxBufferLength`.
 *   hls.js 的前向目标计算如上 (base-stream-controller.ts 的 getMaxBufferLength).
 *   传入的码率是 `level.maxBitrate` = max(realBitrate, bitrate), 而 `realBitrate` 由
 *   已完成的下载实测得出 (abr-controller.ts). 因此即便本项目的源返回未声明 BANDWIDTH,
 *   bitrate 为 0 的裸分片列表, 零值分支也只在最初几个分片生效.
 *   之后真正起控制作用的是 `maxBufferSize` 而非 `maxBufferLength`.
 *
 *   The real ceiling is the browser's SourceBuffer quota (~150 MB of video in Chrome,
 *   not raisable from a page), so these values are set so that quota — not this config —
 *   is what binds. Overshooting it is safe and self-correcting: on QuotaExceededError
 *   hls.js calls reduceMaxBufferLength, which lowers config.maxMaxBufferLength by at
 *   most half per round until it converges on what the browser actually allows.
 *   真正的天花板是浏览器的 SourceBuffer 配额 (Chrome 视频约 150 MB, 页面侧无法调高),
 *   因此这些值的设定目标是让配额而非本配置成为约束. 超出配额是安全且可自我修正的:
 *   遇到 QuotaExceededError 时 hls.js 会调用 reduceMaxBufferLength,
 *   每轮最多减半 config.maxMaxBufferLength, 直至收敛到浏览器实际允许的水平.
 */
export const HLS_BUFFER_CONFIG = {
  maxBufferLength: 300,
  // Deliberately far above any reachable buffer: this is an unconditional
  // Math.min ceiling, so a tighter value silently caps the buffer on low-bitrate
  // sources long before the browser's quota is reached. At 1 Mbps the size term
  // alone asks for 1600s, which the previous 600 clamped away — leaving roughly
  // half the quota unused. 3600s covers a feature-length episode end to end.
  // 刻意设得远高于任何可达缓冲: 这是一个无条件的 Math.min 上限,
  // 取值偏紧会在远未触及浏览器配额时就静默截断低码率源的缓冲.
  // 1 Mbps 下仅体积项就要求 1600s, 而此前的 600 会将其砍掉, 白白浪费约一半配额.
  // 3600s 足以覆盖一部完整长度的剧集.
  maxMaxBufferLength: 3600,
  // Sized to cover a whole episode wherever the browser's quota permits, so the
  // quota is the only thing that ever binds. Measured against a representative
  // source: 2797s at 948 kbps measured (584 kbps declared) = 332 MB for the full
  // episode. Chrome caps a video SourceBuffer near 150 MB, so it self-limits to
  // roughly 21 minutes; browsers with a larger quota get correspondingly more.
  // 取值以覆盖整集为目标, 只要浏览器配额允许, 从而让配额成为唯一约束.
  // 基于一个有代表性的源实测: 2797s, 实测码率 948 kbps (声明 584 kbps),
  // 整集需 332 MB. Chrome 的视频 SourceBuffer 约 150 MB 封顶, 因此会自行限制在
  // 约 21 分钟; 配额更大的浏览器可获得相应更多的缓冲.
  maxBufferSize: 400 * 1000 * 1000,
  // Default is Infinity: played media is never released and permanently
  // consumes quota the forward buffer needs.
  // 默认为 Infinity: 已播放内容不会释放, 会持续占用前向缓冲所需的配额.
  backBufferLength: 60,
  startFragPrefetch: true,
} as const;
