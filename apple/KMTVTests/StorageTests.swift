import XCTest
import SwiftData
@testable import KMTV

final class StorageTests: XCTestCase {
    @MainActor
    func testServerCRUD() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let context = container.mainContext

        let server = Server(url: "https://kmtv.example.com")
        context.insert(server)
        try context.save()

        let servers = try context.fetch(FetchDescriptor<Server>())
        XCTAssertEqual(servers.count, 1)
        XCTAssertEqual(servers[0].url, "https://kmtv.example.com")
    }

    @MainActor
    func testServerTrailingSlash() throws {
        let server = Server(url: "https://kmtv.example.com/")
        XCTAssertEqual(server.url, "https://kmtv.example.com")
    }

    @MainActor
    func testServerCurrent() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let context = container.mainContext

        XCTAssertNil(Server.current(in: context))

        let server = Server(url: "https://s1.com")
        context.insert(server)
        try context.save()

        XCTAssertEqual(Server.current(in: context)?.url, "https://s1.com")
    }

    @MainActor
    func testServerDeleteAll() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let context = container.mainContext

        context.insert(Server(url: "https://s1.com"))
        context.insert(Server(url: "https://s2.com"))
        try context.save()

        Server.deleteAll(in: context)
        let servers = try context.fetch(FetchDescriptor<Server>())
        XCTAssertEqual(servers.count, 0)
    }

    @MainActor
    func testWatchHistoryUpsert() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let context = container.mainContext
        let serverURL = "https://kmtv.example.com"

        WatchHistoryItem.upsert(in: context, serverURL: serverURL, sourceKey: "src1", videoId: "v1",
                                 title: "Movie A", cover: "", episode: "EP1", episodeIndex: 0,
                                 progress: 30, duration: 100)
        try context.save()

        var items = WatchHistoryItem.recent(in: context, serverURL: serverURL)
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items[0].progress, 30)

        // Upsert same title - should update not insert
        WatchHistoryItem.upsert(in: context, serverURL: serverURL, sourceKey: "src2", videoId: "v2",
                                 title: "Movie A", cover: "", episode: "EP2", episodeIndex: 1,
                                 progress: 60, duration: 100)
        try context.save()

        items = WatchHistoryItem.recent(in: context, serverURL: serverURL)
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items[0].progress, 60)
        XCTAssertEqual(items[0].sourceKey, "src2")
    }

    @MainActor
    func testWatchHistoryMaxItems() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let context = container.mainContext
        let serverURL = "https://kmtv.example.com"

        for i in 0..<105 {
            context.insert(WatchHistoryItem(
                serverURL: serverURL, sourceKey: "src", videoId: "v\(i)",
                title: "Video \(i)", cover: "", episode: "EP1",
                episodeIndex: 0, progress: 10, duration: 100
            ))
        }
        try context.save()

        WatchHistoryItem.trimExcess(in: context, serverURL: serverURL)
        try context.save()

        let descriptor = FetchDescriptor<WatchHistoryItem>(
            predicate: #Predicate { $0.serverURL == serverURL }
        )
        let items = try context.fetch(descriptor)
        XCTAssertEqual(items.count, 100)
    }

    @MainActor
    func testFavoriteToggle() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let context = container.mainContext
        let serverURL = "https://example.com"

        let added = FavoriteItem.toggle(in: context, serverURL: serverURL, sourceKey: "src1", videoId: "v1",
                                         title: "T", cover: "", type: "movie", year: "2024")
        XCTAssertTrue(added)
        XCTAssertTrue(FavoriteItem.exists(in: context, serverURL: serverURL, sourceKey: "src1", videoId: "v1"))

        let removed = FavoriteItem.toggle(in: context, serverURL: serverURL, sourceKey: "src1", videoId: "v1",
                                           title: "T", cover: "", type: "movie", year: "2024")
        XCTAssertFalse(removed)
        XCTAssertFalse(FavoriteItem.exists(in: context, serverURL: serverURL, sourceKey: "src1", videoId: "v1"))
    }

    @MainActor
    func testFavoriteScoping() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let context = container.mainContext

        _ = FavoriteItem.toggle(in: context, serverURL: "https://s1.com", sourceKey: "src1", videoId: "v1",
                                 title: "T", cover: "", type: "", year: "")
        _ = FavoriteItem.toggle(in: context, serverURL: "https://s2.com", sourceKey: "src1", videoId: "v1",
                                 title: "T", cover: "", type: "", year: "")
        try context.save()

        XCTAssertEqual(FavoriteItem.all(in: context, serverURL: "https://s1.com").count, 1)
        XCTAssertEqual(FavoriteItem.all(in: context, serverURL: "https://s2.com").count, 1)
    }

    @MainActor
    func testSearchHistoryDedup() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let context = container.mainContext
        let serverURL = "https://kmtv.example.com"

        SearchHistoryItem.add(in: context, serverURL: serverURL, query: "test")
        SearchHistoryItem.add(in: context, serverURL: serverURL, query: "other")
        SearchHistoryItem.add(in: context, serverURL: serverURL, query: "test") // should dedup
        try context.save()

        let items = SearchHistoryItem.recent(in: context, serverURL: serverURL)
        XCTAssertEqual(items.count, 2)
        XCTAssertEqual(items[0].query, "test") // most recent first
    }

    @MainActor
    func testSearchHistoryMaxItems() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let context = container.mainContext
        let serverURL = "https://kmtv.example.com"

        for i in 0..<25 {
            context.insert(SearchHistoryItem(serverURL: serverURL, query: "query\(i)"))
        }
        try context.save()

        SearchHistoryItem.trimExcess(in: context, serverURL: serverURL)
        try context.save()

        let descriptor = FetchDescriptor<SearchHistoryItem>(
            predicate: #Predicate { $0.serverURL == serverURL }
        )
        let items = try context.fetch(descriptor)
        XCTAssertEqual(items.count, 20)
    }
}
