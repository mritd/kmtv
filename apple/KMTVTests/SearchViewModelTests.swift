import XCTest
@testable import KMTV

@MainActor
final class SearchViewModelTests: XCTestCase {
    func testSearchStreamUpdatesProgressAndResults() async throws {
        let container = try ModelContainerFactory.makeInMemory()
        let api = SearchAPIFake()
        api.streamResult = SearchResponse(results: [
            SearchResult(title: "Movie", type: "movie", year: "2026", cover: "", desc: "", sources: [])
        ])
        let vm = SearchViewModel(apiClient: api, modelContext: container.mainContext, serverURL: "https://kmtv.example")

        await vm.search(query: "Movie")

        XCTAssertEqual(vm.results.count, 1)
        XCTAssertTrue(vm.hasSearched)
        XCTAssertFalse(vm.isSearching)
        XCTAssertEqual(vm.searchHistory.first?.query, "Movie")
    }

    func testSearchFallsBackToSyncWhenSSEFails() async throws {
        let container = try ModelContainerFactory.makeInMemory()
        let api = SearchAPIFake()
        api.streamError = APIError.serverError(0, 1300, "stream failed")
        api.syncResult = SearchResponse(results: [
            SearchResult(title: "Fallback", type: "movie", year: "2026", cover: "", desc: "", sources: [])
        ])
        let vm = SearchViewModel(apiClient: api, modelContext: container.mainContext, serverURL: "https://kmtv.example")

        await vm.search(query: "Fallback")

        XCTAssertTrue(api.syncCalled)
        XCTAssertEqual(vm.results.first?.title, "Fallback")
    }
}
