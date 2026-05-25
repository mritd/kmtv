import XCTest
@testable import KMTV

@MainActor
final class CategoriesViewModelTests: XCTestCase {
    func testLoadCategoriesSelectsFirstGroupAndItems() async {
        let api = DoubanAPIFake()
        api.categories = DoubanCategoriesResponse(categories: [
            CategoryGroup(
                key: "movie",
                name: "Movie",
                doubanKind: "movie",
                format: "",
                subcategories: [SubCategory(name: "Hot", tag: "hot", kind: nil, format: nil)],
                regions: [Region(name: "All", value: "")]
            )
        ])
        api.recommend = DoubanListResponse(items: [
            DoubanItem(id: "1", title: "Movie", cover: "", rate: "8.0", year: "2026")
        ])
        let vm = CategoriesViewModel(apiClient: api)

        await vm.loadCategories()

        XCTAssertEqual(vm.selectedGroup?.key, "movie")
        XCTAssertEqual(vm.selectedSubCategory?.name, "Hot")
        XCTAssertEqual(vm.items.first?.title, "Movie")
        XCTAssertFalse(vm.isLoading)
    }

    func testSelectGroupRefetchesWithNewDefaults() async throws {
        let api = DoubanAPIFake()
        api.categories = DoubanCategoriesResponse(categories: [
            CategoryGroup(
                key: "movie",
                name: "Movie",
                doubanKind: "movie",
                format: "",
                subcategories: [SubCategory(name: "Hot", tag: "hot", kind: nil, format: nil)],
                regions: [Region(name: "All", value: "")]
            ),
            CategoryGroup(
                key: "tv",
                name: "TV",
                doubanKind: "tv",
                format: "tv",
                subcategories: [SubCategory(name: "Drama", tag: "drama", kind: "tv", format: "tv")],
                regions: [Region(name: "US", value: "us")]
            )
        ])
        api.recommendResponses = [
            DoubanListResponse(items: [DoubanItem(id: "1", title: "Movie", cover: "", rate: "8.0", year: "2026")]),
            DoubanListResponse(items: [DoubanItem(id: "2", title: "TV", cover: "", rate: "8.5", year: "2026")])
        ]
        let vm = CategoriesViewModel(apiClient: api)

        await vm.loadCategories()
        vm.selectGroup(at: 1)
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(vm.selectedGroup?.key, "tv")
        XCTAssertEqual(vm.selectedSubCategory?.name, "Drama")
        XCTAssertEqual(vm.selectedRegion?.name, "US")
        XCTAssertEqual(vm.items.first?.title, "TV")
        XCTAssertEqual(api.recommendRequests.last?.kind, "tv")
        XCTAssertEqual(api.recommendRequests.last?.tag, "drama")
        XCTAssertEqual(api.recommendRequests.last?.region, "us")
    }

    func testLoadMoreAppendsOnlyNewItems() async {
        let api = DoubanAPIFake()
        api.categories = DoubanCategoriesResponse(categories: [
            CategoryGroup(
                key: "movie",
                name: "Movie",
                doubanKind: "movie",
                format: "",
                subcategories: [SubCategory(name: "Hot", tag: "hot", kind: nil, format: nil)],
                regions: [Region(name: "All", value: "")]
            )
        ])
        api.recommendResponses = [
            DoubanListResponse(items: (0..<20).map {
                DoubanItem(id: "\($0)", title: "Movie \($0)", cover: "", rate: "8.0", year: "2026")
            }),
            DoubanListResponse(items: [
                DoubanItem(id: "0", title: "Duplicate", cover: "", rate: "8.0", year: "2026"),
                DoubanItem(id: "20", title: "Movie 20", cover: "", rate: "8.0", year: "2026")
            ])
        ]
        let vm = CategoriesViewModel(apiClient: api)

        await vm.loadCategories()
        await vm.loadMore()

        XCTAssertEqual(vm.items.count, 21)
        XCTAssertEqual(vm.items.last?.id, "20")
        XCTAssertEqual(api.recommendRequests.last?.start, 20)
        XCTAssertFalse(vm.hasMore)
    }
}
