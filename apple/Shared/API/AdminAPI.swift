import Foundation

extension APIClient {

    // MARK: - Sources

    /// Lists all configured video sources for the admin panel.
    /// 获取管理页面中的全部视频源.
    func listSources() async throws -> SourcesResponse {
        try await get("/api/v1/admin/sources")
    }

    /// Creates a new video source.
    /// 创建新视频源.
    func createSource(_ req: CreateSourceRequest) async throws -> Source {
        try await post("/api/v1/admin/sources", body: req)
    }

    /// Updates mutable fields for one video source.
    /// 更新单个视频源的可变字段.
    func updateSource(id: Int, _ req: UpdateSourceRequest) async throws {
        let _: MessageResponse = try await put("/api/v1/admin/sources/\(id)", body: req)
    }

    /// Deletes one video source.
    /// 删除单个视频源.
    func deleteSource(id: Int) async throws {
        let _ = try await delete("/api/v1/admin/sources/\(id)")
    }

    /// Triggers a health check for one video source.
    /// 触发单个视频源健康检查.
    func checkSource(id: Int) async throws -> HealthCheckResponse {
        try await post("/api/v1/admin/sources/\(id)/check")
    }

    /// Triggers health checks for all video sources.
    /// 触发全部视频源健康检查.
    func checkAllSources() async throws {
        let _: MessageResponse = try await post("/api/v1/admin/sources/check-all")
    }

    /// Imports video sources from raw source-config JSON.
    /// 从原始视频源配置 JSON 导入视频源.
    func importSources(configJSON: String) async throws -> ImportResponse {
        try await postRaw("/api/v1/admin/sources/import", body: Data(configJSON.utf8))
    }

    // MARK: - Subscriptions

    /// Lists all source subscriptions.
    /// 获取全部视频源订阅.
    func listSubscriptions() async throws -> SubscriptionsResponse {
        try await get("/api/v1/admin/subscriptions")
    }

    /// Creates a source subscription.
    /// 创建视频源订阅.
    func createSubscription(_ req: CreateSubscriptionRequest) async throws -> Subscription {
        try await post("/api/v1/admin/subscriptions", body: req)
    }

    /// Updates a source subscription.
    /// 更新视频源订阅.
    func updateSubscription(id: Int, _ req: CreateSubscriptionRequest) async throws {
        let _: MessageResponse = try await put("/api/v1/admin/subscriptions/\(id)", body: req)
    }

    /// Deletes a source subscription.
    /// 删除视频源订阅.
    func deleteSubscription(id: Int) async throws {
        let _ = try await delete("/api/v1/admin/subscriptions/\(id)")
    }

    /// Triggers one subscription sync.
    /// 触发单个订阅同步.
    func syncSubscription(id: Int) async throws {
        let _: MessageResponse = try await post("/api/v1/admin/subscriptions/\(id)/sync")
    }

    // MARK: - Users

    /// Lists all users.
    /// 获取全部用户.
    func listUsers() async throws -> UsersResponse {
        try await get("/api/v1/admin/users")
    }

    /// Creates a user.
    /// 创建用户.
    func createUser(_ req: CreateUserRequest) async throws -> User {
        try await post("/api/v1/admin/users", body: req)
    }

    /// Updates user profile, role, or password fields supported by the backend.
    /// 更新后端支持的用户资料, 角色或密码字段.
    func updateUser(id: Int, _ req: UpdateUserRequest) async throws {
        let _: MessageResponse = try await put("/api/v1/admin/users/\(id)", body: req)
    }

    /// Deletes a user.
    /// 删除用户.
    func deleteUser(id: Int) async throws {
        let _ = try await delete("/api/v1/admin/users/\(id)")
    }

    // MARK: - Settings

    /// Fetches public settings for anonymous callers and full settings for admins.
    /// 匿名调用返回公开设置, 管理员调用返回完整设置.
    func getSettings() async throws -> SettingsResponse {
        try await get("/api/v1/settings")
    }

    /// Updates one or more admin settings.
    /// 更新一个或多个管理设置.
    func updateSettings(_ settings: [String: String]) async throws {
        let _: MessageResponse = try await put("/api/v1/admin/settings", body: settings)
    }
}
