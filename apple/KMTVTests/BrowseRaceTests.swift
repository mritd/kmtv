import XCTest
@testable import KMTV

/// Search fake whose requests wait for an explicit release, so tests control the finishing order.
///
/// 搜索 fake, 请求会等待显式放行, 让测试能控制完成顺序.
private final class GatedSearchFake: SearchAPIProtocol, @unchecked Sendable {
    private let lock = NSLock()
    private var waiting: [String: CheckedContinuation<Void, Never>] = [:]
    private var released: Set<String> = []
    private(set) var started: [String] = []

    func release(_ query: String) {
        lock.lock()
        if let continuation = waiting.removeValue(forKey: query) {
            lock.unlock()
            continuation.resume()
        } else {
            released.insert(query)
            lock.unlock()
        }
    }

    func startedCount() -> Int {
        lock.lock(); defer { lock.unlock() }
        return started.count
    }

    func search(query: String, page: Int) async throws -> SearchResponse {
        SearchResponse(results: [])
    }

    func searchStream(
        query: String,
        page: Int,
        onProgress: @escaping @Sendable (APIClient.SearchProgress) async -> Void
    ) async throws -> SearchResponse {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            lock.lock()
            started.append(query)
            if released.remove(query) != nil {
                lock.unlock()
                continuation.resume()
            } else {
                waiting[query] = continuation
                lock.unlock()
            }
        }
        await onProgress(APIClient.SearchProgress(phase: "searching", completed: 1, total: 2))
        return SearchResponse(results: [
            SearchResult(title: "Result of \(query)", type: "movie", year: "2026", cover: "", desc: "", sources: [])
        ])
    }
}

/// Douban fake whose category list fails until told otherwise.
///
/// 分类列表先失败, 之后才成功的 Douban fake.
private final class FlakyCategoriesFake: DoubanAPIProtocol, @unchecked Sendable {
    var failCategories = true
    let groups = DoubanCategoriesResponse(categories: [
        CategoryGroup(key: "movie", name: "Movie", doubanKind: "movie", format: "",
                      subcategories: [SubCategory(name: "Hot", tag: "hot", kind: nil, format: nil)],
                      regions: [Region(name: "All", value: "")])
    ])

    func doubanHome() async throws -> DoubanHomeResponse { DoubanHomeResponse(sections: []) }
    func doubanCategories() async throws -> DoubanCategoriesResponse {
        if failCategories { throw APIError.serverError(500, 1300, "categories unavailable") }
        return groups
    }
    func doubanRecommend(kind: String, tag: String, format: String, region: String, start: Int, count: Int) async throws -> DoubanListResponse {
        DoubanListResponse(items: [DoubanItem(id: "1", title: "Movie", cover: "", rate: "", year: "")])
    }
}

@MainActor
final class BrowseRaceTests: XCTestCase {
    private func waitUntilStarted(_ api: GatedSearchFake, _ count: Int) async {
        while api.startedCount() < count { await Task.yield() }
    }

    func testOlderSearchFinishingLastDoesNotOverwriteNewerResults() async {
        let api = GatedSearchFake()
        let vm = SearchViewModel(apiClient: api, syncStore: nil, syncEngine: nil)

        let first = Task { await vm.search(query: "old") }
        await waitUntilStarted(api, 1)
        let second = Task { await vm.search(query: "new") }
        await waitUntilStarted(api, 2)

        api.release("new")
        await second.value
        XCTAssertEqual(vm.results.first?.title, "Result of new")
        XCTAssertFalse(vm.isSearching)

        api.release("old")
        await first.value
        XCTAssertEqual(vm.results.map(\.title), ["Result of new"])
        XCTAssertFalse(vm.isSearching)
    }

    func testIsSearchingStaysTrueWhileTheNewerSearchRuns() async {
        let api = GatedSearchFake()
        let vm = SearchViewModel(apiClient: api, syncStore: nil, syncEngine: nil)

        let first = Task { await vm.search(query: "old") }
        await waitUntilStarted(api, 1)
        let second = Task { await vm.search(query: "new") }
        await waitUntilStarted(api, 2)

        api.release("old")
        await first.value
        XCTAssertTrue(vm.isSearching, "the older search finishing must not end the newer one")
        XCTAssertTrue(vm.results.isEmpty)
        XCTAssertFalse(vm.hasSearched)

        api.release("new")
        await second.value
        XCTAssertFalse(vm.isSearching)
        XCTAssertEqual(vm.results.first?.title, "Result of new")
    }

    func testASearchOutlivesItsCancelledCaller() async {
        let api = GatedSearchFake()
        let vm = SearchViewModel(apiClient: api, syncStore: nil, syncEngine: nil)

        // The view's task is cancelled when the user leaves the page mid-search.
        //
        // 用户在搜索中途离开页面时, 视图的 task 会被取消.
        let caller = Task { await vm.search(query: "card") }
        await waitUntilStarted(api, 1)
        caller.cancel()
        api.release("card")
        await caller.value

        XCTAssertEqual(vm.results.map(\.title), ["Result of card"])
        XCTAssertTrue(vm.hasSearched)
        XCTAssertFalse(vm.isSearching)
    }

    func testSubmitClearsSearchContextAndNavigationSearchSetsIt() async {
        let vm = SearchViewModel(apiClient: SearchAPIFake(), syncStore: nil, syncEngine: nil)

        await vm.search(SearchQuery(query: "Movie", coverHint: "cover.jpg"))
        XCTAssertEqual(vm.coverHint, "cover.jpg")

        await vm.submitSearch(query: "Other")
        XCTAssertEqual(vm.coverHint, "")
        XCTAssertNil(vm.resumeIntent)
    }

    func testCategoriesRecoverAfterFailedFirstLoad() async {
        let api = FlakyCategoriesFake()
        let vm = CategoriesViewModel(apiClient: api, covers: nil)

        await vm.loadCategories()
        XCTAssertTrue(vm.categoryGroups.isEmpty)
        XCTAssertFalse(vm.isLoading)

        api.failCategories = false
        await vm.refresh()

        XCTAssertEqual(vm.selectedGroup?.key, "movie")
        XCTAssertEqual(vm.items.first?.title, "Movie")
        XCTAssertFalse(vm.isLoading)
    }

    func testHeroIndexClampsWhenARefreshShrinksHeroItems() async {
        let api = DoubanAPIFake()
        let items = (1...4).map { DoubanItem(id: "\($0)", title: "T\($0)", cover: "", rate: "", year: "", desc: "d") }
        api.home = DoubanHomeResponse(sections: [HomeSection(name: "Hot", tag: "hot", type: "movie", items: items)])
        let vm = HomeViewModel(apiClient: api, syncStore: nil, syncEngine: nil, covers: nil)
        await vm.load()
        vm.heroIndex = 3
        XCTAssertEqual(vm.heroIndex, 3)

        api.home = DoubanHomeResponse(sections: [HomeSection(name: "Hot", tag: "hot", type: "movie", items: Array(items.prefix(2)))])
        await vm.load()

        XCTAssertEqual(vm.heroItems.count, 2)
        XCTAssertEqual(vm.heroIndex, 1)
    }
}
