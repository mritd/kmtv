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
 *   Sources here usually serve a bare fragment list with no BANDWIDTH, so
 *   levelBitrate is 0 and `maxBufferLength` alone decides the target.
 *   hls.js 的前向目标计算如上. 本项目的源通常返回不含 BANDWIDTH 的裸分片列表,
 *   此时 levelBitrate 为 0, 目标完全由 maxBufferLength 决定.
 *
 *   At 1080p/3 Mbps this is roughly 113 MB forward plus 23 MB back, close to
 *   Chrome's per-SourceBuffer budget. Higher-bitrate sources will overflow and
 *   hls.js walks the ceiling down over two or three retries — accepted.
 *   1080p/3 Mbps 下约为前向 113 MB 加后向 23 MB, 接近 Chrome 的
 *   SourceBuffer 配额. 更高码率会溢出, hls.js 会在两三次重试内下调上限 — 已接受.
 */
export const HLS_BUFFER_CONFIG = {
  maxBufferLength: 300,
  maxMaxBufferLength: 600,
  maxBufferSize: 200 * 1000 * 1000,
  // Default is Infinity: played media is never released and permanently
  // consumes quota the forward buffer needs.
  // 默认为 Infinity: 已播放内容不会释放, 会持续占用前向缓冲所需的配额.
  backBufferLength: 60,
  startFragPrefetch: true,
} as const;
