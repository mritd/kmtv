import Foundation
import os

@Observable
@MainActor
final class HomeViewModel {
    var sections: [HomeSection] = []
    /// Hero items: titles with a synopsis across all sections first, as on Web, so the hero has
    /// copy to show; the first section's titles fill the rest. Unique by Douban ID, at most `limit`.
    ///
    /// Hero 条目: 与 Web 一致, 优先选取所有分区中带简介的作品, 使 hero 有文案可展示; 不足时用第一个
    /// 分区的作品补齐. 按 Douban ID 去重, 最多 `limit` 个.
    static func heroCandidates(_ sections: [HomeSection], limit: Int = 5) -> [DoubanItem] {
        var seen = Set<String>()
        var picked: [DoubanItem] = []
        let described = sections.flatMap(\.items).filter { !($0.desc ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        for item in described + (sections.first?.items ?? []) where picked.count < limit {
            guard !item.title.isEmpty, seen.insert(item.id).inserted else { continue }
            picked.append(item)
        }
        return picked
    }

    var heroItems: [DoubanItem] = [] {
        didSet {
            // Assigning an observed property from its own didSet recurses, so only heroIndex is written.
            //
            // 在被观察属性自身的 didSet 中给它赋值会递归, 因此这里只写 heroIndex.
            let clamped = Self.clampedHeroIndex(heroIndex, count: heroItems.count)
            if clamped != heroIndex { heroIndex = clamped }
        }
    }
    /// Selected hero page; kept in range when a refresh shrinks `heroItems`. The view only sets
    /// indexes of existing pages.
    ///
    /// 当前 hero 页; 刷新使 `heroItems` 变少时保持在有效范围内. 视图只会设置已有页面的下标.
    var heroIndex = 0

    /// Clamps a hero page index into `0..<count` (0 when there are no items).
    ///
    /// 将 hero 页下标限制在 `0..<count` 内 (无条目时为 0).
    static func clampedHeroIndex(_ index: Int, count: Int) -> Int {
        max(0, min(index, count - 1))
    }
    var isLoading = false
    var error: String?

    private let logger = Logger(subsystem: "com.mritd.kmtv", category: "api")
    /// Protocol dependency keeps Douban home loading replaceable in unit tests.
    ///
    /// 使用协议依赖让 Douban 首页加载可以在单元测试中替换.
    private let apiClient: any DoubanAPIProtocol
    private let syncStore: SyncStore?
    private let syncEngine: SyncEngine?
    private let baseURL: String

    /// Continue watching: the newest 10 unfinished titles from the sync store.
    ///
    /// 继续观看: 同步存储中最新的 10 个未看完标题.
    var watchHistory: [WatchPayload] {
        Array((syncStore?.watchItems ?? []).filter { !$0.completed }.prefix(10))
    }

    init(apiClient: any DoubanAPIProtocol, baseURL: String = "", syncStore: SyncStore?, syncEngine: SyncEngine?) {
        self.apiClient = apiClient
        self.baseURL = baseURL
        self.syncStore = syncStore
        self.syncEngine = syncEngine
    }

    func load() async {
        let isInitialLoad = sections.isEmpty
        if isInitialLoad {
            isLoading = true
        }
        // Ask the engine for a throttled page sync without blocking the feed.
        //
        // 请求一次限频的页面同步, 不阻塞首页内容加载.
        refreshWatchHistory()

        do {
            // The client call is already async and off the main actor; staying in this task lets a
            // cancelled refresh cancel the request.
            //
            // 客户端调用本身是异步且不占用主线程; 留在当前任务内可让被取消的刷新一并取消请求.
            let response = try await apiClient.doubanHome()
            sections = response.sections
            #if os(iOS)
            CoverRegistry.remember(sections.flatMap(\.items), baseURL: baseURL)
            #endif
            let candidates = Self.heroCandidates(sections)
            if !candidates.isEmpty { heroItems = candidates }
            error = nil
        } catch {
            if Task.isCancelled || error is CancellationError {
                isLoading = false
                return
            }
            logger.error("Home load failed: \(error.localizedDescription)")
            let message: String
            if let apiError = error as? APIError {
                message = apiError.localizedMessage
            } else {
                message = error.localizedDescription
            }
            #if os(iOS)
            // Home can remain mounted behind iPad playback, so keep passive feed failures local.
            //
            // iPad 播放页背后可能仍挂载首页, 因此被动信息流失败只保留在本页.
            self.error = message
            #else
            ToastManager.shared.show(message)
            #endif
        }
        isLoading = false
    }

    /// Asks the engine for a throttled page sync without blocking the feed.
    ///
    /// 请求一次限频的页面同步, 不阻塞首页内容加载.
    func refreshWatchHistory() {
        guard let syncEngine else { return }
        Task { await syncEngine.requestSync(.page) }
    }

    /// Clears continue watching on this device and, once pushed, on every device.
    ///
    /// 清空本设备的继续观看, 推送后所有设备同步清空.
    func clearWatchHistory() {
        syncStore?.clear(.watch)
    }
}
