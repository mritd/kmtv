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
        let vm = SearchViewModel(apiClient: api, syncStore: makeSyncStore(container), syncEngine: nil)

        await vm.submitSearch(query: "Movie")

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
        let vm = SearchViewModel(apiClient: api, syncStore: makeSyncStore(container), syncEngine: nil)

        await vm.search(query: "Fallback")

        XCTAssertTrue(api.syncCalled)
        XCTAssertEqual(vm.results.first?.title, "Fallback")
    }

    func testSubmittedSearchesAreSyncedNewestFirstAndClearable() async throws {
        let container = try ModelContainerFactory.makeInMemory()
        let store = makeTickingSyncStore(container)
        store.upsert(.search(SearchPayload(query: "older")))
        let vm = SearchViewModel(apiClient: SearchAPIFake(), syncStore: store, syncEngine: nil)

        await vm.submitSearch(query: "  newer ")

        XCTAssertEqual(vm.searchHistory.map(\.query), ["newer", "older"])
        vm.clearHistory()
        XCTAssertTrue(vm.searchHistory.isEmpty)
        XCTAssertNotNil(store.state.pendingClears[.search])
    }

    func testSearchOpenedFromNavigationIsNotRecorded() async throws {
        let store = makeSyncStore(try ModelContainerFactory.makeInMemory())
        let vm = SearchViewModel(apiClient: SearchAPIFake(), syncStore: store, syncEngine: nil)

        await vm.search(query: "From A Poster")

        XCTAssertEqual(vm.query, "From A Poster")
        XCTAssertTrue(vm.hasSearched)
        XCTAssertTrue(vm.searchHistory.isEmpty)
    }

    func testHistoryChipMovesItsQueryToTheTop() async throws {
        let store = makeSyncStore(try ModelContainerFactory.makeInMemory())
        store.upsert(.search(SearchPayload(query: "b")))
        store.upsert(.search(SearchPayload(query: "a")))
        let vm = SearchViewModel(apiClient: SearchAPIFake(), syncStore: store, syncEngine: nil)
        XCTAssertEqual(vm.searchHistory.map(\.query), ["a", "b"])

        await vm.submitSearch(query: vm.searchHistory[1].query)

        XCTAssertEqual(vm.searchHistory.map(\.query), ["b", "a"])
    }
}
