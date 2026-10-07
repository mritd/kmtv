import XCTest
@testable import KMTV

@MainActor
final class HomeViewModelTests: XCTestCase {
    func testLoadSetsSectionsAndListsUnfinishedWatchRecords() async throws {
        let container = try ModelContainerFactory.makeInMemory()
        let store = makeTickingSyncStore(container)
        for index in 1...11 { store.upsert(.watch(WatchPayload(title: "History \(index)", durationSec: 100))) }
        store.upsert(.watch(WatchPayload(title: "Finished", completed: true)))
        let api = DoubanAPIFake()
        api.home = DoubanHomeResponse(sections: [
            HomeSection(name: "Hot", tag: "hot", type: "movie", items: [
                DoubanItem(id: "1", title: "A", cover: "", rate: "8.0", year: "2026"),
                DoubanItem(id: "2", title: "B", cover: "", rate: "8.1", year: "2026"),
            ])
        ])
        let vm = HomeViewModel(apiClient: api, syncStore: store, syncEngine: nil)

        await vm.load()

        XCTAssertEqual(vm.sections.count, 1)
        XCTAssertEqual(vm.heroItems.count, 2)
        XCTAssertEqual(vm.watchHistory.count, 10)
        XCTAssertEqual(vm.watchHistory.first?.title, "History 11")
        XCTAssertFalse(vm.watchHistory.contains { $0.completed })
        vm.clearWatchHistory()
        XCTAssertTrue(vm.watchHistory.isEmpty)
        XCTAssertNotNil(store.state.pendingClears[.watch])
    }

    func testHeroCandidatesPreferDescribedItemsThenFillFromFirstSection() {
        let sections = [
            HomeSection(name: "Hot", tag: "hot", type: "movie", items: [
                DoubanItem(id: "1", title: "A", cover: "", rate: "", year: ""),
                DoubanItem(id: "2", title: "B", cover: "", rate: "", year: "", desc: "  "),
                DoubanItem(id: "3", title: "C", cover: "", rate: "", year: ""),
            ]),
            HomeSection(name: "TV", tag: "tv", type: "tv", items: [
                DoubanItem(id: "4", title: "D", cover: "", rate: "", year: "", desc: "Synopsis D"),
                DoubanItem(id: "1", title: "A", cover: "", rate: "", year: "", desc: "Synopsis A"),
            ]),
        ]

        let ids = HomeViewModel.heroCandidates(sections, limit: 4).map(\.id)

        // Described items first in section order, then the first section fills the rest without repeats.
        XCTAssertEqual(ids, ["4", "1", "2", "3"])
    }

    func testLoadFailureDoesNotShowGlobalToast() async throws {
        let api = DoubanAPIFake()
        api.homeError = APIError.serverError(500, 1300, "douban unavailable")
        ToastManager.shared.currentMessage = nil
        ToastManager.shared.isVisible = false
        let vm = HomeViewModel(apiClient: api, syncStore: nil, syncEngine: nil)

        await vm.load()

        XCTAssertEqual(vm.error, APIError.serverError(500, 1300, "douban unavailable").localizedMessage)
        XCTAssertNil(ToastManager.shared.currentMessage)
        XCTAssertFalse(ToastManager.shared.isVisible)
        XCTAssertFalse(vm.isLoading)
    }
}
