import Foundation

/// A signed-in identity (no token), kept so its downloads can open offline.
///
/// 登录过的身份 (不含 token), 保留下来以便离线打开其下载内容.
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
