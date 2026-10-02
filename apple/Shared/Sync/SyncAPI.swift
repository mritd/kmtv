import Foundation

/// Sync endpoints used by the engine; tests replace them with a fake.
///
/// 引擎使用的同步接口; 测试中会替换为 fake.
protocol SyncAPIProtocol: Sendable {
    /// Sends local changes to POST /api/v1/sync/push.
    ///
    /// 将本地变更发送到 POST /api/v1/sync/push.
    func syncPush(_ request: SyncPushRequest) async throws -> SyncPushResponse

    /// Reads one page of changes after a revision cursor from GET /api/v1/sync/pull.
    ///
    /// 从 GET /api/v1/sync/pull 读取某个版本游标之后的一页变更.
    func syncPull(since: Int64, epoch: String, limit: Int) async throws -> SyncPullResponse
}

extension APIClient {
    /// Posts a batch of local changes to the sync push endpoint.
    ///
    /// 将一批本地变更 POST 到同步推送接口.
    func syncPush(_ request: SyncPushRequest) async throws -> SyncPushResponse {
        try await post("/api/v1/sync/push", body: request)
    }

    /// Reads one page of changes after `since`; an empty `epoch` is omitted from the query.
    ///
    /// 读取 `since` 之后的一页变更; `epoch` 为空时不带该查询参数.
    func syncPull(since: Int64, epoch: String, limit: Int) async throws -> SyncPullResponse {
        var query = ["since": String(since), "limit": String(limit)]
        if !epoch.isEmpty { query["epoch"] = epoch }
        return try await get("/api/v1/sync/pull", query: query)
    }
}
