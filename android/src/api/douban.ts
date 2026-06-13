// Douban discovery API factory matching the iOS DoubanAPI surface.
// 与 iOS DoubanAPI 表面一致的 Douban 发现 API 工厂.

import type { APIClient } from "./client";
import type { DoubanHomeResponse } from "./types";

/**
 * Surface offered by createDoubanAPI; M2 only ships doubanHome.
 * createDoubanAPI 暴露的接口; M2 仅提供 doubanHome.
 */
export interface DoubanAPI {
  doubanHome: () => Promise<DoubanHomeResponse>;
}

/**
 * Build a DoubanAPI bound to the provided APIClient.
 * 基于给定 APIClient 构建一个 DoubanAPI.
 */
export function createDoubanAPI(client: APIClient): DoubanAPI {
  return {
    doubanHome: () => client.get<DoubanHomeResponse>("/douban/home"),
  };
}
