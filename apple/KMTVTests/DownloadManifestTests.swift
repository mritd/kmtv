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

    func testEncryptedEntriesAreKeyedSegmentsAndMaps() throws {
        let ts = DownloadManifest.build(from: try media(encrypted), generation: 1)
        XCTAssertEqual(ts.entries.indices.map { ts.isEncrypted(entry: $0) }, [false, true, true, false])
        let fmp4 = DownloadManifest.build(from: try media("""
        #EXTM3U
        #EXT-X-VERSION:7
        #EXT-X-TARGETDURATION:2
        #EXT-X-KEY:METHOD=AES-128,URI="k.bin"
        #EXT-X-MAP:URI="init.mp4"
        #EXTINF:2,
        s0.m4s
        #EXT-X-ENDLIST
        """), generation: 1)
        XCTAssertEqual(fmp4.entries.map(\.kind), [.key, .map, .segment])
        XCTAssertEqual(fmp4.entries.indices.map { fmp4.isEncrypted(entry: $0) }, [false, true, true])
    }

    private let clearInit = """
    #EXTM3U
    #EXT-X-VERSION:7
    #EXT-X-TARGETDURATION:2
    #EXT-X-MAP:URI="init.mp4"
    #EXT-X-KEY:METHOD=AES-128,URI="k.bin",IV=0x0000000000000000000000000000000A
    #EXTINF:2,
    s0.m4s
    #EXTINF:2,
    s1.m4s
    #EXT-X-ENDLIST
    """

    func testMapDeclaredBeforeTheKeyIsClear() throws {
        let manifest = DownloadManifest.build(from: try media(clearInit), generation: 1)
        XCTAssertEqual(manifest.entries.map(\.kind), [.key, .map, .segment, .segment])
        XCTAssertEqual(manifest.entries.indices.map { manifest.isEncrypted(entry: $0) }, [false, false, true, true])
    }

    func testWriterKeepsTheInitSectionEncryptionOfTheSource() throws {
        func order(_ playlist: String) -> [String] {
            playlist.split(separator: "\n").map(String.init).filter { $0.hasPrefix("#EXT-X-KEY") || $0.hasPrefix("#EXT-X-MAP") }
        }
        // A clear init is declared while no key is active, so AVPlayer does not decrypt it.
        //
        // 明文 init 在没有生效 key 时声明, AVPlayer 因此不会对它解密.
        let clear = LocalPlaylistWriter.write(DownloadManifest.build(from: try media(clearInit), generation: 1))
        XCTAssertEqual(order(clear), [
            #"#EXT-X-MAP:URI="init-0.mp4""#,
            #"#EXT-X-KEY:METHOD=AES-128,URI="key-0.bin",IV=0x0000000000000000000000000000000A"#,
            #"#EXT-X-KEY:METHOD=AES-128,URI="key-0.bin",IV=0x0000000000000000000000000000000A"#,
        ])
        // A clear init after encrypted segments first switches the key off.
        //
        // 加密分片之后出现的明文 init 会先关闭 key.
        let switched = LocalPlaylistWriter.write(DownloadManifest.build(from: try media("""
        #EXTM3U
        #EXT-X-VERSION:7
        #EXT-X-TARGETDURATION:2
        #EXT-X-KEY:METHOD=AES-128,URI="k.bin"
        #EXT-X-MAP:URI="a.mp4"
        #EXTINF:2,
        s0.m4s
        #EXT-X-DISCONTINUITY
        #EXT-X-KEY:METHOD=NONE
        #EXT-X-MAP:URI="b.mp4"
        #EXT-X-KEY:METHOD=AES-128,URI="k.bin"
        #EXTINF:2,
        s1.m4s
        #EXT-X-ENDLIST
        """), generation: 1))
        XCTAssertEqual(order(switched), [
            #"#EXT-X-KEY:METHOD=AES-128,URI="key-0.bin",IV=0x00000000000000000000000000000000"#,
            #"#EXT-X-MAP:URI="init-0.mp4""#,
            "#EXT-X-KEY:METHOD=NONE",
            #"#EXT-X-MAP:URI="init-1.mp4""#,
            #"#EXT-X-KEY:METHOD=AES-128,URI="key-0.bin",IV=0x00000000000000000000000000000001"#,
        ])
    }

    func testManifestsSavedBeforeTheMapFlagKeepTreatingKeyedMapsAsEncrypted() throws {
        var manifest = DownloadManifest.build(from: try media(clearInit), generation: 1)
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(manifest)) as? [String: Any])
        json["lines"] = (json["lines"] as? [[String: Any]])?.map { line in line.filter { $0.key != "mapEncrypted" } }
        manifest = try JSONDecoder().decode(DownloadManifest.self, from: JSONSerialization.data(withJSONObject: json))
        XCTAssertEqual(manifest.entries.indices.map { manifest.isEncrypted(entry: $0) }, [false, true, true, true])
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

    func testAdoptingTakesTheFreshLinesAndKeepsProgress() throws {
        var old = DownloadManifest.build(from: try media(clearInit), generation: 1)
        // A manifest saved before the map flag existed decodes with nil flags.
        //
        // 在 map 标记出现之前保存的 manifest 解码后标记为 nil.
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(old)) as? [String: Any])
        json["lines"] = (json["lines"] as? [[String: Any]])?.map { line in line.filter { $0.key != "mapEncrypted" } }
        old = try JSONDecoder().decode(DownloadManifest.self, from: JSONSerialization.data(withJSONObject: json))
        old.entries[2].done = true
        old.entries[2].bytes = 100
        old.entries[3].attempts = 2
        XCTAssertTrue(old.isEncrypted(entry: 1))
        let fresh = DownloadManifest.build(from: try media(clearInit.replacingOccurrences(of: "s0.m4s", with: "s0.m4s?mt=new")),
                                           generation: 2)
        XCTAssertTrue(old.matches(fresh))
        let merged = old.adopting(urlsFrom: fresh)
        XCTAssertEqual(merged.lines, fresh.lines)
        XCTAssertFalse(merged.isEncrypted(entry: 1))
        XCTAssertEqual(merged.generation, 2)
        XCTAssertEqual(merged.entries.map(\.done), [false, false, true, false])
        XCTAssertEqual(merged.entries[2].bytes, 100)
        XCTAssertEqual(merged.entries[3].attempts, 2)
        XCTAssertEqual(merged.entries[2].remoteURL.absoluteString, "https://cdn.example/v/s0.m4s?mt=new")
    }

    func testMismatchSummaryNamesCountsAndTheFirstDifferentEntry() throws {
        let old = DownloadManifest.build(from: try media(encrypted), generation: 1)
        XCTAssertEqual(old.mismatchSummary(old), "entries=4/4 lines=3/3 first=none")
        let longer = DownloadManifest.build(from: try media(encrypted.replacingOccurrences(
            of: "#EXT-X-ENDLIST", with: "#EXTINF:2.0,\nd.ts\n#EXT-X-ENDLIST")), generation: 2)
        XCTAssertEqual(old.mismatchSummary(longer), "entries=4/5 lines=3/4 first=none")
        let retimed = DownloadManifest.build(from: try media(encrypted.replacingOccurrences(of: "#EXTINF:3.5,",
                                                                                      with: "#EXTINF:3.25,")),
                                             generation: 2)
        XCTAssertEqual(old.mismatchSummary(retimed), "entries=4/4 lines=3/3 first=2 kind=segment/segment duration=3.500/3.250")
        let clear = DownloadManifest.build(from: try media(encrypted.replacingOccurrences(
            of: "#EXT-X-KEY:METHOD=AES-128,URI=\"k.bin\"\n", with: "")), generation: 2)
        XCTAssertEqual(old.mismatchSummary(clear), "entries=4/3 lines=3/3 first=0 kind=key/segment duration=0.000/4.000")
        // No URL ever reaches the summary.
        //
        // 摘要中从不包含任何 URL.
        XCTAssertFalse(old.mismatchSummary(clear).contains("http"))
    }

    func testWriterCoalescesToTheLatestSnapshotPerEpisode() async throws {
        let recorder = WriteRecorder()
        let writer = DownloadManifestWriter(write: { manifest, _ in recorder.record(manifest.generation) })
        let base = DownloadManifest.build(from: try media(encrypted), generation: 1)
        func snapshot(_ generation: Int) -> DownloadManifest {
            var copy = base
            copy.generation = generation
            return copy
        }
        let url = FileManager.default.temporaryDirectory.appending(path: "unused.json")
        recorder.blockNextWrite()
        writer.submit(snapshot(1), to: url, key: "a")
        try await recorder.waitUntilBlocked()
        // Two newer snapshots arrive while the first write runs; only the latest is written.
        //
        // 第一次写入期间又来了两个更新的快照; 只有最新的那个会被写入.
        writer.submit(snapshot(2), to: url, key: "a")
        writer.submit(snapshot(3), to: url, key: "a")
        recorder.unblock()
        await writer.flush("a")
        XCTAssertEqual(recorder.generations, [1, 3])
    }

    func testWriterDiscardDropsPendingAndWaitsForTheWriteInProgress() async throws {
        let recorder = WriteRecorder()
        let writer = DownloadManifestWriter(write: { manifest, _ in recorder.record(manifest.generation) })
        var manifest = DownloadManifest.build(from: try media(encrypted), generation: 1)
        let url = FileManager.default.temporaryDirectory.appending(path: "unused.json")
        recorder.blockNextWrite()
        writer.submit(manifest, to: url, key: "s/a/1")
        try await recorder.waitUntilBlocked()
        manifest.generation = 2
        writer.submit(manifest, to: url, key: "s/a/1")
        manifest.generation = 3
        writer.submit(manifest, to: url, key: "t/b/1")
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.1) { recorder.unblock() }
        // Returns only after the write in progress ends; the other scope's write still runs, and the
        // discarded snapshot never does.
        //
        // 只在进行中的写入结束后返回; 其他作用域的写入照常执行, 被丢弃的快照不会执行.
        await writer.discard { $0.hasPrefix("s/") }
        XCTAssertEqual(recorder.generations.first, 1)
        await writer.flushAll()
        XCTAssertEqual(recorder.generations, [1, 3])
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

