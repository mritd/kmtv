import Foundation

/// Admin source list response.
/// 管理端视频源列表响应.
struct SourcesResponse: Codable, Sendable {
    let sources: [Source]
}

/// Configured video source.
/// 已配置的视频源.
struct Source: Codable, Sendable, Identifiable {
    let id: Int
    let key: String
    let name: String
    let api: String
    let detail: String
    let enabled: Bool
    let searchable: Bool
    let comment: String
    let health: String
    let lastCheck: Date?
    let createdAt: Date?
    let updatedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id, key, name, api, detail, enabled, searchable, comment, health
        case lastCheck = "last_check"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

/// Request payload for creating a video source.
/// 创建视频源的请求载荷.
struct CreateSourceRequest: Codable, Sendable {
    let key: String
    let name: String
    let api: String
    var detail: String = ""
    var comment: String = ""
}

/// Request payload for partially updating a video source.
/// 部分更新视频源的请求载荷.
struct UpdateSourceRequest: Codable, Sendable {
    var name: String?
    var api: String?
    var detail: String?
    var comment: String?
    var enabled: Bool?
}

/// Source health-check response.
/// 视频源健康检查响应.
struct HealthCheckResponse: Codable, Sendable {
    let health: String
}

/// Source import response.
/// 视频源导入响应.
struct ImportResponse: Codable, Sendable {
    let imported: Int
}

/// Admin subscription list response.
/// 管理端订阅列表响应.
struct SubscriptionsResponse: Codable, Sendable {
    let subscriptions: [Subscription]
}

/// Source subscription configuration.
/// 视频源订阅配置.
struct Subscription: Codable, Sendable, Identifiable {
    let id: Int
    let url: String
    let autoUpdate: Bool
    let interval: Int
    let lastSync: Date?
    let updatedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id, url, interval
        case autoUpdate = "auto_update"
        case lastSync = "last_sync"
        case updatedAt = "updated_at"
    }
}

/// Request payload for creating or updating a subscription.
/// 创建或更新订阅的请求载荷.
struct CreateSubscriptionRequest: Codable, Sendable {
    let url: String
    let autoUpdate: Bool
    let interval: Int

    enum CodingKeys: String, CodingKey {
        case url, interval
        case autoUpdate = "auto_update"
    }
}

/// Admin user list response.
/// 管理端用户列表响应.
struct UsersResponse: Codable, Sendable {
    let users: [User]
}

/// Request payload for creating a user.
/// 创建用户的请求载荷.
struct CreateUserRequest: Codable, Sendable {
    let username: String
    let password: String
    var role: String = "user"
}

/// Request payload for partially updating a user.
/// 部分更新用户的请求载荷.
struct UpdateUserRequest: Codable, Sendable {
    var username: String?
    var password: String?
    var role: String?
}

/// Settings key-value response.
/// 设置 key-value 响应.
struct SettingsResponse: Codable, Sendable {
    let settings: [String: String]
}
