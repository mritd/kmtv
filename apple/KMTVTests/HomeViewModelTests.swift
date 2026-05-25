import XCTest
@testable import KMTV

@MainActor
final class HomeViewModelTests: XCTestCase {
    func testLoadSetsSectionsHeroItemsAndWatchHistory() async throws {
        let container = try ModelContainerFactory.makeInMemory()
        let api = DoubanAPIFake()
        api.home = DoubanHomeResponse(sections: [
            HomeSection(name: "Hot", tag: "hot", type: "movie", items: [
                DoubanItem(id: "1", title: "A", cover: "", rate: "8.0", year: "2026"),
                DoubanItem(id: "2", title: "B", cover: "", rate: "8.1", year: "2026")
            ])
        ])
        WatchHistoryItem.upsert(
            in: container.mainContext,
            serverURL: "https://kmtv.example",
            sourceKey: "s1",
            videoId: "v1",
            title: "History",
            cover: "",
            episode: "EP1",
            episodeIndex: 0,
            progress: 10,
            duration: 100
        )
        let vm = HomeViewModel(apiClient: api, modelContext: container.mainContext, serverURL: "https://kmtv.example")

        await vm.load()

        XCTAssertEqual(vm.sections.count, 1)
        XCTAssertEqual(vm.heroItems.count, 2)
        XCTAssertEqual(vm.watchHistory.count, 1)
        XCTAssertFalse(vm.isLoading)
    }

    func testLoadFailureDoesNotShowGlobalToast() async throws {
        let container = try ModelContainerFactory.makeInMemory()
        let api = DoubanAPIFake()
        api.homeError = APIError.serverError(500, 1300, "douban unavailable")
        ToastManager.shared.currentMessage = nil
        ToastManager.shared.isVisible = false
        let vm = HomeViewModel(apiClient: api, modelContext: container.mainContext, serverURL: "https://kmtv.example")

        await vm.load()

        XCTAssertEqual(vm.error, APIError.serverError(500, 1300, "douban unavailable").localizedMessage)
        XCTAssertNil(ToastManager.shared.currentMessage)
        XCTAssertFalse(ToastManager.shared.isVisible)
        XCTAssertFalse(vm.isLoading)
    }
}
