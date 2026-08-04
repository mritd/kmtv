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
        api.watchHistory = WatchHistoryResponse(items: [
            WatchHistoryResponseItem(
                id: 1,
                sourceKey: "s1",
                videoId: "v1",
                title: "History",
                cover: "",
                episode: "EP1",
                groupIndex: 0,
                episodeIndex: 0,
                progressSec: 10,
                durationSec: 100,
				completed: false,
				eventTimeMS: 1,
				createdAt: nil,
                updatedAt: nil
            )
        ])
        // The history seeded above is served by the API fake, and loadRemoteWatchHistory()
        // only asks the API when a user is signed in — userID 0 falls back to the local
        // store, which nothing populates here.
        //
        // 上面预置的历史记录由 API fake 提供, 而 loadRemoteWatchHistory()
        // 只在用户已登录时才请求 API — userID 为 0 时会回退读取本地库,
        // 而这里没有任何代码向本地库写入.
        let vm = HomeViewModel(apiClient: api, modelContext: container.mainContext,
                               serverURL: "https://kmtv.example", userID: 1)

        await vm.load()

        XCTAssertEqual(vm.sections.count, 1)
        XCTAssertEqual(vm.heroItems.count, 2)
        XCTAssertEqual(vm.watchHistory.count, 1)
        XCTAssertEqual(vm.watchHistory.first?.title, "History")
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