/// Records manifest writes by generation and can hold the next write until released.
///
/// 按 generation 记录 manifest 写入, 并可在放行之前阻塞下一次写入.
private final class WriteRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private let semaphore = DispatchSemaphore(value: 0)
    private var _generations: [Int] = []
    private var blockNext = false
    private var blocked = false

    var generations: [Int] { lock.withLock { _generations } }

    /// Makes the next write wait for `unblock()`.
    ///
    /// 让下一次写入等待 `unblock()`.
    func blockNextWrite() { lock.withLock { blockNext = true } }

    /// Releases the held write.
    ///
    /// 放行被阻塞的写入.
    func unblock() { semaphore.signal() }

    /// Records a write; runs on the writer's queue.
    ///
    /// 记录一次写入; 在写入器的队列上运行.
    func record(_ generation: Int) {
        let hold = lock.withLock {
            let hold = blockNext
            blockNext = false
            if hold { blocked = true }
            return hold
        }
        if hold { semaphore.wait() }
        lock.withLock { _generations.append(generation) }
    }

    /// Returns once a write is held.
    ///
    /// 有写入被阻塞后返回.
    func waitUntilBlocked() async throws {
        for _ in 0..<200 where !lock.withLock({ blocked }) { try await Task.sleep(for: .milliseconds(10)) }
    }
}
