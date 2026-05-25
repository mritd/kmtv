import Foundation
import Security

/// Keychain payload for an opaque bearer token.
/// opaque bearer token 的 Keychain 存储载荷.
struct AuthCredential: Codable, Equatable, Sendable {
    let accessToken: String
    let expiresAt: Date
}

/// Errors returned by AuthStore when Keychain operations fail.
/// AuthStore 在 Keychain 操作失败时返回的错误.
enum AuthStoreError: Error {
    case keychainStatus(OSStatus)
}

/// Stores bearer tokens outside SwiftData so model backups do not expose credentials.
/// 将 bearer token 存储在 SwiftData 之外, 避免模型备份暴露凭据.
struct AuthStore: Sendable {
    private let service = "com.mritd.kmtv.auth"
    private let account: String

    /// Creates a token store scoped to one normalized server URL.
    /// 创建按归一化服务器地址隔离的 token 存储.
    init(serverURL: String) {
        account = serverURL.hasSuffix("/") ? String(serverURL.dropLast()) : serverURL
    }

    /// Saves a bearer token and expiration timestamp to Keychain.
    /// 将 bearer token 与过期时间保存到 Keychain.
    func save(accessToken: String, expiresAt: Date) throws {
        let credential = AuthCredential(accessToken: accessToken, expiresAt: expiresAt)
        let data = try JSONEncoder().encode(credential)
        var query = baseQuery()
        SecItemDelete(query as CFDictionary)
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw AuthStoreError.keychainStatus(status)
        }
    }

    /// Loads a non-expired bearer token from Keychain.
    /// 从 Keychain 加载未过期的 bearer token.
    ///
    /// Corrupt or expired credentials are removed immediately so callers do not reuse them.
    /// 损坏或过期的凭据会被立即删除, 避免调用方继续复用.
    func load(now: Date = Date()) -> AuthCredential? {
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else {
            return nil
        }
        guard let credential = try? JSONDecoder().decode(AuthCredential.self, from: data) else {
            clear()
            return nil
        }
        guard credential.expiresAt > now else {
            clear()
            return nil
        }
        return credential
    }

    /// Removes the stored credential for this server.
    /// 删除当前服务器对应的已保存凭据.
    func clear() {
        SecItemDelete(baseQuery() as CFDictionary)
    }

    /// Builds the common Keychain query for this service/account pair.
    /// 构造当前 service/account 对应的通用 Keychain 查询.
    private func baseQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }
}
