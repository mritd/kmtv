import Foundation

/// Sync endpoints used by the engine; tests replace them with a fake.
///
/// 引擎使用的同步接口; 测试中会替换为 fake.
protocol SyncAPIProtocol: Sendable {
    /// Sends local changes to POST /api/v1/sync/push.
    ///
    /// 将本地变更发送到 POST /api/v1/sync/push.
    func syncPush(_ request: SyncPushRequest) async throws -> SyncPushResponse

    /// Reads one page of changes after a revision cursor from GET /api/v1/sync/pull. `full` marks a
    /// page of a chain that started at revision 0, so the server skips its `since < min_rev` reset.
    ///
    /// 从 GET /api/v1/sync/pull 读取某个版本游标之后的一页变更. `full` 表示该页属于从版本 0 开始的
    /// 拉取链, 服务端会跳过 `since < min_rev` 的 reset.
    func syncPull(since: Int64, epoch: String, limit: Int, full: Bool) async throws -> SyncPullResponse
}

extension APIClient {
    /// Posts a batch of local changes to the sync push endpoint.
    ///
    /// 将一批本地变更 POST 到同步推送接口.
    func syncPush(_ request: SyncPushRequest) async throws -> SyncPushResponse {
        // The batch budget is measured without slash escaping, so the body must be encoded the same way.
        //
        // 批次预算按不转义斜杠计算, 因此请求体必须用同样的方式编码.
        let encoder = JSONEncoder()
        encoder.outputFormatting = .withoutEscapingSlashes
        return try await postRaw("/api/v1/sync/push", body: try encoder.encode(request))
    }

    /// Reads one page of changes after `since`; an empty `epoch` is omitted from the query, and
    /// `full=1` is sent only when `full` is true.
    ///
    /// 读取 `since` 之后的一页变更; `epoch` 为空时不带该查询参数, 仅当 `full` 为 true 时才发送 `full=1`.
    func syncPull(since: Int64, epoch: String, limit: Int, full: Bool) async throws -> SyncPullResponse {
        var query = ["since": String(since), "limit": String(limit)]
        if !epoch.isEmpty { query["epoch"] = epoch }
        if full { query["full"] = "1" }
        return try await get("/api/v1/sync/pull", query: query)
    }
}
