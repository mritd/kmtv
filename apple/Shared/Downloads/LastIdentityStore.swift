import Foundation

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
