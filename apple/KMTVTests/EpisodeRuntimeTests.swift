import XCTest
@testable import KMTV

/// Covers per-episode runtime state: facts per generation, `forget`, pruning, and pending progress.
///
/// 覆盖每集的运行时状态: 按 generation 缓存的派生信息, `forget`, 清理空条目以及待同步进度.
final class EpisodeRuntimeTests: XCTestCase {
    private func manifest(generation: Int, segments: Int = 3) throws -> DownloadManifest {
        var text = "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-KEY:METHOD=AES-128,URI=\"k.bin\"\n"
        for index in 0..<segments { text += "#EXTINF:2,\ns\(index).ts\n" }
        text += "#EXT-X-ENDLIST\n"
        guard case .media(let media) = try HLSParser.parse(text, baseURL: URL(string: "https://cdn.example/p.m3u8")!) else {
            throw HLSParseError.notHLS
        }
        return DownloadManifest.build(from: media, generation: generation)
    }

    func testFactsAreCachedPerGeneration() throws {
        var runtime = EpisodeRuntime()
        let first = try manifest(generation: 1)
        var facts = runtime.facts(for: first)
        XCTAssertEqual(facts.generation, 1)
        XCTAssertEqual(facts.encrypted, first.encryptedEntries)
        XCTAssertEqual(facts.remaining, 4)
        runtime.facts?.remaining = 1
        facts = runtime.facts(for: first)
        XCTAssertEqual(facts.remaining, 1, "same generation keeps the running count")
        facts = runtime.facts(for: try manifest(generation: 2, segments: 5))
        XCTAssertEqual(facts.generation, 2)
        XCTAssertEqual(facts.remaining, 6)
        runtime.cacheLoaded(try manifest(generation: 3))
        XCTAssertNil(runtime.facts)
    }

    func testForgetClearsTheCacheButKeepsCompleting() throws {
        var runtime = EpisodeRuntime(manifest: try manifest(generation: 1), facts: nil, unsaved: 4,
                                     progressPending: true, completing: true)
        _ = runtime.facts(for: try XCTUnwrap(runtime.manifest))
        runtime.forget()
        XCTAssertNil(runtime.manifest)
        XCTAssertNil(runtime.facts)
        XCTAssertEqual(runtime.unsaved, 0)
        XCTAssertFalse(runtime.progressPending)
        XCTAssertTrue(runtime.completing)
        XCTAssertFalse(runtime.isEmpty)
        runtime.completing = false
        XCTAssertTrue(runtime.isEmpty)
    }

    func testTableForgetDropsEmptyEntriesOnly() throws {
        var table: [String: EpisodeRuntime] = [:]
        table["a"] = EpisodeRuntime(manifest: try manifest(generation: 1), unsaved: 2, progressPending: true)
        table["b"] = EpisodeRuntime(manifest: try manifest(generation: 1), completing: true)
        table.forget("a")
        table.forget("b")
        table.forget("missing")
        XCTAssertNil(table["a"])
        XCTAssertEqual(table["b"]?.completing, true)
        XCTAssertNil(table["b"]?.manifest)
        table["b"]?.completing = false
        table.prune("b")
        XCTAssertTrue(table.isEmpty)
    }

    func testTakePendingProgressClearsTheFlag() throws {
        var table: [String: EpisodeRuntime] = [:]
        table["a"] = EpisodeRuntime(manifest: try manifest(generation: 1), progressPending: true)
        table["b"] = EpisodeRuntime(progressPending: true)
        table["c"] = EpisodeRuntime(manifest: try manifest(generation: 1))
        XCTAssertEqual(Set(table.takePendingProgress()), ["a", "b"])
        XCTAssertEqual(table["a"]?.progressPending, false)
        XCTAssertNil(table["b"], "an entry with nothing left is dropped")
        XCTAssertNotNil(table["c"])
        XCTAssertTrue(table.takePendingProgress().isEmpty)
    }
}
