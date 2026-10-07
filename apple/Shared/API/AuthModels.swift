import Foundation

/// Authenticated user profile returned by the backend.
///
/// 后端返回的已认证用户资料.
struct User: Codable, Sendable {
    let id: Int
    let username: String
    let role: String
    let allowAdultContent: Bool
    var avatar: String?
    /// Whether `avatar` is the server's default avatar rather than an upload.
    ///
    /// `avatar` 是否为服务端默认头像, 而非用户上传的头像.
    var avatarIsDefault: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case username
        case role
        case allowAdultContent = "allow_adult_content"
        case avatar
        case avatarIsDefault = "avatar_is_default"
    }

    init(id: Int, username: String, role: String, allowAdultContent: Bool = false, avatar: String? = nil,
         avatarIsDefault: Bool = false) {
        self.id = id
        self.username = username
        self.role = role
        self.allowAdultContent = allowAdultContent
        self.avatar = avatar
        self.avatarIsDefault = avatarIsDefault
    }

    /// Whether this user has the admin role.
    ///
    /// 该用户是否为管理员角色.
    var isAdmin: Bool { role == "admin" }

    /// The role's user-facing name: "Admin" or "Regular User".
    ///
    /// 角色面向用户的名称: "Admin" 或 "Regular User".
    var roleDisplayName: String {
        isAdmin ? String(localized: "Admin") : String(localized: "Regular User")
    }

    /// Whether the user uploaded an avatar that can be removed. Servers before default avatars
    /// omit `avatar` for users without one.
    ///
    /// 用户是否上传了可删除的头像. 早于默认头像的服务端在用户没有头像时不返回 `avatar`.
    var hasUploadedAvatar: Bool {
        !(avatar ?? "").isEmpty && !avatarIsDefault
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(Int.self, forKey: .id)
        username = try container.decode(String.self, forKey: .username)
        role = try container.decode(String.self, forKey: .role)
        allowAdultContent = try container.decodeIfPresent(Bool.self, forKey: .allowAdultContent) ?? false
        avatar = try container.decodeIfPresent(String.self, forKey: .avatar)
        avatarIsDefault = try container.decodeIfPresent(Bool.self, forKey: .avatarIsDefault) ?? false
    }
}

/// Login response containing user fields and an opaque bearer token.
///
/// 登录响应, 包含用户字段和 opaque bearer token.
struct LoginResponse: Codable, Sendable {
    let user: User
    let accessToken: String
    let expiresAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case username
        case role
        case allowAdultContent = "allow_adult_content"
        case avatar
        case avatarIsDefault = "avatar_is_default"
        case accessToken = "access_token"
        case expiresAt = "expires_at"
    }

    /// Decodes the flattened login response into a nested user object.
    ///
    /// 将扁平登录响应解码为嵌套 user 对象.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        user = User(
            id: try container.decode(Int.self, forKey: .id),
            username: try container.decode(String.self, forKey: .username),
            role: try container.decode(String.self, forKey: .role),
            allowAdultContent: try container.decodeIfPresent(Bool.self, forKey: .allowAdultContent) ?? false,
            avatar: try container.decodeIfPresent(String.self, forKey: .avatar),
            avatarIsDefault: try container.decodeIfPresent(Bool.self, forKey: .avatarIsDefault) ?? false
        )
        accessToken = try container.decode(String.self, forKey: .accessToken)
        expiresAt = try container.decode(Date.self, forKey: .expiresAt)
    }

    /// Encodes the login response back to the backend's flattened JSON shape.
    ///
    /// 按后端扁平 JSON 结构重新编码登录响应.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(user.id, forKey: .id)
        try container.encode(user.username, forKey: .username)
        try container.encode(user.role, forKey: .role)
        try container.encode(user.allowAdultContent, forKey: .allowAdultContent)
        try container.encodeIfPresent(user.avatar, forKey: .avatar)
        try container.encode(user.avatarIsDefault, forKey: .avatarIsDefault)
        try container.encode(accessToken, forKey: .accessToken)
        try container.encode(expiresAt, forKey: .expiresAt)
    }
}

/// Login request payload.
///
/// 登录请求载荷.
struct LoginRequest: Codable, Sendable {
    let username: String
    let password: String
}

/// Profile update request payload.
///
/// 用户资料更新请求载荷.
struct ProfileRequest: Codable, Sendable {
    let username: String
}

/// Password change request payload.
///
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
///
/// 后端标准 message 响应.
struct MessageResponse: Codable, Sendable {
    let message: String
}
