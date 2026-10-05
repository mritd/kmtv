import XCTest
@testable import KMTV

/// Covers HLS master and media playlist parsing for downloads.
///
/// 覆盖下载使用的 HLS master 与 media playlist 解析.
final class HLSParserTests: XCTestCase {
    private let base = URL(string: "https://cdn.example/vod/show/index.m3u8")!

    func testMediaPlaylistWithKeysMapsAndDiscontinuity() throws {
        let text = """
        #EXTM3U
        #EXT-X-VERSION:7
        #EXT-X-TARGETDURATION:6
        #EXT-X-MEDIA-SEQUENCE:10
        #EXT-X-PROGRAM-DATE-TIME:2026-01-01T00:00:00Z
        #EXT-X-MAP:URI="init.mp4"
        #EXT-X-KEY:METHOD=AES-128,URI="https://keys.example/k1",IV=0x0000000000000000000000000000000A
        #EXTINF:6.0,
        seg0.m4s
        #EXT-X-KEY:METHOD=NONE
        #EXTINF:5.5,title
        /abs/seg1.m4s
        #EXT-X-DISCONTINUITY
        #EXT-X-KEY:METHOD=AES-128,URI="k2"
        #EXTINF:4,
        https://other.example/seg2.m4s?x=1
        #EXT-X-ENDLIST
        """
        guard case .media(let playlist) = try HLSParser.parse(text, baseURL: base) else {
            return XCTFail("expected media playlist")
        }
        XCTAssertEqual(playlist.version, 7)
        XCTAssertEqual(playlist.targetDuration, 6)
        XCTAssertEqual(playlist.mediaSequence, 10)
        XCTAssertEqual(playlist.segments.count, 3)
        let s0 = playlist.segments[0], s1 = playlist.segments[1], s2 = playlist.segments[2]
        XCTAssertEqual(s0.uri.absoluteString, "https://cdn.example/vod/show/seg0.m4s")
        XCTAssertEqual(s0.map?.absoluteString, "https://cdn.example/vod/show/init.mp4")
        XCTAssertEqual(s0.key, .aes128(uri: URL(string: "https://keys.example/k1")!,
                                       iv: Data([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x0A])))
        XCTAssertEqual(s0.mediaSequence, 10)
        XCTAssertEqual(s1.uri.absoluteString, "https://cdn.example/abs/seg1.m4s")
        XCTAssertEqual(s1.duration, 5.5)
        XCTAssertEqual(s1.key, .none)
        XCTAssertFalse(s1.discontinuity)
        XCTAssertEqual(s1.mediaSequence, 11)
        XCTAssertTrue(s2.discontinuity)
        XCTAssertEqual(s2.key, .aes128(uri: URL(string: "https://cdn.example/vod/show/k2")!, iv: nil))
        XCTAssertEqual(s2.uri.absoluteString, "https://other.example/seg2.m4s?x=1")
        XCTAssertEqual(s2.map?.absoluteString, "https://cdn.example/vod/show/init.mp4")
    }

    func testProxiedURIsKeepTheirQuery() throws {
        let text = """
        #EXTM3U
        #EXT-X-TARGETDURATION:2
        #EXTINF:2,
        https://kmtv.example/api/v1/proxy/segment?url=https%3A%2F%2Fcdn%2Fa.ts&source=s&mt=abc
        #EXT-X-ENDLIST
        """
        guard case .media(let playlist) = try HLSParser.parse(text, baseURL: base) else { return XCTFail() }
        XCTAssertEqual(playlist.segments[0].uri.absoluteString,
                       "https://kmtv.example/api/v1/proxy/segment?url=https%3A%2F%2Fcdn%2Fa.ts&source=s&mt=abc")
    }

    func testMasterPlaylistPicksHighestBandwidth() throws {
        let text = """
        #EXTM3U
        #EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
        low.m3u8
        #EXT-X-STREAM-INF:BANDWIDTH=2400000,CODECS="avc1.4d401f,mp4a.40.2"
        high/index.m3u8
        """
        guard case .master(let master) = try HLSParser.parse(text, baseURL: base) else { return XCTFail() }
        XCTAssertEqual(master.variants.count, 2)
        let best = try HLSParser.bestVariant(master)
        XCTAssertEqual(best.bandwidth, 2_400_000)
        XCTAssertEqual(best.uri.absoluteString, "https://cdn.example/vod/show/high/index.m3u8")
    }

    func testVariantWithSeparateAudioRenditionIsRejected() throws {
        let text = """
        #EXTM3U
        #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="en",URI="audio.m3u8"
        #EXT-X-STREAM-INF:BANDWIDTH=900000,AUDIO="aud"
        video.m3u8
        """
        guard case .master(let master) = try HLSParser.parse(text, baseURL: base) else { return XCTFail() }
        XCTAssertThrowsError(try HLSParser.bestVariant(master)) { XCTAssertEqual($0 as? HLSParseError, .separateAudio) }
    }

    func testAudioGroupWithoutURIIsMuxedAndAccepted() throws {
        let text = """
        #EXTM3U
        #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="en",DEFAULT=YES
        #EXT-X-STREAM-INF:BANDWIDTH=900000,AUDIO="aud"
        video.m3u8
        """
        guard case .master(let master) = try HLSParser.parse(text, baseURL: base) else { return XCTFail() }
        XCTAssertEqual(try HLSParser.bestVariant(master).bandwidth, 900_000)
    }

