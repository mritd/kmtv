import Foundation

/// Authenticated user profile returned by the backend.
/// 后端返回的已认证用户资料.
struct User: Codable, Sendable {
    let id: Int
    let username: String
    let role: String
    var avatar: String?
}

/// Login response containing user fields and an opaque bearer token.
/// 登录响应, 包含用户字段和 opaque bearer token.
struct LoginResponse: Codable, Sendable {
    let user: User
    let accessToken: String
    let expiresAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case username
        case role
        case avatar
        case accessToken = "access_token"
        case expiresAt = "expires_at"
    }

    /// Decodes the flattened login response into a nested user object.
    /// 将扁平登录响应解码为嵌套 user 对象.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        user = User(
            id: try container.decode(Int.self, forKey: .id),
            username: try container.decode(String.self, forKey: .username),
            role: try container.decode(String.self, forKey: .role),
            avatar: try container.decodeIfPresent(String.self, forKey: .avatar)
        )
        accessToken = try container.decode(String.self, forKey: .accessToken)
        expiresAt = try container.decode(Date.self, forKey: .expiresAt)
    }

    /// Encodes the login response back to the backend's flattened JSON shape.
    /// 按后端扁平 JSON 结构重新编码登录响应.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(user.id, forKey: .id)
        try container.encode(user.username, forKey: .username)
        try container.encode(user.role, forKey: .role)
        try container.encodeIfPresent(user.avatar, forKey: .avatar)
        try container.encode(accessToken, forKey: .accessToken)
        try container.encode(expiresAt, forKey: .expiresAt)
    }
}

/// Login request payload.
/// 登录请求载荷.
struct LoginRequest: Codable, Sendable {
    let username: String
    let password: String
}

/// Profile update request payload.
/// 用户资料更新请求载荷.
struct ProfileRequest: Codable, Sendable {
    let username: String
}

/// Password change request payload.
/// 密码修改请求载荷.
struct PasswordRequest: Codable, Sendable {
    let oldPassword: String
    let newPassword: String

    enum CodingKeys: String, CodingKey {
        case oldPassword = "old_password"
        case newPassword = "new_password"
    }
}

/// Standard backend message response.
/// 后端标准 message 响应.
struct MessageResponse: Codable, Sendable {
    let message: String
}
