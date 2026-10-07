import Foundation

#if os(iOS)
/// Known-good covers by normalized title, learned from the Douban cards the app shows.
///
/// Some sources' image hosts answer 403 to every request, and watch history or favorites saved
/// from them keep that cover. Artwork that fails to load looks its title up here instead, and the
/// home screen passes the registered cover as the cover hint, so the record heals on the next save.
/// Covers are kept as the raw strings the server sent (server-relative paths stay relative, as in
/// synced records) and resolved against the server that registered them last. It is a display
/// cache in `UserDefaults`, capped at `limit` entries with the least recently registered evicted
/// first, and never synced. It also remembers cover URLs whose host refused them outright, so
/// artwork skips straight to a working cover instead of showing a placeholder while a known-bad
/// request fails again.
///
/// 按归一化标题记录的可用封面, 来自 App 展示过的豆瓣卡片.
///
/// 部分源站的图片服务器对所有请求返回 403, 从这些源保存的观看历史或收藏会沿用该封面. 加载失败的图片
/// 会改为按标题在这里查找, 首页也会把登记的封面作为封面提示传下去, 因此记录会在下一次保存时被修正.
/// 封面按服务端返回的原始字符串保存 (服务端相对路径保持相对, 与同步记录一致), 并按最近一次登记它们的
/// 服务器解析. 它是保存在 `UserDefaults` 中的展示缓存, 最多保存 `limit` 条, 优先淘汰最早登记的条目,
/// 不会同步. 它还会记住被图片服务器明确拒绝的封面 URL, 使图片直接改用可用封面, 不再在已知会失败的
/// 请求再次失败前显示占位.
@MainActor
enum CoverRegistry {
    static let limit = 600
    static let brokenLimit = 300
    private static let brokenKey = "covers.broken"
    private static let coversKey = "covers.byTitle"
    private static let orderKey = "covers.order"
    private static let baseURLKey = "covers.baseURL"
    private static var defaults = UserDefaults.standard
    private static var covers: [String: String] = defaults.dictionary(forKey: coversKey)
        as? [String: String] ?? [:]
    // Keys from least to most recently registered.
    //
    // 按登记时间从早到晚排列的键.
    private static var order: [String] = defaults.stringArray(forKey: orderKey) ?? []
    private static var baseURL = defaults.string(forKey: baseURLKey) ?? ""
    // Refused cover URLs, oldest first.
    //
    // 被拒绝的封面 URL, 按时间从早到晚排列.
    private static var broken: [String] = defaults.stringArray(forKey: brokenKey) ?? []

    /// Records Douban cards as served by the server at `baseURL`; cards without a cover are skipped.
    ///
    /// 记录 `baseURL` 所指服务器返回的豆瓣卡片; 没有封面的卡片会被跳过.
    static func remember(_ items: [DoubanItem], baseURL: String) {
        remember(items.map { (title: $0.title, cover: $0.cover) }, baseURL: baseURL)
    }

    /// Records raw `(title, cover)` pairs from the server at `baseURL`.
    ///
    /// 记录来自 `baseURL` 所指服务器的原始 `(标题, 封面)` 对.
    static func remember(_ items: [(title: String, cover: String)], baseURL: String) {
        var changed = baseURL != self.baseURL
        self.baseURL = baseURL
        for item in items where !item.cover.isEmpty {
            let key = normalizeSyncKey(item.title)
            guard !key.isEmpty else { continue }
            if covers[key] != item.cover {
                covers[key] = item.cover
                changed = true
            }
            if order.last != key {
                order.removeAll { $0 == key }
                order.append(key)
                changed = true
            }
        }
        guard changed else { return }
        if order.count > limit {
            for key in order.prefix(order.count - limit) { covers[key] = nil }
            order.removeFirst(order.count - limit)
        }
        defaults.set(covers, forKey: coversKey)
        defaults.set(order, forKey: orderKey)
        defaults.set(baseURL, forKey: baseURLKey)
    }

    /// The registered cover for `title`, as the raw string the server sent.
    ///
    /// `title` 已登记的封面, 即服务端返回的原始字符串.
    static func rawCover(for title: String) -> String? {
        covers[normalizeSyncKey(title)]
    }

    /// The registered cover for `title`, resolved against the server that registered it.
    ///
    /// `title` 已登记的封面, 按登记它的服务器解析为 URL.
    static func cover(for title: String) -> URL? {
        guard let raw = rawCover(for: title) else { return nil }
        return URL(string: raw.hasPrefix("/") ? baseURL + raw : raw)
    }

    /// Remembers `url` as broken when its host answered 403, 404, or 410. Other statuses and
    /// network errors may pass, and covers from the server itself are never marked, since a
    /// refusal there means the session, not the image.
    ///
    /// 图片服务器返回 403, 404 或 410 时, 将 `url` 记为失效. 其他状态码与网络错误可能是暂时的, 服务端
    /// 自身的封面也从不标记, 因为那里的拒绝反映的是会话状态, 而不是图片本身.
    static func markBroken(_ url: URL, status: Int) {
        guard [403, 404, 410].contains(status) else { return }
        if let server = URL(string: baseURL), server.host == url.host, server.port == url.port { return }
        let key = url.absoluteString
        guard !broken.contains(key) else { return }
        broken.append(key)
        if broken.count > brokenLimit { broken.removeFirst(broken.count - brokenLimit) }
        defaults.set(broken, forKey: brokenKey)
    }

    /// Whether `url` was marked broken.
    ///
    /// `url` 是否已被标记为失效.
    static func isBroken(_ url: URL) -> Bool {
        broken.contains(url.absoluteString)
    }

    /// Switches the registry to `store` and loads what it holds; tests use their own suite so they
    /// never touch the host app's registry.
    ///
    /// 将登记表切换到 `store` 并载入其中的内容; 测试使用独立的 suite, 不会改动宿主 App 的登记表.
    static func use(_ store: UserDefaults) {
        defaults = store
        covers = store.dictionary(forKey: coversKey) as? [String: String] ?? [:]
        order = store.stringArray(forKey: orderKey) ?? []
        baseURL = store.string(forKey: baseURLKey) ?? ""
        broken = store.stringArray(forKey: brokenKey) ?? []
    }

    /// Clears the registry in its current store; for tests.
    ///
    /// 清空当前存储中的登记表; 供测试使用.
    static func reset() {
        for key in [coversKey, orderKey, baseURLKey, brokenKey] { defaults.removeObject(forKey: key) }
        use(defaults)
    }
}
#endif