    func testRejectsUnsupportedInputs() {
        func error(_ text: String) -> HLSParseError? {
            do { _ = try HLSParser.parse(text, baseURL: base); return nil } catch { return error as? HLSParseError }
        }
        XCTAssertEqual(error("<html></html>"), .notHLS)
        XCTAssertEqual(error("#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\na.ts\n"), .live)
        XCTAssertEqual(error("#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI=\"k\"\n#EXTINF:2,\na.ts\n#EXT-X-ENDLIST"),
                       .unsupportedKey("SAMPLE-AES"))
        XCTAssertEqual(error("#EXTM3U\n#EXTINF:2,\n#EXT-X-BYTERANGE:100@0\na.ts\n#EXT-X-ENDLIST"), .byteRange)
        XCTAssertEqual(error("#EXTM3U\n#EXT-X-ENDLIST"), .noSegments)
    }

    func testAttributesAndIV() {
        let attrs = HLSParser.attributes(#"METHOD=AES-128,URI="a,b.key",IV=0X1F"#)
        XCTAssertEqual(attrs["METHOD"], "AES-128")
        XCTAssertEqual(attrs["URI"], "a,b.key")
        XCTAssertEqual(HLSParser.parseIV("0X1F"), Data(repeating: 0, count: 15) + Data([0x1F]))
        XCTAssertNil(HLSParser.parseIV("zz"))
        XCTAssertNil(HLSParser.parseIV("0x" + String(repeating: "1", count: 34)))
    }

    func testBOMAndCRLF() throws {
        let text = "\u{FEFF}#EXTM3U\r\n#EXT-X-TARGETDURATION:2\r\n#EXTINF:2,\r\na.ts\r\n#EXT-X-ENDLIST\r\n"
        guard case .media(let playlist) = try HLSParser.parse(text, baseURL: base) else { return XCTFail() }
        XCTAssertEqual(playlist.segments.map(\.uri.lastPathComponent), ["a.ts"])
    }

    func testRejectsMalformedNumbers() {
        func error(_ text: String) -> HLSParseError? {
            do { _ = try HLSParser.parse(text, baseURL: base); return nil } catch { return error as? HLSParseError }
        }
        XCTAssertEqual(error("#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:9223372036854775807\n#EXTINF:2,\na.ts\n#EXTINF:2,\nb.ts\n#EXT-X-ENDLIST"), .notHLS)
        XCTAssertEqual(error("#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:-1\n#EXTINF:2,\na.ts\n#EXT-X-ENDLIST"), .notHLS)
        XCTAssertEqual(error("#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:abc\n#EXTINF:2,\na.ts\n#EXT-X-ENDLIST"), .notHLS)
        for bad in ["inf", "nan", "-1"] {
            XCTAssertEqual(error("#EXTM3U\n#EXTINF:\(bad),\na.ts\n#EXT-X-ENDLIST"), .notHLS, bad)
        }
    }

    func testRejectsDurationsLongerThanADay() throws {
        func error(_ text: String) -> HLSParseError? {
            do { _ = try HLSParser.parse(text, baseURL: base); return nil } catch { return error as? HLSParseError }
        }
        // Without a target duration the parser derives one from the longest segment; these used to
        // overflow `Int` there and crash.
        //
        // 没有目标时长时, 解析器会根据最长分片推导; 这些值以前会在此处溢出 `Int` 并导致崩溃.
        for bad in ["1e300", "99999999999999999999", "86400.5"] {
            XCTAssertEqual(error("#EXTM3U\n#EXTINF:\(bad),\na.ts\n#EXT-X-ENDLIST"), .notHLS, bad)
        }
        guard case .media(let playlist) = try HLSParser.parse("#EXTM3U\n#EXTINF:86400,\na.ts\n#EXT-X-ENDLIST",
                                                              baseURL: base) else { return XCTFail() }
        XCTAssertEqual(playlist.targetDuration, 86_400)
    }

    func testRejectsNonHTTPURIs() {
        func error(_ text: String) -> HLSParseError? {
            do { _ = try HLSParser.parse(text, baseURL: base); return nil } catch { return error as? HLSParseError }
        }
        XCTAssertEqual(error("#EXTM3U\n#EXTINF:2,\nfile:///etc/passwd\n#EXT-X-ENDLIST"), .unsupportedURI)
        XCTAssertEqual(error("#EXTM3U\n#EXTINF:2,\ndata:text/plain,hello\n#EXT-X-ENDLIST"), .unsupportedURI)
        XCTAssertEqual(error("#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"file:///k\"\n#EXTINF:2,\na.ts\n#EXT-X-ENDLIST"),
                       .unsupportedURI)
        XCTAssertEqual(error("#EXTM3U\n#EXT-X-MAP:URI=\"data:,x\"\n#EXTINF:2,\na.m4s\n#EXT-X-ENDLIST"), .unsupportedURI)
        XCTAssertEqual(error("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nfile:///v.m3u8"), .unsupportedURI)
        XCTAssertEqual(error("#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"a\",URI=\"ftp://x/a.m3u8\"\n"
                             + "#EXT-X-STREAM-INF:BANDWIDTH=1\nv.m3u8"), .unsupportedURI)
        // A file base URL resolves relative references to file URLs, which are refused too.
        //
        // 以文件 URL 为基准时, 相对引用会解析为文件 URL, 同样会被拒绝.
        XCTAssertThrowsError(try HLSParser.parse("#EXTM3U\n#EXTINF:2,\na.ts\n#EXT-X-ENDLIST",
                                                 baseURL: URL(fileURLWithPath: "/tmp/index.m3u8"))) {
            XCTAssertEqual($0 as? HLSParseError, .unsupportedURI)
        }
        XCTAssertNil(error("#EXTM3U\n#EXTINF:2,\nHTTP://CDN.example/a.ts\n#EXT-X-ENDLIST"))
    }
}
