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

/// UserDefaults storage of the last identity and of every identity that has used downloads on
/// this device. Signing out clears only the last identity; the known ones keep their downloads
/// watchable offline whatever server or account the app is set up with.
///
/// 最后登录身份, 以及在本机使用过下载的所有身份的 UserDefaults 存储. 登出只清除最后登录身份; 已知身份
/// 的下载无论 App 当前配置了哪个服务器或账号, 都可以离线观看.
struct LastIdentityStore {
    static let key = "kmtv.downloads.lastIdentity"
    static let knownKey = "kmtv.downloads.knownIdentities"
    /// How many identities `known()` keeps.
    ///
    /// `known()` 最多保留的身份数量.
    static let knownLimit = 20
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

    /// Saves an identity as the last one and moves it to the front of the known identities.
    ///
    /// 将身份保存为最后登录身份, 并移到已知身份列表的最前面.
    func save(_ identity: DownloadIdentity) {
        if let data = try? JSONEncoder().encode(identity) { defaults.set(data, forKey: Self.key) }
        let others = known().filter { $0.scopeKey != identity.scopeKey }
        let list = Array(([identity] + others).prefix(Self.knownLimit))
        if let data = try? JSONEncoder().encode(list) { defaults.set(data, forKey: Self.knownKey) }
    }

    /// Every identity that has used downloads here, most recent first; installs from before the
    /// list existed report their last identity.
    ///
    /// 在本机使用过下载的所有身份, 最近使用的在前; 列表出现之前的安装会返回其最后登录身份.
    func known() -> [DownloadIdentity] {
        if let data = defaults.data(forKey: Self.knownKey),
           let list = try? JSONDecoder().decode([DownloadIdentity].self, from: data) {
            return list
        }
        return load().map { [$0] } ?? []
    }

    /// Removes the last identity; the known identities stay.
    ///
    /// 删除最后登录身份; 已知身份保持不变.
    func clear() {
        if defaults.data(forKey: Self.knownKey) == nil, let last = load(),
           let data = try? JSONEncoder().encode([last]) {
            defaults.set(data, forKey: Self.knownKey)
        }
        defaults.removeObject(forKey: Self.key)
    }
}

/// What the app view model needs from downloads, so it compiles on every platform and tests can
/// use a fake.
///
/// App 视图模型需要的下载能力; 借此在所有平台上都能编译, 测试中也可以使用假实现.
@MainActor
protocol DownloadScopeControlling: AnyObject {
    /// The scope whose downloads are shown, signed in or offline; nil when none is.
    ///
    /// 正在展示其下载的作用域 (已登录或离线); 没有时为 nil.
    var activeScopeKey: String? { get }
    func activate(scopeKey: String, preparer: any DownloadPreparing) async
    func openOffline(scopeKey: String)
    func deactivate() async
    /// Queues `deactivate` at once without waiting for it; see `DownloadManager.beginDeactivate()`.
    ///
    /// 立即排入 `deactivate` 而不等待其完成; 参见 `DownloadManager.beginDeactivate()`.
    @discardableResult
    func beginDeactivate() -> Task<Void, Never>
    func deleteScope(_ scopeKey: String) async
    /// Whether the device has any completed download, whatever its server or account.
    ///
    /// 本机是否有任何已完成的下载, 无论其服务器或账号.
    var hasCompletedDownloads: Bool { get }
}

/// Completed downloads the online player can use instead of streaming.
///
/// 在线播放器可以替代流媒体使用的已完成下载.
@MainActor
protocol LocalEpisodeProviding: AnyObject {
    /// Loopback URL of a completed download of exactly this source, video, and episode, made under
    /// any account; downloads are local first whoever is signed in.
    ///
    /// 与该来源, 视频和剧集完全一致的已完成下载的 loopback URL, 可以来自任一账号; 无论谁登录, 下载都是
    /// 本地优先.
    func localPlaybackURL(showKey: String, sourceKey: String, videoId: String, episodeIndex: Int) async -> URL?
    /// Reports that playing this download failed. The download is marked damaged only when its
    /// files are missing; intact files are kept.
    ///
    /// 上报该下载播放失败. 只有文件缺失时才标记为已损坏; 文件完好时保留.
    func reportPlaybackFailure(showKey: String, sourceKey: String, videoId: String, episodeIndex: Int)
}
