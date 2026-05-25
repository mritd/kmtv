import Foundation

extension APIClient {

    /// Logs in with username/password and returns an opaque bearer token response.
    /// 使用用户名和密码登录, 返回 opaque bearer token 响应.
    func login(username: String, password: String) async throws -> LoginResponse {
        try await post("/api/v1/auth/login", body: LoginRequest(username: username, password: password))
    }

    /// Logs out the current bearer token on the server.
    /// 在服务端注销当前 bearer token.
    ///
    /// A shorter timeout can be passed when logout is best-effort and should not block
    /// local cleanup.
    /// 当登出只是尽力操作且不应阻塞本地清理时, 可以传入较短 timeout.
    func logout(timeoutInterval: TimeInterval? = nil) async throws {
        let url = try buildURL(path: "/api/v1/auth/logout")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        if let timeoutInterval {
            request.timeoutInterval = timeoutInterval
        }
        let _: MessageResponse = try await perform(request)
    }

    /// Fetches the current user for the active bearer token.
    /// 获取当前 bearer token 对应的用户.
    func me() async throws -> User {
        try await get("/api/v1/auth/me")
    }

    /// Updates the current user's profile fields.
    /// 更新当前用户的个人资料字段.
    func updateProfile(username: String) async throws -> User {
        try await put("/api/v1/auth/profile", body: ProfileRequest(username: username))
    }

    /// Changes the current user's password.
    /// 修改当前用户密码.
    func changePassword(oldPassword: String, newPassword: String) async throws {
        let _: MessageResponse = try await put("/api/v1/auth/password", body: PasswordRequest(oldPassword: oldPassword, newPassword: newPassword))
    }

    /// Deletes the current user's avatar and returns the refreshed user profile.
    /// 删除当前用户头像并返回刷新后的用户资料.
    func deleteAvatar() async throws -> User {
        try await deleteReturning("/api/v1/auth/avatar")
    }
}
