import Foundation
import SwiftData

@Observable
@MainActor
final class FavoritesViewModel {
    var favorites: [FavoriteItem] = []

    private let modelContext: ModelContext
    private let serverURL: String

    init(modelContext: ModelContext, serverURL: String) {
        self.modelContext = modelContext
        self.serverURL = serverURL
    }

    func load() {
        favorites = FavoriteItem.all(in: modelContext, serverURL: serverURL)
    }

    func remove(_ item: FavoriteItem) {
        modelContext.delete(item)
        try? modelContext.save()
        load()
    }
}
