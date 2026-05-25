import Foundation
import SwiftData

@Model
final class FavoriteItem {
    var serverURL: String
    var sourceKey: String
    var videoId: String
    var title: String
    var cover: String
    var type: String
    var year: String
    var addedAt: Date

    init(serverURL: String, sourceKey: String, videoId: String,
         title: String, cover: String, type: String, year: String, addedAt: Date = .now) {
        self.serverURL = serverURL
        self.sourceKey = sourceKey
        self.videoId = videoId
        self.title = title
        self.cover = cover
        self.type = type
        self.year = year
        self.addedAt = addedAt
    }

    static func exists(in context: ModelContext, serverURL: String, sourceKey: String, videoId: String) -> Bool {
        let descriptor = FetchDescriptor<FavoriteItem>(
            predicate: #Predicate { $0.serverURL == serverURL && $0.sourceKey == sourceKey && $0.videoId == videoId }
        )
        return ((try? context.fetchCount(descriptor)) ?? 0) > 0
    }

    static func toggle(in context: ModelContext, serverURL: String, sourceKey: String, videoId: String,
                        title: String, cover: String, type: String, year: String) -> Bool {
        let descriptor = FetchDescriptor<FavoriteItem>(
            predicate: #Predicate { $0.serverURL == serverURL && $0.sourceKey == sourceKey && $0.videoId == videoId }
        )
        if let existing = try? context.fetch(descriptor).first {
            context.delete(existing)
            return false
        } else {
            context.insert(FavoriteItem(serverURL: serverURL, sourceKey: sourceKey, videoId: videoId,
                                         title: title, cover: cover, type: type, year: year))
            return true
        }
    }

    static func all(in context: ModelContext, serverURL: String) -> [FavoriteItem] {
        let descriptor = FetchDescriptor<FavoriteItem>(
            predicate: #Predicate { $0.serverURL == serverURL },
            sortBy: [SortDescriptor(\.addedAt, order: .reverse)]
        )
        return (try? context.fetch(descriptor)) ?? []
    }
}
