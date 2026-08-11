import Foundation
import SwiftData

/// SwiftData cache row for one title's playback state.
/// Cache identity is `(serverURL, userID, title)`: authenticated users never reuse
/// anonymous user `0` rows, and signing in does not merge anonymous history.
///
/// 单个标题播放状态的 SwiftData 缓存行. 缓存 identity 为
/// `(serverURL, userID, title)`: 已登录用户不会复用匿名用户 `0` 的记录,
/// 登录时也不会合并匿名观看历史.
@Model
final class WatchHistoryItem {
	var serverURL: String
	var userID: Int64 = 0
    var sourceKey: String
    var videoId: String
    var title: String
    var cover: String
    var episode: String
	var groupIndex: Int = 0
    var episodeIndex: Int
    var progress: Double
    var duration: Double
    var updatedAt: Date

	init(serverURL: String, userID: Int64 = 0, sourceKey: String, videoId: String, title: String,
         cover: String, episode: String, groupIndex: Int = 0, episodeIndex: Int,
         progress: Double, duration: Double, updatedAt: Date = .now) {
		self.serverURL = serverURL
		self.userID = userID
        self.sourceKey = sourceKey
        self.videoId = videoId
        self.title = title
        self.cover = cover
        self.episode = episode
		self.groupIndex = groupIndex
        self.episodeIndex = episodeIndex
        self.progress = progress
        self.duration = duration
        self.updatedAt = updatedAt
    }

    /// Inserts or replaces the title row inside one server/user cache scope.
    /// `sourceKey` and `videoId` record the exact provider entry used for resume.
    ///
    /// 在单个服务器与用户缓存范围内插入或替换标题记录. `sourceKey` 和 `videoId`
    /// 保存续播时使用的准确视频源条目.
	static func upsert(in context: ModelContext, serverURL: String, userID: Int64 = 0, sourceKey: String, videoId: String,
                        title: String, cover: String, episode: String, groupIndex: Int = 0, episodeIndex: Int,
                        progress: Double, duration: Double) {
        let descriptor = FetchDescriptor<WatchHistoryItem>(
			predicate: #Predicate { $0.serverURL == serverURL && $0.userID == userID && $0.title == title }
        )
        if let existing = try? context.fetch(descriptor).first {
            existing.sourceKey = sourceKey
            existing.videoId = videoId
            existing.cover = cover
            existing.episode = episode
			existing.groupIndex = groupIndex
            existing.episodeIndex = episodeIndex
            existing.progress = progress
            existing.duration = duration
            existing.updatedAt = .now
        } else {
            context.insert(WatchHistoryItem(
				serverURL: serverURL, userID: userID, sourceKey: sourceKey, videoId: videoId,
                title: title, cover: cover, episode: episode,
				groupIndex: groupIndex, episodeIndex: episodeIndex, progress: progress, duration: duration
            ))
        }
        try? context.save()
		trimExcess(in: context, serverURL: serverURL, userID: userID)
	}

    /// Retains the 100 most recently updated rows in one server/user cache scope.
    ///
    /// 在单个服务器与用户缓存范围内保留最近更新的 100 条记录.
	static func trimExcess(in context: ModelContext, serverURL: String, userID: Int64 = 0) {
		var descriptor = FetchDescriptor<WatchHistoryItem>(
			predicate: #Predicate { $0.serverURL == serverURL && $0.userID == userID },
            sortBy: [SortDescriptor(\.updatedAt, order: .reverse)]
        )
        descriptor.fetchOffset = 100
        if let excess = try? context.fetch(descriptor) {
            for item in excess { context.delete(item) }
        }
    }

    /// Returns recently updated rows for exactly one server and user.
    ///
    /// 返回严格属于一个服务器与用户的最近更新记录.
	static func recent(in context: ModelContext, serverURL: String, userID: Int64 = 0, limit: Int = 10) -> [WatchHistoryItem] {
		var descriptor = FetchDescriptor<WatchHistoryItem>(
			predicate: #Predicate { $0.serverURL == serverURL && $0.userID == userID },
            sortBy: [SortDescriptor(\.updatedAt, order: .reverse)]
        )
        descriptor.fetchLimit = limit
        return (try? context.fetch(descriptor)) ?? []
    }

    /// Clears only one server/user cache scope.
    ///
    /// 只清空一个服务器与用户的缓存范围.
	static func clearAll(in context: ModelContext, serverURL: String, userID: Int64 = 0) {
		let descriptor = FetchDescriptor<WatchHistoryItem>(
			predicate: #Predicate { $0.serverURL == serverURL && $0.userID == userID }
        )
        if let items = try? context.fetch(descriptor) {
            for item in items { context.delete(item) }
		}
		try? context.save()
	}

    /// Deletes one title only inside the selected server/user cache scope.
    ///
    /// 只在指定服务器与用户缓存范围内删除一个标题.
	static func delete(in context: ModelContext, serverURL: String, userID: Int64 = 0, title: String) {
		let descriptor = FetchDescriptor<WatchHistoryItem>(
			predicate: #Predicate {
				$0.serverURL == serverURL && $0.userID == userID && $0.title == title
			}
		)
		if let items = try? context.fetch(descriptor) {
			for item in items { context.delete(item) }
		}
		try? context.save()
	}
}
