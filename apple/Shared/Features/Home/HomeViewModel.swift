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
    private let apiClient: any HomeAPIProtocol
	private let modelContext: ModelContext
	private let serverURL: String
	private let userID: Int64

	init(apiClient: any HomeAPIProtocol, modelContext: ModelContext, serverURL: String, userID: Int64 = 0) {
        self.apiClient = apiClient
        self.modelContext = modelContext
		self.serverURL = serverURL
		self.userID = userID
    }

    func load() async {
        let isInitialLoad = sections.isEmpty
        if isInitialLoad {
            isLoading = true
        }
        // Watch history is remote-first with SwiftData as fallback/cache.
        // 观看历史采用远端优先, SwiftData 作为兜底和缓存.
        await loadRemoteWatchHistory()

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
		watchHistory = WatchHistoryItem.recent(in: modelContext, serverURL: serverURL, userID: userID)
    }

	func loadRemoteWatchHistory() async {
		guard userID > 0 else {
			loadWatchHistory()
			return
		}
		do {
			let response = try await apiClient.listWatchHistory(limit: 10)
			let visibleItems = response.items.filter { !$0.completed }
			WatchHistoryItem.clearAll(in: modelContext, serverURL: serverURL, userID: userID)
			for item in visibleItems {
                WatchHistoryItem.upsert(
                    in: modelContext,
					serverURL: serverURL,
					userID: userID,
                    sourceKey: item.sourceKey,
                    videoId: item.videoId,
                    title: item.title,
                    cover: item.cover,
                    episode: item.episode,
					groupIndex: item.groupIndex,
                    episodeIndex: item.episodeIndex,
                    progress: item.progressSec,
                    duration: item.durationSec
                )
            }
            try? modelContext.save()
            watchHistory = visibleItems.map { item in
				WatchHistoryItem(
					serverURL: serverURL,
					userID: userID,
                    sourceKey: item.sourceKey,
                    videoId: item.videoId,
                    title: item.title,
                    cover: item.cover,
                    episode: item.episode,
					groupIndex: item.groupIndex,
                    episodeIndex: item.episodeIndex,
                    progress: item.progressSec,
                    duration: item.durationSec,
                    updatedAt: item.updatedAt ?? .now
                )
            }
        } catch {
            loadWatchHistory()
        }
    }

	func clearWatchHistory() async {
		do {
			if userID > 0 {
				try await apiClient.clearRemoteWatchHistory()
			}
			WatchHistoryItem.clearAll(in: modelContext, serverURL: serverURL, userID: userID)
			try? modelContext.save()
			watchHistory = []
		} catch {
			logger.error("Clear watch history failed: \(error.localizedDescription)")
		}
	}
}
