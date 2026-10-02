import XCTest
@testable import KMTV

/// Covers favorites listing and removal through the sync store.
///
/// 覆盖通过同步存储列出和删除收藏.
@MainActor
final class FavoritesViewModelTests: XCTestCase {
    func testListsNewestFirstAndRemovesThroughStore() throws {
        let store = makeTickingSyncStore(try ModelContainerFactory.makeInMemory())
        store.upsert(.favorite(FavoritePayload(title: "A")))
        store.upsert(.favorite(FavoritePayload(title: "B")))
        let vm = FavoritesViewModel(syncStore: store, syncEngine: nil)
        XCTAssertEqual(vm.favorites.map(\.title), ["B", "A"])
        vm.remove(vm.favorites[0])
        XCTAssertEqual(vm.favorites.map(\.title), ["A"])
        XCTAssertEqual(store.state.records["favorite|b"]?.deleted, true)
    }
}
