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
                          kind: DownloadManifest.Kind = .segment, encrypted: Bool = false) -> EntryOutcome {
        DownloadEntryValidator.classify(url: url, status: status, contentType: type, head: head ?? ts, size: size, kind: kind,
                                        encrypted: encrypted)
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

    func testEncryptedEntriesSkipFirstByteSniff() {
        // AES-128 ciphertext starts with a random byte, which can be `<` or `{`.
        //
        // AES-128 密文的首字节是随机的, 可能是 `<` 或 `{`.
        for first in [UInt8(ascii: "<"), UInt8(ascii: "{")] {
            let body = Data([first] + Array(repeating: 0x9C, count: 15))
            XCTAssertEqual(classify(direct, 200, head: body, size: 16, encrypted: true), .accept)
            XCTAssertEqual(classify(direct, 200, head: body, size: 16, kind: .map, encrypted: true), .accept)
            XCTAssertEqual(classify(direct, 200, head: body, size: 16), .retry(.invalidContent))
        }
        // A server-declared HTML type still rejects an encrypted entry.
        //
        // 服务端声明的 HTML 类型仍会拒绝加密条目.
        XCTAssertEqual(classify(direct, 200, type: "text/html", encrypted: true), .retry(.invalidContent))
    }

    func testTransportErrors() {
        XCTAssertNil(DownloadEntryValidator.classify(transportError: URLError(.cancelled)))
        XCTAssertEqual(DownloadEntryValidator.classify(transportError: URLError(.timedOut)), .retry(.network))
        XCTAssertEqual(DownloadEntryValidator.classify(transportError: URLError(.notConnectedToInternet)), .retry(.network))
    }

    func testOneProxyDefinitionForTokenExpiryAndIdentity() {
        // A direct upstream URL whose path contains `/proxy/` and a `url` parameter is neither a
        // token-expiry source nor an upstream identity.
        //
        // 路径含有 `/proxy/` 且带 `url` 参数的上游直连 URL, 既不会触发 token 过期, 也不是上游身份.
        let lookalike = URL(string: "https://cdn.example/cdn/proxy/x.ts?url=https%3A%2F%2Forigin%2Fx.ts")!
        let body = Data(#"{"code":1002,"error":"invalid or expired media token"}"#.utf8)
        XCTAssertTrue(KMTVProxyURL.isProxy(proxy))
        XCTAssertFalse(KMTVProxyURL.isProxy(direct))
        XCTAssertFalse(KMTVProxyURL.isProxy(lookalike))
        XCTAssertEqual(KMTVProxyURL.upstream(of: proxy), "x")
        XCTAssertNil(KMTVProxyURL.upstream(of: lookalike))
        XCTAssertEqual(classify(lookalike, 401, type: "application/json", head: body, size: Int64(body.count)),
                       .reject(.sourceStatus(401)))
        XCTAssertEqual(DownloadManifest.dedupeKey(lookalike), lookalike.absoluteString)
        XCTAssertEqual(DownloadManifest.dedupeKey(proxy), "x")
    }
}
