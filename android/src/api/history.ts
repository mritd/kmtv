// Watch-history API factory — wraps /history for cross-device continue watching.
// 观看历史 API 工厂, 包装 /history 以支持跨设备继续观看.

import type { APIClient } from "./client";
import type { MessageResponse, WatchHistoryRequest, WatchHistoryResponse, WatchHistoryResponseItem } from "./types";

/**
 * WatchHistoryAPI — typed surface for server-synchronized watch history.
 * WatchHistoryAPI — 服务端同步观看历史的类型化接口.
 */
export interface WatchHistoryAPI {
	listWatchHistory(limit?: number): Promise<WatchHistoryResponse>;
  watchHistory(title: string): Promise<WatchHistoryResponseItem>;
  saveWatchHistory(payload: WatchHistoryRequest): Promise<WatchHistoryResponseItem>;
  deleteWatchHistory(title: string): Promise<void>;
	clearWatchHistory(eventTimeMS?: number): Promise<void>;
}

/**
 * Build a WatchHistoryAPI bound to the provided APIClient.
 * 基于给定 APIClient 构建 WatchHistoryAPI.
 */
export function createWatchHistoryAPI(client: APIClient): WatchHistoryAPI {
  return {
    listWatchHistory(limit = 10) {
		const params = new URLSearchParams({ limit: String(limit), completed: "false" });
      return client.get<WatchHistoryResponse>(`/history?${params.toString()}`);
    },
    watchHistory(title) {
      const params = new URLSearchParams({ title });
      return client.get<WatchHistoryResponseItem>(`/history/item?${params.toString()}`);
    },
    saveWatchHistory(payload) {
      return client.put<WatchHistoryResponseItem>("/history", payload);
    },
    async deleteWatchHistory(title) {
      const params = new URLSearchParams({ title });
      await client.delReturning<MessageResponse>(`/history/item?${params.toString()}`);
    },
	async clearWatchHistory(eventTimeMS = Date.now()) {
		const params = new URLSearchParams({ event_time_ms: String(eventTimeMS) });
		await client.delReturning<MessageResponse>(`/history?${params.toString()}`);
	},
  };
}
