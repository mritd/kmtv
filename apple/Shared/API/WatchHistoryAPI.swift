import Foundation

extension APIClient {
    /// Fetches the current user's recent watch history.
    /// 获取当前用户最近观看历史.
	func listWatchHistory(limit: Int = 10) async throws -> WatchHistoryResponse {
		try await get("/api/v1/history", query: ["limit": String(limit), "completed": "false"])
    }

    /// Fetches one watch history item by title.
    /// 按标题获取一条观看历史.
    func watchHistory(title: String) async throws -> WatchHistoryResponseItem {
        try await get("/api/v1/history/item", query: ["title": title])
    }

    /// Saves one title's latest playback state.
    /// 保存某个标题的最新播放状态.
    func saveWatchHistory(_ request: WatchHistoryRequest) async throws -> WatchHistoryResponseItem {
        try await put("/api/v1/history", body: request)
    }

    /// Deletes one title from the current user's watch history.
    /// 从当前用户观看历史中删除一个标题.
    func deleteWatchHistory(title: String) async throws {
        _ = try await deleteReturning("/api/v1/history/item?\(Self.titleQuery(title))") as MessageResponse
    }

    /// Clears all watch history for the current user.
    /// 清空当前用户全部观看历史.
	func clearRemoteWatchHistory() async throws {
		_ = try await delete("/api/v1/history?event_time_ms=\(Int64(Date().timeIntervalSince1970 * 1000))")
    }

    private static func titleQuery(_ title: String) -> String {
        var components = URLComponents()
        components.queryItems = [URLQueryItem(name: "title", value: title)]
        return components.percentEncodedQuery ?? "title="
    }
}
