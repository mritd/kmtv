import Foundation
import Observation

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
/// request fails again. The app creates one over `UserDefaults.standard` and passes it through the
/// environment and to the view models; tests create their own over a separate suite.
///
/// 按归一化标题记录的可用封面, 来自 App 展示过的豆瓣卡片.
///
/// 部分源站的图片服务器对所有请求返回 403, 从这些源保存的观看历史或收藏会沿用该封面. 加载失败的图片
/// 会改为按标题在这里查找, 首页也会把登记的封面作为封面提示传下去, 因此记录会在下一次保存时被修正.
/// 封面按服务端返回的原始字符串保存 (服务端相对路径保持相对, 与同步记录一致), 并按最近一次登记它们的
/// 服务器解析. 它是保存在 `UserDefaults` 中的展示缓存, 最多保存 `limit` 条, 优先淘汰最早登记的条目,
/// 不会同步. 它还会记住被图片服务器明确拒绝的封面 URL, 使图片直接改用可用封面, 不再在已知会失败的
/// 请求再次失败前显示占位. App 基于 `UserDefaults.standard` 创建一个实例, 通过环境传给视图并传给视图模型;
/// 测试基于独立的 suite 创建自己的实例.
@Observable
@MainActor
final class CoverRegistry {
    static let limit = 600
    static let brokenLimit = 300
    private static let brokenKey = "covers.broken"
    private static let coversKey = "covers.byTitle"
    private static let orderKey = "covers.order"
    private static let baseURLKey = "covers.baseURL"

    private let defaults: UserDefaults
    // Nothing here is observed: artwork reads the registry only while it picks a URL, so a burst of
    // refused covers or a home load never re-renders every artwork on screen.
    //
    // 这里的状态都不被观察: 图片只在挑选 URL 时读取登记表, 因此一批被拒绝的封面或一次首页加载
    // 不会让屏幕上所有图片重新渲染.
    @ObservationIgnored private var covers: [String: String]
    // Keys from least to most recently registered.
    //
    // 按登记时间从早到晚排列的键.
    @ObservationIgnored private var order: [String]
    @ObservationIgnored private var baseURL: String
    // Refused cover URLs: a set for lookups and the same URLs oldest first for eviction.
    //
    // 被拒绝的封面 URL: 集合用于查找, 同样的 URL 按时间从早到晚排列用于淘汰.
    @ObservationIgnored private var broken: Set<String>
    @ObservationIgnored private var brokenOrder: [String]

    /// Loads the registry that `defaults` holds and keeps it there.
    ///
    /// 载入 `defaults` 中保存的登记表, 并继续保存在其中.
    init(defaults: UserDefaults) {
        self.defaults = defaults
        covers = defaults.dictionary(forKey: Self.coversKey) as? [String: String] ?? [:]
        order = defaults.stringArray(forKey: Self.orderKey) ?? []
        baseURL = defaults.string(forKey: Self.baseURLKey) ?? ""
        brokenOrder = defaults.stringArray(forKey: Self.brokenKey) ?? []
        broken = Set(brokenOrder)
    }

    /// Records Douban cards as served by the server at `baseURL`; cards without a cover are skipped.
    ///
    /// 记录 `baseURL` 所指服务器返回的豆瓣卡片; 没有封面的卡片会被跳过.
    func remember(_ items: [DoubanItem], baseURL: String) {
        remember(items.map { (title: $0.title, cover: $0.cover) }, baseURL: baseURL)
    }

    /// Records raw `(title, cover)` pairs from the server at `baseURL`.
    ///
    /// 记录来自 `baseURL` 所指服务器的原始 `(标题, 封面)` 对.
    func remember(_ items: [(title: String, cover: String)], baseURL: String) {
        // `changed` gates the UserDefaults writes, so an unchanged page writes nothing.
        //
        // `changed` 决定是否写入 UserDefaults, 因此内容未变的页面不会产生写入.
        var changed = false
        if baseURL != self.baseURL {
            self.baseURL = baseURL
            changed = true
        }
        var covers = self.covers
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
        if order.count > Self.limit {
            for key in order.prefix(order.count - Self.limit) { covers[key] = nil }
            order.removeFirst(order.count - Self.limit)
        }
        if covers != self.covers { self.covers = covers }
        defaults.set(covers, forKey: Self.coversKey)
        defaults.set(order, forKey: Self.orderKey)
        defaults.set(baseURL, forKey: Self.baseURLKey)
    }

    /// The registered cover for `title`, as the raw string the server sent.
    ///
    /// `title` 已登记的封面, 即服务端返回的原始字符串.
    func rawCover(for title: String) -> String? {
        covers[normalizeSyncKey(title)]
    }

    /// The registered cover for `title`, resolved against the server that registered it.
    ///
    /// `title` 已登记的封面, 按登记它的服务器解析为 URL.
    func cover(for title: String) -> URL? {
        resolveAssetURL(rawCover(for: title), baseURL: baseURL)
    }

    /// Remembers `url` as broken when its host answered 403, 404, or 410. Other statuses and
    /// network errors may pass, and covers from the server itself are never marked, since a
    /// refusal there means the session, not the image.
    ///
    /// 图片服务器返回 403, 404 或 410 时, 将 `url` 记为失效. 其他状态码与网络错误可能是暂时的, 服务端
    /// 自身的封面也从不标记, 因为那里的拒绝反映的是会话状态, 而不是图片本身.
    func markBroken(_ url: URL, status: Int) {
        guard [403, 404, 410].contains(status) else { return }
        if let server = URL(string: baseURL), server.host == url.host, server.port == url.port { return }
        let key = url.absoluteString
        guard !broken.contains(key) else { return }
        var broken = self.broken
        broken.insert(key)
        brokenOrder.append(key)
        if brokenOrder.count > Self.brokenLimit {
            for evicted in brokenOrder.prefix(brokenOrder.count - Self.brokenLimit) { broken.remove(evicted) }
            brokenOrder.removeFirst(brokenOrder.count - Self.brokenLimit)
        }
        self.broken = broken
        defaults.set(brokenOrder, forKey: Self.brokenKey)
    }

    /// Whether `url` was marked broken.
    ///
    /// `url` 是否已被标记为失效.
    func isBroken(_ url: URL) -> Bool {
        broken.contains(url.absoluteString)
    }
}
