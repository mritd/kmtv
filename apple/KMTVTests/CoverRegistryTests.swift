import XCTest
@testable import KMTV

@MainActor
final class CoverRegistryTests: XCTestCase {
    private static let suite = "CoverRegistryTests"
    private var registry: CoverRegistry!

    override func setUp() async throws {
        registry = try makeCoverRegistry(suite: Self.suite)
    }

    override func tearDown() async throws {
        registry = nil
        clearCoverRegistrySuite(Self.suite)
    }

    func testLooksUpByNormalizedTitle() {
        registry.remember([(title: "深渊无间", cover: "https://img.example.com/a.jpg")], baseURL: "http://a:8080")
        XCTAssertEqual(registry.cover(for: " 深渊无间 ")?.absoluteString, "https://img.example.com/a.jpg")
        XCTAssertNil(registry.cover(for: "兰香如故"))
    }

    func testKeepsServerRelativeCoversRelative() {
        let item = DoubanItem(id: "1", title: "早春晴朗", cover: "/api/v1/image?u=x", rate: "6.7", year: "2026")
        registry.remember([item], baseURL: "http://localhost:8081")
        XCTAssertEqual(registry.rawCover(for: "早春晴朗"), "/api/v1/image?u=x")
        XCTAssertEqual(registry.cover(for: "早春晴朗")?.absoluteString, "http://localhost:8081/api/v1/image?u=x")
        registry.remember([(title: "Other", cover: "https://img.example.com/o.jpg")], baseURL: "http://10.0.0.2:8080")
        XCTAssertEqual(registry.cover(for: "早春晴朗")?.absoluteString, "http://10.0.0.2:8080/api/v1/image?u=x")
    }

    func testSkipsMissingCoversAndKeepsTheLatest() {
        registry.remember([(title: "A", cover: "https://img.example.com/1.jpg")], baseURL: "")
        registry.remember([(title: "A", cover: "")], baseURL: "")
        XCTAssertEqual(registry.cover(for: "A")?.absoluteString, "https://img.example.com/1.jpg")
        registry.remember([(title: "A", cover: "https://img.example.com/2.jpg")], baseURL: "")
        XCTAssertEqual(registry.cover(for: "A")?.absoluteString, "https://img.example.com/2.jpg")
    }

    func testRemembersRefusedCoversButNotTransientOrServerFailures() throws {
        registry.remember([(title: "A", cover: "/api/v1/image?u=a")], baseURL: "http://localhost:8081")
        let refused = try XCTUnwrap(URL(string: "https://img.example.com/403.jpg"))
        let flaky = try XCTUnwrap(URL(string: "https://img.example.com/503.jpg"))
        let server = try XCTUnwrap(URL(string: "http://localhost:8081/api/v1/image?u=a"))

        registry.markBroken(refused, status: 403)
        registry.markBroken(flaky, status: 503)
        registry.markBroken(server, status: 403)

        XCTAssertTrue(registry.isBroken(refused))
        XCTAssertFalse(registry.isBroken(flaky), "server errors may pass")
        XCTAssertFalse(registry.isBroken(server), "the server's own covers are never marked")
    }

    func testBrokenCoversAreCapped() throws {
        for index in 0...CoverRegistry.brokenLimit {
            registry.markBroken(try XCTUnwrap(URL(string: "https://img.example.com/\(index).jpg")), status: 404)
        }
        XCTAssertFalse(registry.isBroken(try XCTUnwrap(URL(string: "https://img.example.com/0.jpg"))))
        XCTAssertTrue(registry.isBroken(
            try XCTUnwrap(URL(string: "https://img.example.com/\(CoverRegistry.brokenLimit).jpg"))))
    }

    func testEvictsTheLeastRecentlyRegisteredFirst() {
        registry.remember([(title: "kept", cover: "https://img.example.com/kept.jpg")], baseURL: "")
        let filler = (0..<CoverRegistry.limit).map { (title: "title \($0)", cover: "https://img.example.com/\($0).jpg") }
        registry.remember(Array(filler.prefix(CoverRegistry.limit / 2)), baseURL: "")
        // Seen again, so it moves behind the first half of the filler.
        registry.remember([(title: "kept", cover: "https://img.example.com/kept.jpg")], baseURL: "")
        registry.remember(Array(filler.suffix(CoverRegistry.limit / 2)), baseURL: "")

        XCTAssertNotNil(registry.cover(for: "kept"))
        XCTAssertNil(registry.cover(for: "title 0"), "the oldest entry is evicted")
        XCTAssertNotNil(registry.cover(for: "title \(CoverRegistry.limit - 1)"), "the newest entry stays")
        let kept = (0..<CoverRegistry.limit).filter { registry.cover(for: "title \($0)") != nil }
        XCTAssertEqual(kept.count + 1, CoverRegistry.limit)
    }

    func testPersistsUnderTheExistingKeysAndReloads() throws {
        XCTAssertEqual(CoverRegistry.limit, 600)
        registry.remember([(title: "深渊无间", cover: "/api/v1/image?u=a")], baseURL: "http://a:8080")
        let refused = try XCTUnwrap(URL(string: "https://img.example.com/403.jpg"))
        registry.markBroken(refused, status: 403)
        let defaults = try XCTUnwrap(UserDefaults(suiteName: Self.suite))
        XCTAssertEqual(defaults.dictionary(forKey: "covers.byTitle") as? [String: String],
                       [normalizeSyncKey("深渊无间"): "/api/v1/image?u=a"])
        XCTAssertEqual(defaults.stringArray(forKey: "covers.order"), [normalizeSyncKey("深渊无间")])
        XCTAssertEqual(defaults.string(forKey: "covers.baseURL"), "http://a:8080")
        XCTAssertEqual(defaults.stringArray(forKey: "covers.broken"), [refused.absoluteString])

        let reloaded = CoverRegistry(defaults: defaults)
        XCTAssertEqual(reloaded.cover(for: "深渊无间")?.absoluteString, "http://a:8080/api/v1/image?u=a")
        XCTAssertTrue(reloaded.isBroken(refused))
    }

    func testEvictedBrokenCoversLeaveTheStoredListToo() throws {
        for index in 0...CoverRegistry.brokenLimit {
            registry.markBroken(try XCTUnwrap(URL(string: "https://img.example.com/\(index).jpg")), status: 410)
        }
        let defaults = try XCTUnwrap(UserDefaults(suiteName: Self.suite))
        let stored = try XCTUnwrap(defaults.stringArray(forKey: "covers.broken"))
        XCTAssertEqual(stored.count, CoverRegistry.brokenLimit)
        XCTAssertEqual(stored.first, "https://img.example.com/1.jpg")
        XCTAssertFalse(CoverRegistry(defaults: defaults).isBroken(try XCTUnwrap(URL(string: "https://img.example.com/0.jpg"))))
    }
}
