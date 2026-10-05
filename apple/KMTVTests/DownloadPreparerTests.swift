import XCTest
@testable import KMTV

/// Covers download preparation (playback URL, master selection, parsing) and the download API
/// client that never posts `.authExpired`.
///
/// 覆盖下载准备 (播放地址, master 选档, 解析), 以及从不发送 `.authExpired` 的下载 API 客户端.
final class DownloadPreparerTests: XCTestCase {
    private let media = "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\nseg0.ts\n#EXTINF:2,\nseg1.ts\n#EXT-X-ENDLIST\n"

    private func preparer(_ api: PlaybackAPIFake, _ pages: [String: (Int, String)]) -> DownloadPreparer {
        DownloadPreparer(api: api) { url in
            guard let page = pages[url.absoluteString] else { throw URLError(.cannotFindHost) }
            return (page.0, Data(page.1.utf8))
        }
    }

    func testPreparesMediaPlaylistThroughPlaybackURL() async throws {
        let api = PlaybackAPIFake()
        api.playbackResponse = PlaybackURLResponse(mode: "proxy", url: "https://kmtv.example/p/index.m3u8")
        let manifest = try await preparer(api, ["https://kmtv.example/p/index.m3u8": (200, media)])
            .prepare(episodeURL: "https://cdn.example/ep1.m3u8", sourceKey: "src", generation: 3)
        XCTAssertEqual(api.playbackRequests.first?.url, "https://cdn.example/ep1.m3u8")
        XCTAssertEqual(api.playbackRequests.first?.source, "src")
        XCTAssertEqual(manifest.generation, 3)
        XCTAssertEqual(manifest.entries.map(\.remoteURL.absoluteString),
                       ["https://kmtv.example/p/seg0.ts", "https://kmtv.example/p/seg1.ts"])
    }

    func testFollowsHighestVariant() async throws {
        let api = PlaybackAPIFake()
        api.playbackResponse = PlaybackURLResponse(mode: "direct", url: "https://cdn.example/master.m3u8")
        let master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=9\nhigh.m3u8\n"
        let manifest = try await preparer(api, [
            "https://cdn.example/master.m3u8": (200, master),
            "https://cdn.example/high.m3u8": (200, media),
        ]).prepare(episodeURL: "x", sourceKey: "s", generation: 1)
        XCTAssertEqual(manifest.entries.first?.remoteURL.absoluteString, "https://cdn.example/seg0.ts")
    }

    func testMapsErrors() async {
        let api = PlaybackAPIFake()
        api.playbackResponse = PlaybackURLResponse(mode: "direct", url: "https://cdn.example/a.m3u8")
        func error(_ pages: [String: (Int, String)], playbackError: Error? = nil) async -> DownloadPrepareError? {
            api.playbackError = playbackError
            do {
                _ = try await preparer(api, pages).prepare(episodeURL: "x", sourceKey: "s", generation: 1)
                return nil
            } catch { return error as? DownloadPrepareError }
        }
        let a = "https://cdn.example/a.m3u8"
        let missing = await error([:])
        XCTAssertEqual(missing, .network)
        let notFound = await error([a: (404, "")])
        XCTAssertEqual(notFound, .status(404))
        let live = await error([a: (200, "#EXTM3U\n#EXTINF:2,\na.ts\n")])
        XCTAssertEqual(live, .format(.live))
        let signedOut = await error([:], playbackError: APIError.serverError(401, 1002, "not logged in"))
        XCTAssertEqual(signedOut, .signedOut)
        let blocked = await error([:], playbackError: APIError.serverError(403, 1300, "blocked"))
        XCTAssertEqual(blocked, .status(403))
        let offline = await error([:], playbackError: APIError.networkError(URLError(.notConnectedToInternet)))
        XCTAssertEqual(offline, .network)
    }

    func testDownloadClientDoesNotPostAuthExpired() async throws {
        URLProtocolStub.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 401, httpVersion: nil, headerFields: nil)!
            return (response, Data(#"{"code":1002,"error":"not logged in"}"#.utf8))
        }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [URLProtocolStub.self]
        let client = APIClient(baseURL: "https://kmtv.example", session: URLSession(configuration: config),
                               tokenProvider: { "token" }, notifiesAuthExpired: false)
        let posted = expectation(forNotification: .authExpired, object: nil)
        posted.isInverted = true
        do {
            _ = try await client.playbackURL(url: "x", source: "s")
            XCTFail("expected 401")
        } catch APIError.serverError(let status, _, _) {
            XCTAssertEqual(status, 401)
        }
        await fulfillment(of: [posted], timeout: 0.5)
    }
}
