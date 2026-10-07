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

    var heroItems: [DoubanItem] = []
    var isLoading = false
    var error: String?

    private let logger = Logger(subsystem: "com.mritd.kmtv", category: "api")
    /// Protocol dependency keeps Douban home loading replaceable in unit tests.
    ///
    /// 使用协议依赖让 Douban 首页加载可以在单元测试中替换.
    private let apiClient: any DoubanAPIProtocol
    private let syncStore: SyncStore?
    private let syncEngine: SyncEngine?

    /// Continue watching: the newest 10 unfinished titles from the sync store.
    ///
    /// 继续观看: 同步存储中最新的 10 个未看完标题.
    var watchHistory: [WatchPayload] {
        Array((syncStore?.watchItems ?? []).filter { !$0.completed }.prefix(10))
    }

    init(apiClient: any DoubanAPIProtocol, syncStore: SyncStore?, syncEngine: SyncEngine?) {
        self.apiClient = apiClient
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

        let client = self.apiClient
        do {
            // Run network decoding off the main actor while keeping UI state updates on MainActor.
            //
            // 将网络解码放到 MainActor 之外执行, UI 状态更新仍留在 MainActor.
            let response: DoubanHomeResponse = try await Task.detached {
                try await client.doubanHome()
            }.value
            sections = response.sections
            #if os(iOS)
            CoverRegistry.remember(sections.flatMap(\.items), baseURL: (client as? APIClient)?.baseURL ?? "")
            #endif
            let candidates = Self.heroCandidates(sections)
            if !candidates.isEmpty { heroItems = candidates }
            error = nil
        } catch {
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
