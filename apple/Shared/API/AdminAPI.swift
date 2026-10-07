import Foundation

extension APIClient {

    // MARK: - Sources

    /// Lists all configured video sources for the admin panel.
    ///
    /// 获取管理页面中的全部视频源.
    func listSources() async throws -> SourcesResponse {
        try await get("/api/v1/admin/sources")
    }

    /// Updates mutable fields for one video source.
    ///
    /// 更新单个视频源的可变字段.
    func updateSource(id: Int, _ req: UpdateSourceRequest) async throws {
        let _: MessageResponse = try await put("/api/v1/admin/sources/\(id)", body: req)
    }

    /// Deletes one video source.
    ///
    /// 删除单个视频源.
    func deleteSource(id: Int) async throws {
        let _ = try await delete("/api/v1/admin/sources/\(id)")
    }

    /// Triggers health checks for all video sources.
    ///
    /// 触发全部视频源健康检查.
    func checkAllSources() async throws {
        let _: MessageResponse = try await post("/api/v1/admin/sources/check-all")
    }

    // MARK: - Subscriptions

    /// Lists all source subscriptions.
    ///
    /// 获取全部视频源订阅.
    func listSubscriptions() async throws -> SubscriptionsResponse {
        try await get("/api/v1/admin/subscriptions")
    }

    /// Creates a source subscription.
    ///
    /// 创建视频源订阅.
    func createSubscription(_ req: CreateSubscriptionRequest) async throws -> Subscription {
        try await post("/api/v1/admin/subscriptions", body: req)
    }

    /// Deletes a source subscription.
    ///
    /// 删除视频源订阅.
    func deleteSubscription(id: Int) async throws {
        let _ = try await delete("/api/v1/admin/subscriptions/\(id)")
    }

    /// Triggers one subscription sync.
    ///
    /// 触发单个订阅同步.
    func syncSubscription(id: Int) async throws {
        let _: MessageResponse = try await post("/api/v1/admin/subscriptions/\(id)/sync")
    }

    // MARK: - Users

    /// Lists all users.
    ///
    /// 获取全部用户.
    func listUsers() async throws -> UsersResponse {
        try await get("/api/v1/admin/users")
    }

    /// Creates a user.
    ///
    /// 创建用户.
    func createUser(_ req: CreateUserRequest) async throws -> User {
        try await post("/api/v1/admin/users", body: req)
    }

    /// Deletes a user.
    ///
    /// 删除用户.
    func deleteUser(id: Int) async throws {
        let _ = try await delete("/api/v1/admin/users/\(id)")
    }

    // MARK: - Settings

    /// Fetches public settings for anonymous callers and full settings for admins.
    ///
    /// 匿名调用返回公开设置, 管理员调用返回完整设置.
    func getSettings() async throws -> SettingsResponse {
        try await get("/api/v1/settings")
    }

    /// Updates one or more admin settings.
    ///
    /// 更新一个或多个管理设置.
    func updateSettings(_ settings: [String: String]) async throws {
        let _: MessageResponse = try await put("/api/v1/admin/settings", body: settings)
    }
}
