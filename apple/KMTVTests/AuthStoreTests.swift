import XCTest
@testable import KMTV

final class AuthStoreTests: XCTestCase {
    private let serverURL = "https://kmtv.example.com"

    override func tearDown() {
        AuthStore(serverURL: serverURL).clear()
        AuthStore(serverURL: "https://kmtv.example.com/").clear()
        AuthStore(serverURL: "https://other.example.com").clear()
        super.tearDown()
    }

    func testSaveLoadAndClearToken() throws {
        let store = AuthStore(serverURL: serverURL)
        let expiresAt = Date(timeIntervalSince1970: 1_800_000_000)

        try store.save(accessToken: "Base58AccessToken", expiresAt: expiresAt)

        let credential = try XCTUnwrap(store.load())
        XCTAssertEqual(credential.accessToken, "Base58AccessToken")
        XCTAssertEqual(credential.expiresAt, expiresAt)

        store.clear()
        XCTAssertNil(store.load())
    }

    func testExpiredTokenLoadsAsNilAndIsCleared() throws {
        let store = AuthStore(serverURL: serverURL)

        try store.save(accessToken: "ExpiredToken", expiresAt: Date(timeIntervalSince1970: 1))

        XCTAssertNil(store.load(now: Date(timeIntervalSince1970: 2)))
        XCTAssertNil(store.load(now: Date(timeIntervalSince1970: 2)))
    }

    func testServerURLNormalizationScopesTokens() throws {
        let first = AuthStore(serverURL: "https://kmtv.example.com/")
        let second = AuthStore(serverURL: "https://other.example.com")

        try first.save(accessToken: "FirstToken", expiresAt: Date(timeIntervalSince1970: 1_800_000_000))
        try second.save(accessToken: "SecondToken", expiresAt: Date(timeIntervalSince1970: 1_800_000_000))

        XCTAssertEqual(first.load()?.accessToken, "FirstToken")
        XCTAssertEqual(second.load()?.accessToken, "SecondToken")

        first.clear()
        second.clear()
    }
}
