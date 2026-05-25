import SwiftData
@testable import KMTV

enum ModelContainerFactory {
    @MainActor
    static func makeInMemory() throws -> ModelContainer {
        let config = ModelConfiguration(isStoredInMemoryOnly: true)
        return try ModelContainer(
            for: Server.self,
            WatchHistoryItem.self,
            FavoriteItem.self,
            SearchHistoryItem.self,
            PlaybackSettings.self,
            configurations: config
        )
    }
}
