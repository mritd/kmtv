// Detail API factory — wraps GET /api/v1/detail.
// Detail API 工厂, 包装 GET /api/v1/detail.

import type { APIClient } from "./client";
import type { VideoDetail } from "./types";

/**
 * Surface offered by createDetailAPI — one method, mirrors iOS DetailAPIProtocol.
 * createDetailAPI 暴露的接口, 仅一个方法, 镜像 iOS DetailAPIProtocol.
 */
export interface DetailAPI {
  detail: (sourceKey: string, videoId: string) => Promise<VideoDetail>;
}

/**
 * Build a DetailAPI bound to the provided APIClient.
 * 基于给定 APIClient 构建 DetailAPI.
 */
export function createDetailAPI(client: APIClient): DetailAPI {
  return {
    detail: (sourceKey, videoId) => {
      const params = new URLSearchParams();
      params.set("source", sourceKey);
      params.set("id", videoId);
      return client.get<VideoDetail>(`/detail?${params.toString()}`);
    },
  };
}
