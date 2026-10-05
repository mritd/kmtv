import XCTest
@testable import KMTV

/// Covers how finished download responses are classified.
///
/// 覆盖已完成下载响应的分类.
final class DownloadEntryValidatorTests: XCTestCase {
    private let proxy = URL(string: "https://kmtv.example/api/v1/proxy/segment?url=x&mt=t")!
    private let direct = URL(string: "https://cdn.example/a.ts")!
    private let ts = Data([0x47, 0x40, 0x00, 0x10])

    private func classify(_ url: URL, _ status: Int, type: String? = nil, head: Data? = nil, size: Int64 = 4,
                          kind: DownloadManifest.Kind = .segment) -> EntryOutcome {
        DownloadEntryValidator.classify(url: url, status: status, contentType: type, head: head ?? ts, size: size, kind: kind)
    }

    func testAcceptsMediaAndKeys() {
        XCTAssertEqual(classify(direct, 200, type: "video/mp2t"), .accept)
        XCTAssertEqual(classify(direct, 206), .accept)
        XCTAssertEqual(classify(direct, 200, head: Data(repeating: 1, count: 16), size: 16, kind: .key), .accept)
    }

    func testMediaTokenExpiryOnlyFromProxyWithServerMessage() {
        let body = Data(#"{"code":1002,"error":"invalid or expired media token"}"#.utf8)
        XCTAssertEqual(classify(proxy, 401, type: "application/json", head: body, size: Int64(body.count)), .tokenExpired)
        XCTAssertEqual(classify(direct, 401, type: "application/json", head: body, size: Int64(body.count)),
                       .reject(.sourceStatus(401)))
        XCTAssertEqual(classify(proxy, 401, head: Data("denied".utf8), size: 6), .reject(.sourceStatus(401)))
    }

    func testPermanentAndRetryableStatuses() {
        XCTAssertEqual(classify(proxy, 403), .reject(.sourceStatus(403)))
        XCTAssertEqual(classify(direct, 404), .reject(.sourceStatus(404)))
        XCTAssertEqual(classify(direct, 410), .reject(.sourceStatus(410)))
        XCTAssertEqual(classify(direct, 429), .retry(.sourceStatus(429)))
        XCTAssertEqual(classify(direct, 502), .retry(.sourceStatus(502)))
        XCTAssertEqual(classify(direct, 408), .retry(.sourceStatus(408)))
    }

    func testRejectsHTMLEmptyAndBadKeys() {
        XCTAssertEqual(classify(direct, 200, type: "text/html; charset=utf-8"), .retry(.invalidContent))
        XCTAssertEqual(classify(direct, 200, head: Data("  <!DOCTYPE html>".utf8), size: 17), .retry(.invalidContent))
        XCTAssertEqual(classify(direct, 200, head: Data(), size: 0), .retry(.invalidContent))
        XCTAssertEqual(classify(direct, 200, head: Data(repeating: 1, count: 15), size: 15, kind: .key), .retry(.invalidContent))
    }

    func testRetriesJSONBodiesForSegmentsAndMapsButNotKeys() {
        let json = Data(#"{"code":500,"msg":"upstream error"}"#.utf8)
        let size = Int64(json.count)
        XCTAssertEqual(classify(direct, 200, type: "video/mp2t", head: json, size: size), .retry(.invalidContent))
        XCTAssertEqual(classify(direct, 200, head: Data(" \n{}".utf8), size: 4, kind: .map), .retry(.invalidContent))
        // Key bytes are random, so a key that happens to start with `{` is still accepted.
        //
        // 密钥字节是随机的, 恰好以 `{` 开头的密钥仍被接受.
        let key = Data([UInt8(ascii: "{")] + Array(repeating: 1, count: 15))
        XCTAssertEqual(classify(direct, 200, head: key, size: 16, kind: .key), .accept)
    }

    func testTransportErrors() {
        XCTAssertNil(DownloadEntryValidator.classify(transportError: URLError(.cancelled)))
        XCTAssertEqual(DownloadEntryValidator.classify(transportError: URLError(.timedOut)), .retry(.network))
        XCTAssertEqual(DownloadEntryValidator.classify(transportError: URLError(.notConnectedToInternet)), .retry(.network))
        XCTAssertTrue(DownloadEntryValidator.isProxyURL(proxy))
        XCTAssertFalse(DownloadEntryValidator.isProxyURL(direct))
    }
}
