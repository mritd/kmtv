import Foundation
import SwiftData

@Model
final class Server {
    var url: String
    var name: String = ""
    var isActive: Bool
    var addedAt: Date

    init(url: String, name: String = "", isActive: Bool = true, addedAt: Date = .now) {
        self.url = url.hasSuffix("/") ? String(url.dropLast()) : url
        self.name = name
        self.isActive = isActive
        self.addedAt = addedAt
    }

    static func current(in context: ModelContext) -> Server? {
        let descriptor = FetchDescriptor<Server>(sortBy: [SortDescriptor(\.addedAt, order: .reverse)])
        return try? context.fetch(descriptor).first
    }

    static func deleteAll(in context: ModelContext) {
        let all = (try? context.fetch(FetchDescriptor<Server>())) ?? []
        for s in all { context.delete(s) }
        try? context.save()
    }
}
