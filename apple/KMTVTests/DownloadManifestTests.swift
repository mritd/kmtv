import XCTest
@testable import KMTV

/// Covers manifest building, refresh mapping, persistence, and the local playlist writer.
///
/// 覆盖 manifest 构建, 刷新映射, 持久化以及本地 playlist 生成.
final class DownloadManifestTests: XCTestCase {
    private let base = URL(string: "https://cdn.example/v/index.m3u8")!

    private func media(_ text: String) throws -> HLSMediaPlaylist {
        guard case .media(let playlist) = try HLSParser.parse(text, baseURL: base) else {
            throw HLSParseError.notHLS
        }
        return playlist
    }

    private let encrypted = """
    #EXTM3U
    #EXT-X-VERSION:3
    #EXT-X-TARGETDURATION:4
    #EXT-X-MEDIA-SEQUENCE:7
    #EXT-X-KEY:METHOD=AES-128,URI="k.bin"
    #EXTINF:4.0,
    a.ts
    #EXTINF:3.5,
    b.ts
    #EXT-X-KEY:METHOD=NONE
    #EXT-X-DISCONTINUITY
    #EXTINF:2.0,
    c.ts
    #EXT-X-ENDLIST
    """

    func testBuildDedupesKeysAndNamesEntriesByKind() throws {
        let manifest = DownloadManifest.build(from: try media(encrypted), generation: 1)
        XCTAssertEqual(manifest.entries.map(\.fileName), ["key-0.bin", "seg-00000.ts", "seg-00001.ts", "seg-00002.ts"])
        XCTAssertEqual(manifest.entries.map(\.kind), [.key, .segment, .segment, .segment])
        XCTAssertEqual(manifest.lines.count, 3)
        XCTAssertEqual(manifest.lines[0].key, 0)
        XCTAssertNil(manifest.lines[2].key)
        XCTAssertTrue(manifest.lines[2].discontinuity)
        XCTAssertEqual(manifest.totalDuration, 9.5, accuracy: 0.001)
        XCTAssertEqual(manifest.missing.count, 4)
        XCTAssertFalse(manifest.isComplete)
    }

    func testFMP4UsesMapAndM4SNames() throws {
        let manifest = DownloadManifest.build(from: try media("""
        #EXTM3U
        #EXT-X-VERSION:7
        #EXT-X-TARGETDURATION:2
        #EXT-X-MAP:URI="init.mp4"
        #EXTINF:2,
        s0.m4s
        #EXTINF:2,
        s1.m4s
        #EXT-X-ENDLIST
        """), generation: 1)
        XCTAssertEqual(manifest.entries.map(\.fileName), ["init-0.mp4", "seg-00000.m4s", "seg-00001.m4s"])
        let playlist = LocalPlaylistWriter.write(manifest)
        XCTAssertTrue(playlist.contains("#EXT-X-MAP:URI=\"init-0.mp4\""))
        XCTAssertTrue(playlist.contains("#EXT-X-VERSION:7"))
    }

    func testProxiedKeysDedupeOnUpstreamURL() throws {
        let manifest = DownloadManifest.build(from: try media("""
        #EXTM3U
        #EXT-X-TARGETDURATION:4
        #EXT-X-KEY:METHOD=AES-128,URI="https://kmtv.test/api/v1/proxy/key?url=https%3A%2F%2Fcdn.test%2Fk.bin&mt=aaa"
        #EXTINF:4,
        a.ts
        #EXT-X-KEY:METHOD=AES-128,URI="https://kmtv.test/api/v1/proxy/key?url=https%3A%2F%2Fcdn.test%2Fk.bin&mt=bbb"
        #EXTINF:4,
        b.ts
        #EXT-X-KEY:METHOD=AES-128,URI="https://kmtv.test/api/v1/proxy/key?url=https%3A%2F%2Fcdn.test%2Fk2.bin&mt=ccc"
        #EXTINF:4,
        c.ts
        #EXT-X-ENDLIST
        """), generation: 1)
        XCTAssertEqual(manifest.entries.filter { $0.kind == .key }.map(\.fileName), ["key-0.bin", "key-1.bin"])
        XCTAssertEqual(manifest.lines[0].key, manifest.lines[1].key)
        XCTAssertNotEqual(manifest.lines[2].key, manifest.lines[0].key)
    }

    func testWriterEmitsHeaderAndExplicitMediaSequenceIV() throws {
        let playlist = LocalPlaylistWriter.write(DownloadManifest.build(from: try media(encrypted), generation: 1))
        let lines = playlist.components(separatedBy: "\n")
        XCTAssertEqual(lines.first, "#EXTM3U")
        XCTAssertTrue(lines.contains("#EXT-X-TARGETDURATION:4"))
        XCTAssertTrue(lines.contains("#EXT-X-MEDIA-SEQUENCE:7"))
        XCTAssertTrue(lines.contains("#EXT-X-PLAYLIST-TYPE:VOD"))
        XCTAssertEqual(lines.last(where: { !$0.isEmpty }), "#EXT-X-ENDLIST")
        XCTAssertTrue(lines.contains("#EXT-X-KEY:METHOD=AES-128,URI=\"key-0.bin\",IV=0x00000000000000000000000000000007"))
        XCTAssertTrue(lines.contains("#EXT-X-KEY:METHOD=AES-128,URI=\"key-0.bin\",IV=0x00000000000000000000000000000008"))
        XCTAssertTrue(lines.contains("#EXT-X-KEY:METHOD=NONE"))
        XCTAssertTrue(lines.contains("#EXT-X-DISCONTINUITY"))
        XCTAssertTrue(lines.contains("seg-00002.ts"))
        XCTAssertFalse(playlist.contains("https://"))
    }

    func testRefreshMappingKeepsDoneFlagsAndTakesNewURLs() throws {
        var old = DownloadManifest.build(from: try media(encrypted), generation: 1)
        old.entries[1].done = true
        old.entries[1].bytes = 100
        let fresh = DownloadManifest.build(from: try media(encrypted.replacingOccurrences(of: "a.ts", with: "a.ts?mt=new")), generation: 2)
        XCTAssertTrue(old.matches(fresh))
        let merged = old.adopting(urlsFrom: fresh)
        XCTAssertEqual(merged.generation, 2)
        XCTAssertTrue(merged.entries[1].done)
        XCTAssertEqual(merged.entries[1].remoteURL.absoluteString, "https://cdn.example/v/a.ts?mt=new")
        let shorter = DownloadManifest.build(from: try media("""
        #EXTM3U
        #EXT-X-TARGETDURATION:4
        #EXTINF:4.0,
        a.ts
        #EXT-X-ENDLIST
        """), generation: 2)
        XCTAssertFalse(old.matches(shorter))
    }

    func testSaveAndLoadRoundTrip() throws {
        let manifest = DownloadManifest.build(from: try media(encrypted), generation: 4)
        let url = FileManager.default.temporaryDirectory.appending(path: "manifest-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: url) }
        try manifest.save(to: url)
        XCTAssertEqual(DownloadManifest.load(from: url), manifest)
        XCTAssertNil(DownloadManifest.load(from: url.appending(path: "missing")))
    }
}
