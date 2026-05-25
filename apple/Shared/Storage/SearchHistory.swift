import Foundation
import SwiftData

@Model
final class SearchHistoryItem {
    var serverURL: String
    var query: String
    var searchedAt: Date

    init(serverURL: String, query: String, searchedAt: Date = .now) {
        self.serverURL = serverURL
        self.query = query
        self.searchedAt = searchedAt
    }

    static func add(in context: ModelContext, serverURL: String, query: String) {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }

        let descriptor = FetchDescriptor<SearchHistoryItem>(
            predicate: #Predicate { $0.serverURL == serverURL && $0.query == trimmed }
        )
        if let existing = try? context.fetch(descriptor).first {
            context.delete(existing)
        }

        context.insert(SearchHistoryItem(serverURL: serverURL, query: trimmed))
        try? context.save()
        trimExcess(in: context, serverURL: serverURL)
    }

    static func trimExcess(in context: ModelContext, serverURL: String) {
        var descriptor = FetchDescriptor<SearchHistoryItem>(
            predicate: #Predicate { $0.serverURL == serverURL },
            sortBy: [SortDescriptor(\.searchedAt, order: .reverse)]
        )
        descriptor.fetchOffset = 20
        if let excess = try? context.fetch(descriptor) {
            for item in excess { context.delete(item) }
        }
    }

    static func recent(in context: ModelContext, serverURL: String) -> [SearchHistoryItem] {
        let descriptor = FetchDescriptor<SearchHistoryItem>(
            predicate: #Predicate { $0.serverURL == serverURL },
            sortBy: [SortDescriptor(\.searchedAt, order: .reverse)]
        )
        return (try? context.fetch(descriptor)) ?? []
    }

    static func clearAll(in context: ModelContext, serverURL: String) {
        let descriptor = FetchDescriptor<SearchHistoryItem>(
            predicate: #Predicate { $0.serverURL == serverURL }
        )
        if let items = try? context.fetch(descriptor) {
            for item in items { context.delete(item) }
        }
    }
}
