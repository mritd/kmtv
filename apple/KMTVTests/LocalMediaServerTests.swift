import AVFoundation
import XCTest
@testable import KMTV

/// Covers the loopback media server: request routing, path containment, and real AVPlayer
/// playback of downloaded HLS fixtures (file-based HLS never plays, see ADR-017).
///
/// 覆盖 loopback 媒体服务: 请求路由, 路径越界检查, 以及 AVPlayer 对下载好的 HLS 素材的真实播放
/// (基于文件的 HLS 无法播放, 见 ADR-017).
@MainActor
final class LocalMediaServerTests: XCTestCase {
    private var root: URL!

    override func setUp() async throws {
        root = FileManager.default.temporaryDirectory.appending(path: "lms-\(UUID().uuidString)")
        let fixtures = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "Fixtures", withExtension: nil))
        try FileManager.default.copyItem(at: fixtures.appending(path: "HLS"), to: root)
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: root)
    }

    func testServesFileUnderSecretWithContentType() {
        let handler = LocalMediaRequestHandler(root: root, secret: "s3cret")
        let playlist = handler.response(forRequestHead: "GET /s3cret/ts/index.m3u8 HTTP/1.1\r\nHost: x\r\n\r\n")
        XCTAssertEqual(playlist.status, 200)
        XCTAssertEqual(playlist.contentType, "application/vnd.apple.mpegurl")
        XCTAssertTrue(String(decoding: playlist.body, as: UTF8.self).hasPrefix("#EXTM3U"))
        XCTAssertEqual(handler.response(forRequestHead: "GET /s3cret/ts/seg-00000.ts HTTP/1.1\r\n\r\n").contentType, "video/mp2t")
        XCTAssertEqual(handler.response(forRequestHead: "GET /s3cret/fmp4/init-0.mp4 HTTP/1.1\r\n\r\n").contentType, "video/mp4")
        XCTAssertEqual(handler.response(forRequestHead: "GET /s3cret/fmp4/seg-00000.m4s HTTP/1.1\r\n\r\n").contentType, "video/mp4")
        XCTAssertEqual(handler.response(forRequestHead: "GET /s3cret/aes/key-0.bin HTTP/1.1\r\n\r\n").contentType, "application/octet-stream")
    }

    func testRejectsMissingSecretTraversalAndOtherMethods() throws {
        let handler = LocalMediaRequestHandler(root: root, secret: "s3cret")
        XCTAssertEqual(handler.response(forRequestHead: "GET /ts/index.m3u8 HTTP/1.1\r\n\r\n").status, 404)
        XCTAssertEqual(handler.response(forRequestHead: "GET /wrong/ts/index.m3u8 HTTP/1.1\r\n\r\n").status, 404)
        XCTAssertEqual(handler.response(forRequestHead: "GET /s3cret/../etc/passwd HTTP/1.1\r\n\r\n").status, 404)
        XCTAssertEqual(handler.response(forRequestHead: "GET /s3cret/%2E%2E/%2E%2E/x HTTP/1.1\r\n\r\n").status, 404)
        XCTAssertEqual(handler.response(forRequestHead: "POST /s3cret/ts/index.m3u8 HTTP/1.1\r\n\r\n").status, 405)
        XCTAssertEqual(handler.response(forRequestHead: "garbage").status, 400)
        // A symlink inside the root that points outside it is refused.
        //
        // 根目录内指向外部的软链接会被拒绝.
        let outside = FileManager.default.temporaryDirectory.appending(path: "lms-outside-\(UUID().uuidString)")
        try Data("secret".utf8).write(to: outside)
        defer { try? FileManager.default.removeItem(at: outside) }
        try FileManager.default.createSymbolicLink(at: root.appending(path: "ts/link.ts"), withDestinationURL: outside)
        XCTAssertEqual(handler.response(forRequestHead: "GET /s3cret/ts/link.ts HTTP/1.1\r\n\r\n").status, 404)
    }

    func testAVPlayerPlaysAllFixturesThroughLoopback() async throws {
        let server = LocalMediaServer(root: root)
        let port = try await server.start()
        defer { server.stop() }
        XCTAssertNotEqual(port, 0)
        for name in ["ts", "fmp4", "aes"] {
            let url = try XCTUnwrap(server.url(forRelativePath: "\(name)/index.m3u8"))
            let played = try await Self.playsPastOneSecond(url)
            XCTAssertTrue(played, "\(name) did not play through \(url)")
        }
    }

    func testRestartKeepsPort() async throws {
        let server = LocalMediaServer(root: root)
        let first = try await server.start()
        server.stop()
        let second = try await server.start()
        defer { server.stop() }
        XCTAssertEqual(first, second)
    }

    private static func playsPastOneSecond(_ url: URL) async throws -> Bool {
        let item = AVPlayerItem(url: url)
        let player = AVPlayer(playerItem: item)
        player.isMuted = true
        player.play()
        defer { player.pause() }
        for _ in 0..<100 {
            if item.status == .failed { return false }
            if item.status == .readyToPlay, item.currentTime().seconds > 1 { return true }
            try await Task.sleep(for: .milliseconds(100))
        }
        return false
    }
}
