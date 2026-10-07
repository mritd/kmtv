import XCTest
@testable import KMTV

@MainActor
final class CoverRegistryTests: XCTestCase {
    private static let suite = "CoverRegistryTests"

    override func setUp() async throws {
        CoverRegistry.use(try XCTUnwrap(UserDefaults(suiteName: Self.suite)))
        CoverRegistry.reset()
    }

    override func tearDown() async throws {
        CoverRegistry.reset()
        UserDefaults().removePersistentDomain(forName: Self.suite)
        // Back to the host's test store, so later tests never reach the real registry.
        CoverRegistry.use(try XCTUnwrap(UserDefaults(suiteName: "KMTVTests.covers")))
    }

    func testLooksUpByNormalizedTitle() {
        CoverRegistry.remember([(title: "深渊无间", cover: "https://img.example.com/a.jpg")], baseURL: "http://a:8080")
        XCTAssertEqual(CoverRegistry.cover(for: " 深渊无间 ")?.absoluteString, "https://img.example.com/a.jpg")
        XCTAssertNil(CoverRegistry.cover(for: "兰香如故"))
    }

    func testKeepsServerRelativeCoversRelative() {
        let item = DoubanItem(id: "1", title: "早春晴朗", cover: "/api/v1/image?u=x", rate: "6.7", year: "2026")
        CoverRegistry.remember([item], baseURL: "http://localhost:8081")
        XCTAssertEqual(CoverRegistry.rawCover(for: "早春晴朗"), "/api/v1/image?u=x")
        XCTAssertEqual(CoverRegistry.cover(for: "早春晴朗")?.absoluteString, "http://localhost:8081/api/v1/image?u=x")
        CoverRegistry.remember([(title: "Other", cover: "https://img.example.com/o.jpg")], baseURL: "http://10.0.0.2:8080")
        XCTAssertEqual(CoverRegistry.cover(for: "早春晴朗")?.absoluteString, "http://10.0.0.2:8080/api/v1/image?u=x")
    }

    func testSkipsMissingCoversAndKeepsTheLatest() {
        CoverRegistry.remember([(title: "A", cover: "https://img.example.com/1.jpg")], baseURL: "")
        CoverRegistry.remember([(title: "A", cover: "")], baseURL: "")
        XCTAssertEqual(CoverRegistry.cover(for: "A")?.absoluteString, "https://img.example.com/1.jpg")
        CoverRegistry.remember([(title: "A", cover: "https://img.example.com/2.jpg")], baseURL: "")
        XCTAssertEqual(CoverRegistry.cover(for: "A")?.absoluteString, "https://img.example.com/2.jpg")
    }

    func testRemembersRefusedCoversButNotTransientOrServerFailures() throws {
        CoverRegistry.remember([(title: "A", cover: "/api/v1/image?u=a")], baseURL: "http://localhost:8081")
        let refused = try XCTUnwrap(URL(string: "https://img.example.com/403.jpg"))
        let flaky = try XCTUnwrap(URL(string: "https://img.example.com/503.jpg"))
        let server = try XCTUnwrap(URL(string: "http://localhost:8081/api/v1/image?u=a"))

        CoverRegistry.markBroken(refused, status: 403)
        CoverRegistry.markBroken(flaky, status: 503)
        CoverRegistry.markBroken(server, status: 403)

        XCTAssertTrue(CoverRegistry.isBroken(refused))
        XCTAssertFalse(CoverRegistry.isBroken(flaky), "server errors may pass")
        XCTAssertFalse(CoverRegistry.isBroken(server), "the server's own covers are never marked")
    }

    func testBrokenCoversAreCapped() throws {
        for index in 0...CoverRegistry.brokenLimit {
            CoverRegistry.markBroken(try XCTUnwrap(URL(string: "https://img.example.com/\(index).jpg")), status: 404)
        }
        XCTAssertFalse(CoverRegistry.isBroken(try XCTUnwrap(URL(string: "https://img.example.com/0.jpg"))))
        XCTAssertTrue(CoverRegistry.isBroken(
            try XCTUnwrap(URL(string: "https://img.example.com/\(CoverRegistry.brokenLimit).jpg"))))
    }

    func testEvictsTheLeastRecentlyRegisteredFirst() {
        CoverRegistry.remember([(title: "kept", cover: "https://img.example.com/kept.jpg")], baseURL: "")
        let filler = (0..<CoverRegistry.limit).map { (title: "title \($0)", cover: "https://img.example.com/\($0).jpg") }
        CoverRegistry.remember(Array(filler.prefix(CoverRegistry.limit / 2)), baseURL: "")
        // Seen again, so it moves behind the first half of the filler.
        CoverRegistry.remember([(title: "kept", cover: "https://img.example.com/kept.jpg")], baseURL: "")
        CoverRegistry.remember(Array(filler.suffix(CoverRegistry.limit / 2)), baseURL: "")

        XCTAssertNotNil(CoverRegistry.cover(for: "kept"))
        XCTAssertNil(CoverRegistry.cover(for: "title 0"), "the oldest entry is evicted")
        XCTAssertNotNil(CoverRegistry.cover(for: "title \(CoverRegistry.limit - 1)"), "the newest entry stays")
        let kept = (0..<CoverRegistry.limit).filter { CoverRegistry.cover(for: "title \($0)") != nil }
        XCTAssertEqual(kept.count + 1, CoverRegistry.limit)
    }
}
