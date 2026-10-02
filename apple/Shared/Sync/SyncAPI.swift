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
    func syncPush(_ request: SyncPushRequest) async throws -> SyncPushResponse {
        try await post("/api/v1/sync/push", body: request)
    }

    func syncPull(since: Int64, epoch: String, limit: Int) async throws -> SyncPullResponse {
        var query = ["since": String(since), "limit": String(limit)]
        if !epoch.isEmpty { query["epoch"] = epoch }
        return try await get("/api/v1/sync/pull", query: query)
    }
}
