// Pure selectors over the playback state, mirroring iOS EpisodeSelection.swift.
// 播放状态的纯选择器, 镜像 iOS EpisodeSelection.swift.

import type { Episode, SourceResult, VideoDetail } from "@/api/types";

/**
 * Shape consumed by every selector below — the playback reducer state that's relevant to episode
 * derivation. Excludes UI-only fields (currentTime, isPlaying, etc.).
 * 下方每个选择器消费的形状, 即与剧集派生相关的 reducer 子集, 排除 UI 专用字段.
 */
export interface SelectionInput {
  detail: VideoDetail | null;
  sources: SourceResult[];
  currentSourceKey: string;
  currentLineIndex: number;
  currentEpisodeIndex: number;
}

/**
 * All CDN lines for the active source, or `[]` when detail is still loading.
 * 当前源的全部 CDN 线路, 详情未加载时返回 `[]`.
 */
export function allLines(input: SelectionInput): Episode[][] {
  return input.detail?.episodes ?? [];
}

/**
 * Episodes for the active source × line. Falls back to the source's own episodes when detail is
 * unavailable, then clamps an out-of-range line index back to line 0 (matches iOS `[safe:]`).
 * 当前源 × 线路对应的剧集. 详情缺失时退回源自带的剧集列表; 线路越界回退到第一条线路 (与 iOS `[safe:]` 一致).
 */
export function episodes(input: SelectionInput): Episode[] {
  const lines = allLines(input);
  if (lines.length === 0) {
    return input.sources.find((s) => s.source_key === input.currentSourceKey)?.episodes ?? [];
  }
  return lines[input.currentLineIndex] ?? lines[0] ?? [];
}

/**
 * Currently selected episode, or null when the index is out of range.
 * 当前选中的剧集, 越界返回 null.
 */
export function currentEpisode(input: SelectionInput): Episode | null {
  return episodes(input)[input.currentEpisodeIndex] ?? null;
}

/**
 * Source-side videoId for the active source (used to key watch history + progress).
 * 当前源对应的 videoId (用于 watchHistory / 进度记录的主键).
 */
export function sourceVideoID(input: SelectionInput): string {
  return input.sources.find((s) => s.source_key === input.currentSourceKey)?.video_id ?? "";
}

/**
 * Human-readable source name, falling back to the key when the source is unknown.
 * 可读源名称, 缺失时退回 key.
 */
export function sourceDisplayName(input: SelectionInput): string {
  return input.sources.find((s) => s.source_key === input.currentSourceKey)?.source_name ?? input.currentSourceKey;
}
