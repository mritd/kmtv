// Douban discovery API factory matching the iOS DoubanAPI surface.
// 与 iOS DoubanAPI 表面一致的 Douban 发现 API 工厂.

import type { APIClient } from "./client";
import type {
  DoubanCategoriesResponse, DoubanHomeResponse, DoubanListResponse, DoubanRecommendFilter,
} from "./types";

/**
 * Surface offered by createDoubanAPI. M2 added doubanHome; M3 adds the categories + filter pair.
 * createDoubanAPI 暴露的接口. M2 提供 doubanHome; M3 增加分类与筛选两组方法.
 */
export interface DoubanAPI {
  doubanHome: () => Promise<DoubanHomeResponse>;
  doubanCategories: () => Promise<DoubanCategoriesResponse>;
  doubanRecommendFilter: (filter: DoubanRecommendFilter) => Promise<DoubanListResponse>;
}

/**
 * Build a DoubanAPI bound to the provided APIClient.
 * 基于给定 APIClient 构建一个 DoubanAPI.
 */
export function createDoubanAPI(client: APIClient): DoubanAPI {
  return {
    doubanHome: () => client.get<DoubanHomeResponse>("/douban/home"),

    doubanCategories: () => client.get<DoubanCategoriesResponse>("/douban/categories"),

    doubanRecommendFilter: async (filter) => {
      // Only forward fields the caller actually provided. The backend treats absent params as defaults;
      // forwarding an empty `tag=` differs from omitting it and would change ranking.
      // 只转发调用方提供的字段. 空 `tag=` 与省略不同, 会改变排序; 因此条件添加.
      const params = new URLSearchParams();
      params.set("kind", filter.kind);
      if (filter.tag !== undefined) params.set("tag", filter.tag);
      if (filter.format !== undefined) params.set("format", filter.format);
      if (filter.region !== undefined) params.set("region", filter.region);
      if (filter.start !== undefined) params.set("start", String(filter.start));
      if (filter.count !== undefined) params.set("count", String(filter.count));
      const response = await client.get<Partial<DoubanListResponse>>(
        `/douban/recommend/filter?${params.toString()}`,
      );
      // Normalise a missing items field (the server occasionally returns just `{}`) so the
      // infinite-query end-of-list check (items.length < count) does not throw downstream.
      // 归一化缺失的 items 字段 (服务端偶尔返回 `{}`), 避免下游无限查询末页判断 (items.length < count) 抛出.
      return { items: response.items ?? [] };
    },
  };
}
