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
 *   hls.js computes its forward target as (base-stream-controller.ts getMaxBufferLength)
 *     levelBitrate ? min(max(8 * maxBufferSize / levelBitrate, maxBufferLength), maxMaxBufferLength)
 *                  : min(maxBufferLength, maxMaxBufferLength)
 *   where levelBitrate is `level.maxBitrate` = max(realBitrate, bitrate).
 *   hls.js 的前向目标计算如上 (base-stream-controller.ts 的 getMaxBufferLength),
 *   其中 levelBitrate 为 `level.maxBitrate` = max(realBitrate, bitrate).
 *
 *   For this project's sources levelBitrate is normally 0, so the ZERO branch is what
 *   runs and `maxBufferLength` is the only lever — `maxBufferSize` never participates:
 *     - the playlists are bare fragment lists with no EXT-X-STREAM-INF, so bitrate is 0;
 *     - realBitrate would fix that, but it is only ever assigned under
 *       `config.abrMaxWithRealBitrate`, which hls.js defaults to false (config.ts:432).
 *   Verified live: with maxBufferLength at 300 the forward buffer sat at exactly 301s.
 *   本项目的源通常 levelBitrate 为 0, 因此实际走的是零值分支,
 *   `maxBufferLength` 是唯一的杆, `maxBufferSize` 完全不参与:
 *     - 这些 playlist 是不含 EXT-X-STREAM-INF 的裸分片列表, 故 bitrate 为 0;
 *     - realBitrate 本可弥补, 但它仅在 `config.abrMaxWithRealBitrate` 下赋值,
 *       而 hls.js 该项默认为 false (config.ts:432).
 *   线上实测验证: maxBufferLength 为 300 时前向缓冲恰好停在 301s.
 *
 *   So both length values are set to the same generous target and `maxBufferSize` is
 *   omitted entirely, since a byte budget provably cannot bind while the length floor
 *   equals the ceiling. The real limit is then the browser's SourceBuffer quota
 *   (~150 MB of video in Chrome, not raisable from a page). Overshooting it is safe:
 *   on QuotaExceededError hls.js calls reduceMaxBufferLength, which lowers
 *   config.maxMaxBufferLength toward the buffer it actually achieved, converging in a
 *   couple of rounds. That path only reduces the ceiling — it does not flush the
 *   buffer unless the playhead itself is unbuffered (base-stream-controller.ts:2044).
 *   因此两个长度值取相同的宽松目标, 并完全省去 `maxBufferSize`:
 *   当长度下限等于上限时, 字节预算可被证明永远无法生效.
 *   真正的限制随之变成浏览器的 SourceBuffer 配额 (Chrome 视频约 150 MB, 页面侧无法调高).
 *   超出配额是安全的: 遇到 QuotaExceededError 时 hls.js 会调用 reduceMaxBufferLength,
 *   将 config.maxMaxBufferLength 下调至实际达成的缓冲量, 一般两轮内收敛.
 *   该路径只下调上限, 除非播放头本身未被缓冲, 否则不会 flush 缓冲
 *   (base-stream-controller.ts:2044).
 */
export const HLS_BUFFER_CONFIG = {
  // 3600s covers a feature-length episode end to end, so the browser's quota — not
  // this number — is what stops the buffer. Both values are equal on purpose: the
  // floor has to reach the ceiling for the zero-bitrate branch to target the whole
  // episode, and maxMaxBufferLength is the field hls.js itself walks down on quota
  // errors, so it must start at the ambition rather than at a guess.
  // 3600s 足以覆盖一部完整长度的剧集, 从而让浏览器配额而非这个数字成为缓冲的终点.
  // 两个值刻意相等: 零码率分支要瞄准整集, 下限就必须够到上限;
  // 而 maxMaxBufferLength 正是 hls.js 在配额出错时自行下调的字段,
  // 因此它应当从目标值起步, 而不是从一个猜测值起步.
  maxBufferLength: 3600,
  maxMaxBufferLength: 3600,
  // Default is Infinity: played media is never released and permanently
  // consumes quota the forward buffer needs.
  // 默认为 Infinity: 已播放内容不会释放, 会持续占用前向缓冲所需的配额.
  backBufferLength: 60,
  startFragPrefetch: true,
} as const;
