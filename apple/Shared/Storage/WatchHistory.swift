import Foundation
import SwiftData

@Model
final class WatchHistoryItem {
    var serverURL: String
    var sourceKey: String
    var videoId: String
    var title: String
    var cover: String
    var episode: String
    var episodeIndex: Int
    var progress: Double
    var duration: Double
    var updatedAt: Date

    init(serverURL: String, sourceKey: String, videoId: String, title: String,
         cover: String, episode: String, episodeIndex: Int,
         progress: Double, duration: Double, updatedAt: Date = .now) {
        self.serverURL = serverURL
        self.sourceKey = sourceKey
        self.videoId = videoId
        self.title = title
        self.cover = cover
        self.episode = episode
        self.episodeIndex = episodeIndex
        self.progress = progress
        self.duration = duration
        self.updatedAt = updatedAt
    }

    static func upsert(in context: ModelContext, serverURL: String, sourceKey: String, videoId: String,
                        title: String, cover: String, episode: String, episodeIndex: Int,
                        progress: Double, duration: Double) {
        let descriptor = FetchDescriptor<WatchHistoryItem>(
            predicate: #Predicate { $0.title == title }
        )
        if let existing = try? context.fetch(descriptor).first {
            existing.sourceKey = sourceKey
            existing.videoId = videoId
            existing.cover = cover
            existing.episode = episode
            existing.episodeIndex = episodeIndex
            existing.progress = progress
            existing.duration = duration
            existing.updatedAt = .now
        } else {
            context.insert(WatchHistoryItem(
                serverURL: serverURL, sourceKey: sourceKey, videoId: videoId,
                title: title, cover: cover, episode: episode,
                episodeIndex: episodeIndex, progress: progress, duration: duration
            ))
        }
        try? context.save()
        trimExcess(in: context, serverURL: serverURL)
    }

    static func trimExcess(in context: ModelContext, serverURL: String) {
        var descriptor = FetchDescriptor<WatchHistoryItem>(
            predicate: #Predicate { $0.serverURL == serverURL },
            sortBy: [SortDescriptor(\.updatedAt, order: .reverse)]
        )
        // Keep a bounded playback history per server.
        // 为每个服务器保留有上限的播放历史.
        descriptor.fetchOffset = 100
        if let excess = try? context.fetch(descriptor) {
            for item in excess { context.delete(item) }
        }
    }

    static func recent(in context: ModelContext, serverURL: String, limit: Int = 10) -> [WatchHistoryItem] {
        var descriptor = FetchDescriptor<WatchHistoryItem>(
            predicate: #Predicate { $0.serverURL == serverURL },
            sortBy: [SortDescriptor(\.updatedAt, order: .reverse)]
        )
        descriptor.fetchLimit = limit
        return (try? context.fetch(descriptor)) ?? []
    }

    static func clearAll(in context: ModelContext, serverURL: String) {
        let descriptor = FetchDescriptor<WatchHistoryItem>(
            predicate: #Predicate { $0.serverURL == serverURL }
        )
        if let items = try? context.fetch(descriptor) {
            for item in items { context.delete(item) }
        }
    }
}
