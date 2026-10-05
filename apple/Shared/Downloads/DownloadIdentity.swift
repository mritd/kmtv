import Foundation

/// The last signed-in identity (no token), kept so an offline launch can open its downloads.
///
/// 最后一次登录的身份 (不含 token), 离线启动时据此打开对应的下载内容.
struct DownloadIdentity: Codable, Equatable, Sendable {
    let serverURL: String
    let userID: Int64
    let username: String

    /// Sync scope of this identity.
    ///
    /// 该身份对应的同步作用域.
    var scopeKey: String { syncScopeKey(serverURL: serverURL, userID: userID) }

    /// Whether `serverURL` is the same server after `syncScopeKey` normalization.
    ///
    /// 经 `syncScopeKey` 规范化后, `serverURL` 是否是同一个服务器.
    func matches(serverURL other: String) -> Bool {
        syncScopeKey(serverURL: serverURL, userID: 0) == syncScopeKey(serverURL: other, userID: 0)
    }
}

/// UserDefaults storage of the last identity.
///
/// 最后登录身份的 UserDefaults 存储.
struct LastIdentityStore {
    static let key = "kmtv.downloads.lastIdentity"
    let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    /// The saved identity, if any.
    ///
    /// 已保存的身份 (如有).
    func load() -> DownloadIdentity? {
        defaults.data(forKey: Self.key).flatMap { try? JSONDecoder().decode(DownloadIdentity.self, from: $0) }
    }

    /// Saves an identity.
    ///
    /// 保存身份.
    func save(_ identity: DownloadIdentity) {
        if let data = try? JSONEncoder().encode(identity) { defaults.set(data, forKey: Self.key) }
    }

    /// Removes the saved identity.
    ///
    /// 删除已保存的身份.
    func clear() {
        defaults.removeObject(forKey: Self.key)
    }
}
