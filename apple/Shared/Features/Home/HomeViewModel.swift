import Foundation
import SwiftData
import os

@Observable
@MainActor
final class HomeViewModel {
    var sections: [HomeSection] = []
    var watchHistory: [WatchHistoryItem] = []
    var heroItems: [DoubanItem] = []
    var isLoading = false
    var error: String?

    private let logger = Logger(subsystem: "com.mritd.kmtv", category: "api")
    /// Protocol dependency keeps Douban home loading replaceable in unit tests.
    /// 使用协议依赖让 Douban 首页加载可以在单元测试中替换.
    private let apiClient: any DoubanAPIProtocol
    private let modelContext: ModelContext
    private let serverURL: String

    init(apiClient: any DoubanAPIProtocol, modelContext: ModelContext, serverURL: String) {
        self.apiClient = apiClient
        self.modelContext = modelContext
        self.serverURL = serverURL
    }

    func load() async {
        let isInitialLoad = sections.isEmpty
        if isInitialLoad {
            isLoading = true
        }
        // Watch history is local SwiftData, so refresh it before the remote home feed returns.
        // 观看历史来自本地 SwiftData, 先刷新它再等待远端首页数据.
        loadWatchHistory()

        let client = self.apiClient
        do {
            // Run network decoding off the main actor while keeping UI state updates on MainActor.
            // 将网络解码放到 MainActor 之外执行, UI 状态更新仍留在 MainActor.
            let response: DoubanHomeResponse = try await Task.detached {
                try await client.doubanHome()
            }.value
            sections = response.sections
            if let firstSection = sections.first, !firstSection.items.isEmpty {
                heroItems = Array(firstSection.items.prefix(5))
            }
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
            // iPad 播放页背后可能仍挂载首页, 因此被动信息流失败只保留在本页.
            self.error = message
            #else
            ToastManager.shared.show(message)
            #endif
        }
        isLoading = false
    }

    func loadWatchHistory() {
        watchHistory = WatchHistoryItem.recent(in: modelContext, serverURL: serverURL)
    }

    func clearWatchHistory() {
        WatchHistoryItem.clearAll(in: modelContext, serverURL: serverURL)
        try? modelContext.save()
        watchHistory = []
    }
}
