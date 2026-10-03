import SwiftData
@testable import KMTV

enum ModelContainerFactory {
    @MainActor
    static func makeInMemory() throws -> ModelContainer {
        try AppModelContainer.makeInMemory()
    }
}
