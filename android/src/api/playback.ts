// Playback API factory — wraps POST /api/v1/playback/url so the media token stays server-owned.
// Playback API 工厂, 包装 POST /api/v1/playback/url, 媒体 token 细节由服务端独占维护.

import type { APIClient } from "./client";
import type { PlaybackURLResponse } from "./types";

/**
 * Surface offered by createPlaybackAPI — one method, mirrors iOS APIClient.playbackURL.
 * createPlaybackAPI 暴露的接口, 仅一个方法, 镜像 iOS APIClient.playbackURL.
 */
export interface PlaybackAPI {
  playbackURL: (url: string, source: string) => Promise<PlaybackURLResponse>;
}

/**
 * Build a PlaybackAPI bound to the provided APIClient.
 * 基于给定 APIClient 构建 PlaybackAPI.
 */
export function createPlaybackAPI(client: APIClient): PlaybackAPI {
  return {
    playbackURL: (url, source) =>
      client.post<PlaybackURLResponse>("/playback/url", { url, source }),
  };
}
