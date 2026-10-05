import CommonCrypto
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
        for name in ["ts", "fmp4", "aes", "fmp4-aes-clearinit"] {
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

    func testWriterOutputPlaysAESFixtureWithDerivedIV() async throws {
        let dir = root.appending(path: "aes")
        let text = try String(contentsOf: dir.appending(path: "index.m3u8"), encoding: .utf8)
        // The parser accepts only http(s) URIs; the writer names files by kind, so the base is irrelevant.
        //
        // 解析器只接受 http(s) URI; 写入器按类型命名文件, 因此基准 URL 无关紧要.
        let base = try XCTUnwrap(URL(string: "https://fixtures.example/aes/index.m3u8"))
        guard case .media(let playlist) = try HLSParser.parse(text, baseURL: base) else {
            return XCTFail("expected media playlist")
        }
        let manifest = DownloadManifest.build(from: playlist, generation: 1)
        XCTAssertEqual(manifest.entries.map(\.fileName), ["key-0.bin", "seg-00000.ts", "seg-00001.ts"])
        let written = LocalPlaylistWriter.write(manifest)
        try written.write(to: dir.appending(path: "index.m3u8"), atomically: true, encoding: .utf8)

        // The writer's IV for segment 1 must be its media sequence number, 6.
        let keyLines = written.split(separator: "\n").filter { $0.hasPrefix("#EXT-X-KEY:") }
        XCTAssertEqual(keyLines.count, 2)
        let ivHex = try XCTUnwrap(keyLines[1].components(separatedBy: "IV=0x").last?.prefix(32))
        XCTAssertEqual(String(ivHex).lowercased(), String(format: "%032x", 6))
        let iv = Data(stride(from: 0, to: 32, by: 2).map { offset in
            UInt8(ivHex.dropFirst(offset).prefix(2), radix: 16)!
        })

        let key = try Data(contentsOf: dir.appending(path: "key-0.bin"))
        let encrypted = try Data(contentsOf: dir.appending(path: "seg-00001.ts"))
        let plain = try Data(contentsOf: root.appending(path: "ts/seg-00001.ts"))
        XCTAssertEqual(try Self.decryptAES128CBC(encrypted, key: key, iv: iv), plain)
        let wrong = try Self.decryptAES128CBC(encrypted, key: key, iv: Data(count: 16))
        XCTAssertNotEqual(wrong.prefix(16), plain.prefix(16))
        XCTAssertEqual(plain.first, 0x47)

        let server = LocalMediaServer(root: root)
        _ = try await server.start()
        defer { server.stop() }
        let played = try await Self.playsPastOneSecond(try XCTUnwrap(server.url(forRelativePath: "aes/index.m3u8")))
        XCTAssertTrue(played)
    }

    /// Regression for a writer that declared the key before a clear init section, so AVPlayer
    /// decrypted the init and the item stalled in `.unknown` without an error.
    ///
    /// 回归测试: 写入器曾在明文 init 之前声明 key, AVPlayer 因而解密了 init, item 一直停在
    /// `.unknown` 且没有任何错误.
    ///
    /// The `fmp4-aes-clearinit` fixture is the `fmp4` fixture with its segments encrypted and the
    /// init left clear. Regenerate it from `apple/KMTVTests/Fixtures/HLS` with:
    ///
    /// `fmp4-aes-clearinit` 素材由 `fmp4` 素材加密分片而来, init 保持明文. 在
    /// `apple/KMTVTests/Fixtures/HLS` 下按如下命令重新生成:
    ///
    ///     cp fmp4/init-0.mp4 fmp4-aes-clearinit/
    ///     openssl rand 16 > fmp4-aes-clearinit/key-0.bin
    ///     K=$(xxd -p fmp4-aes-clearinit/key-0.bin)
    ///     for i in 0 1; do
    ///       openssl enc -aes-128-cbc -K "$K" -iv "$(printf '%032x' $i)" \
    ///         -in fmp4/seg-0000$i.m4s -out fmp4-aes-clearinit/seg-0000$i.m4s
    ///     done
    ///
    /// The IV is each segment's media sequence number (0 and 1), and `index.m3u8` declares
    /// `EXT-X-MAP` before `EXT-X-KEY`.
    ///
    /// IV 为各分片的 media sequence 号 (0 与 1), `index.m3u8` 中 `EXT-X-MAP` 位于 `EXT-X-KEY` 之前.
    func testWriterOutputPlaysEncryptedFMP4WithClearInit() async throws {
        let dir = root.appending(path: "fmp4-aes-clearinit")
        let text = try String(contentsOf: dir.appending(path: "index.m3u8"), encoding: .utf8)
        let base = try XCTUnwrap(URL(string: "https://fixtures.example/fmp4-aes-clearinit/index.m3u8"))
        guard case .media(let playlist) = try HLSParser.parse(text, baseURL: base) else {
            return XCTFail("expected media playlist")
        }
        let manifest = DownloadManifest.build(from: playlist, generation: 1)
        XCTAssertEqual(manifest.entries.map(\.fileName), ["key-0.bin", "init-0.mp4", "seg-00000.m4s", "seg-00001.m4s"])
        try LocalPlaylistWriter.write(manifest).write(to: dir.appending(path: "local.m3u8"), atomically: true,
                                                      encoding: .utf8)
        let server = LocalMediaServer(root: root)
        _ = try await server.start()
        defer { server.stop() }
        let played = try await Self.playsPastOneSecond(
            try XCTUnwrap(server.url(forRelativePath: "fmp4-aes-clearinit/local.m3u8")))
        XCTAssertTrue(played)
    }

    private static func decryptAES128CBC(_ data: Data, key: Data, iv: Data) throws -> Data {
        var output = Data(count: data.count + kCCBlockSizeAES128)
        let outputCapacity = output.count
        var moved = 0
        let status = output.withUnsafeMutableBytes { out in
            data.withUnsafeBytes { input in
                key.withUnsafeBytes { keyBytes in
                    iv.withUnsafeBytes { ivBytes in
                        CCCrypt(CCOperation(kCCDecrypt), CCAlgorithm(kCCAlgorithmAES), CCOptions(kCCOptionPKCS7Padding),
                                keyBytes.baseAddress, key.count, ivBytes.baseAddress,
                                input.baseAddress, data.count, out.baseAddress, outputCapacity, &moved)
                    }
                }
            }
        }
        guard status == kCCSuccess else { throw CocoaError(.coderInvalidValue) }
        return output.prefix(moved)
    }
}
