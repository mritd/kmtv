import Observation
import SwiftData
import XCTest
@testable import KMTV

/// Covers the download manager's queue, task handling, refresh, retry, pause, scope, and
/// relaunch rules against a fake transport and preparer.
///
/// 使用假的传输层与准备器, 覆盖下载管理器的队列, 任务处理, 刷新, 重试, 暂停, 作用域与重启规则.
@MainActor
final class DownloadManagerTests: XCTestCase {
    private let scope = syncScopeKey(serverURL: "https://kmtv.example", userID: 1)
    private let info = DownloadShowInfo(title: "Show", cover: "https://img.example/c.jpg", type: "tv", year: "2026",
                                        coverURL: nil)
    private let tokenBody = Data(#"{"code":1002,"error":"invalid or expired media token"}"#.utf8)
    private var root: URL!
    private var layout: DownloadLayout!
    private var container: ModelContainer!
    private var defaults: UserDefaults!
    private var transport: FakeDownloadTransport!
    private var preparer: FakePreparer!
    private var manager: DownloadManager!
    private let space = FreeSpaceStub(50_000_000_000)
    private let ticks = TickGate()
    private let writes = WriteBlocker()
    private var nowValue = Date(timeIntervalSince1970: 1_000)
    private let covers = CoverFetchRecorder()

    override func setUp() async throws {
        root = FileManager.default.temporaryDirectory.appending(path: "dm-\(UUID().uuidString)")
        layout = DownloadLayout(root: root)
        container = try ModelContainerFactory.makeInMemory()
        defaults = UserDefaults(suiteName: "DownloadManagerTests-\(UUID().uuidString)")
        transport = FakeDownloadTransport()
        preparer = FakePreparer()
        manager = makeManager()
        await manager.activate(scopeKey: scope, preparer: preparer)
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: root)
    }

    private func makeManager(wakeBudget: Duration = DownloadManager.backgroundWakeBudget,
                             outstandingLimit: Int = 100) -> DownloadManager {
        DownloadManager(context: container.mainContext, layout: layout, transport: transport, defaults: defaults,
                        freeSpace: { [space] in space.read() }, now: { [unowned self] in self.nowValue },
                        outstandingLimit: outstandingLimit, coverFetcher: { [covers] url in covers.fetch(url) },
                        backgroundWakeBudget: wakeBudget, progressWait: { [ticks] _ in await ticks.wait() },
                        manifestWriter: writes.writer())
    }

    /// Fires the pending progress tick, if any, and waits for it; independent of the real interval.
    ///
    /// 触发待发出的进度通知 (如有) 并等待其完成; 与真实间隔无关.
    private func tick() async {
        guard let pending = manager.progressTask else { return }
        ticks.release()
        await pending.value
    }

    private func savedManifest(_ index: Int) -> DownloadManifest? {
        guard let ep = episode(index) else { return nil }
        let dir = layout.episodeDir(scopeHash: ep.scopeHash, showDir: ep.showDir, episodeDir: ep.episodeDir)
        return DownloadManifest.load(from: layout.manifestURL(episodeDir: dir))
    }

    private func request(_ index: Int) -> DownloadEpisodeRequest {
        DownloadEpisodeRequest(sourceKey: "src", sourceName: "Source", videoId: "v1", episodeIndex: index,
                               episodeName: "EP\(index + 1)", lineIndex: 0, episodeCount: 3,
                               episodeURL: "https://cdn.example/ep\(index).m3u8")
    }

    private func episode(_ index: Int) -> DownloadEpisode? {
        manager.episode(scopeKey: scope, sourceKey: "src", videoId: "v1", episodeIndex: index)
    }

    private func liveIDs(_ index: Int) -> [DownloadTaskID] {
        guard let key = episode(index)?.episodeKey else { return [] }
        return transport.live.keys.filter { $0.episodeKey == key }.sorted { $0.entryIndex < $1.entryIndex }
    }

    /// Enqueues episodes behind a closed gate and returns once the first prepare is in flight.
    ///
    /// 在闸门关闭时加入剧集, 并在第一次准备进行中时返回.
    private func enqueueGated(_ indexes: [Int]) async throws -> PrepareGate {
        let gate = PrepareGate()
        preparer.gate = gate
        _ = try manager.enqueue(show: info, episodes: indexes.map(request))
        for _ in 0..<1000 where manager.preparingKeys.isEmpty { await Task.yield() }
        XCTAssertFalse(manager.preparingKeys.isEmpty)
        return gate
    }

    private func enqueueAndSettle(_ indexes: [Int] = [0]) async throws {
        _ = try manager.enqueue(show: info, episodes: indexes.map(request))
        await manager.waitForIdle()
    }

    func testEnqueueAgainReplacesACoverThatNeverLoaded() async throws {
        let blocked = URL(string: "https://img.source.example/blocked.jpg")!
        let working = URL(string: "https://img.douban.example/ok.jpg")!
        _ = try manager.enqueue(show: DownloadShowInfo(title: "Show", cover: blocked.absoluteString, type: "tv",
                                                       year: "2026", coverURL: blocked), episodes: [request(0)])
        for _ in 0..<1000 where covers.count < 1 { await Task.yield() }
        let show = try XCTUnwrap(manager.show(scopeKey: scope, showKey: normalizeSyncKey("Show")))
        XCTAssertEqual(show.coverFile, "")

        covers.data = Data([1, 2, 3])
        _ = try manager.enqueue(show: DownloadShowInfo(title: "Show", cover: working.absoluteString, type: "tv",
                                                       year: "2026", coverURL: working), episodes: [request(1)])
        for _ in 0..<1000 where show.coverFile.isEmpty { await Task.yield() }
        XCTAssertEqual(covers.urls, [blocked, working])
        XCTAssertEqual(show.cover, working.absoluteString)
        XCTAssertEqual(show.coverFile, "cover.jpg")

        // A saved poster is kept.
        //
        // 已保存的海报保持不变.
        _ = try manager.enqueue(show: DownloadShowInfo(title: "Show", cover: blocked.absoluteString, type: "tv",
                                                       year: "2026", coverURL: blocked), episodes: [request(2)])
        for _ in 0..<50 { await Task.yield() }
        XCTAssertEqual(covers.count, 2)
        XCTAssertEqual(show.cover, working.absoluteString)
    }

    func testActivateRetriesMissingCoverOnly() async throws {
        let coverURL = URL(string: "https://img.example/c.jpg")
        let withCover = DownloadShowInfo(title: "Show", cover: "https://img.example/c.jpg", type: "tv", year: "2026",
                                         coverURL: coverURL)
        _ = try manager.enqueue(show: withCover, episodes: [request(0)])
        for _ in 0..<1000 where covers.count < 1 { await Task.yield() }
        XCTAssertEqual(covers.count, 1)
        let show = try XCTUnwrap(manager.show(scopeKey: scope, showKey: normalizeSyncKey("Show")))
        XCTAssertEqual(show.coverFile, "")

        // The first fetch failed, so activation retries it once the network works.
        covers.data = Data([1, 2, 3])
        await manager.activate(scopeKey: scope, preparer: preparer)
        for _ in 0..<1000 where show.coverFile.isEmpty { await Task.yield() }
        XCTAssertEqual(show.coverFile, "cover.jpg")
        XCTAssertEqual(covers.count, 2)
        XCTAssertNotNil(manager.coverFileURL(for: show))

        // A present cover is not fetched again.
        await manager.activate(scopeKey: scope, preparer: preparer)
        for _ in 0..<50 { await Task.yield() }
        XCTAssertEqual(covers.count, 2)
    }

    func testEnqueueRequiresSignedInScopeAndSpace() async throws {
        await manager.deactivate()
        XCTAssertThrowsError(try manager.enqueue(show: info, episodes: [request(0)])) {
            XCTAssertEqual($0 as? DownloadEnqueueError, .notSignedIn)
        }
        await manager.activate(scopeKey: scope, preparer: preparer)
        space.value = 10
        XCTAssertThrowsError(try manager.enqueue(show: info, episodes: [request(0)])) {
            XCTAssertEqual($0 as? DownloadEnqueueError, .notEnoughSpace)
        }
    }

    func testEnqueuePreparesAndEnqueuesEveryEntryOnce() async throws {
        XCTAssertEqual(try manager.enqueue(show: info, episodes: [request(0), request(1)]), 2)
        XCTAssertEqual(try manager.enqueue(show: info, episodes: [request(0)]), 0)
        await manager.waitForIdle()
        XCTAssertEqual(preparer.calls.map(\.generation), [1, 1])
        XCTAssertEqual(transport.enqueued.count, 6)
        XCTAssertTrue(transport.enqueued.allSatisfy { !$0.allowsCellular })
        XCTAssertEqual(episode(0)?.state, .downloading)
        XCTAssertEqual(episode(0)?.totalEntries, 3)
        XCTAssertEqual(manager.shows(in: scope).map(\.title), ["Show"])
        XCTAssertEqual(manager.activeEpisodeCount, 2)
    }

    func testCompletingAllEntriesWritesPlaylistAndServesIt() async throws {
        try await enqueueAndSettle()
        for id in liveIDs(0) { await transport.finish(id, layout: layout) }
        await manager.waitForIdle()
        let ep = try XCTUnwrap(episode(0))
        XCTAssertEqual(ep.state, .completed)
        XCTAssertEqual(ep.bytes, 12)
        XCTAssertEqual(ep.durationSec, 6, accuracy: 0.01)
        let dir = layout.episodeDir(scopeHash: ep.scopeHash, showDir: ep.showDir, episodeDir: ep.episodeDir)
        let playlist = try String(contentsOf: layout.playlistURL(episodeDir: dir), encoding: .utf8)
        XCTAssertTrue(playlist.contains("seg-00002.ts"))
        XCTAssertTrue(FileManager.default.fileExists(atPath: dir.appending(path: "seg-00000.ts").path))
        XCTAssertTrue(manager.hasCompletedDownloads)
        let url = try await manager.localPlaybackURL(for: ep)
        XCTAssertTrue(url.absoluteString.hasSuffix("/\(ep.showDir)/\(ep.episodeDir)/index.m3u8"))
        XCTAssertEqual(url.host, "127.0.0.1")
    }

    func testMediaTokenExpiryRefreshesKeepsDoneEntriesAndDropsStaleTasks() async throws {
        try await enqueueAndSettle()
        let first = liveIDs(0)
        await transport.finish(first[0], layout: layout)
        await transport.finish(first[1], layout: layout, status: 401, body: tokenBody, contentType: "application/json")
        await manager.waitForIdle()
        XCTAssertEqual(preparer.calls.map(\.generation), [1, 2])
        let second = liveIDs(0)
        XCTAssertEqual(second.map(\.entryIndex), [1, 2])
        XCTAssertTrue(second.allSatisfy { $0.generation == 2 })
        XCTAssertTrue(second.allSatisfy { transport.live[$0]?.url.absoluteString.contains("mt=g2") == true })
        // The cancelled generation-1 task finishing late is discarded.
        //
        // 已取消的第 1 代任务迟到完成时会被丢弃.
        await transport.finish(first[2], layout: layout)
        XCTAssertEqual(episode(0)?.doneEntries, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: layout.incomingFile(first[2]).path))
    }

    func testRefreshLimitFailsEpisode() async throws {
        try await enqueueAndSettle()
        for _ in 0..<3 {
            let id = try XCTUnwrap(liveIDs(0).first)
            await transport.finish(id, layout: layout, status: 401, body: tokenBody, contentType: "application/json")
            await manager.waitForIdle()
        }
        XCTAssertEqual(episode(0)?.state, .failed)
        XCTAssertEqual(episode(0)?.failure, .sourceRejects)
        XCTAssertEqual(preparer.calls.count, 3)
    }

    func testUpstreamForbiddenFailsWithoutRefresh() async throws {
        try await enqueueAndSettle()
        let id = try XCTUnwrap(liveIDs(0).first)
        await transport.finish(id, layout: layout, status: 403, body: Data("forbidden".utf8), contentType: "text/plain")
        await manager.waitForIdle()
        XCTAssertEqual(episode(0)?.failure, .sourceStatus(403))
        XCTAssertEqual(preparer.calls.count, 1)
        XCTAssertTrue(liveIDs(0).isEmpty)
    }

    func testTransportFailuresRetryWithBackoffThenFail() async throws {
        try await enqueueAndSettle()
        let id = try XCTUnwrap(liveIDs(0).first)
        for delay in [30.0, 120.0, 600.0] {
            await transport.fail(id, code: .timedOut)
            XCTAssertEqual(transport.enqueued.last?.id, id)
            XCTAssertEqual(transport.enqueued.last?.earliestBegin, nowValue.addingTimeInterval(delay))
        }
        await transport.fail(id, code: .timedOut)
        await manager.waitForIdle()
        XCTAssertEqual(episode(0)?.state, .failed)
        XCTAssertEqual(episode(0)?.failure, .network)
    }

    func testCancelledTransportErrorsAreIgnored() async throws {
        try await enqueueAndSettle()
        let id = try XCTUnwrap(liveIDs(0).first)
        await transport.fail(id, code: .cancelled)
        XCTAssertEqual(episode(0)?.state, .downloading)
    }

    func testPauseCancelsAndResumeEnqueuesMissing() async throws {
        try await enqueueAndSettle()
        await transport.finish(liveIDs(0)[0], layout: layout)
        await manager.pause(try XCTUnwrap(episode(0)))
        XCTAssertEqual(episode(0)?.state, .paused)
        XCTAssertEqual(episode(0)?.pauseReason, .user)
        XCTAssertTrue(liveIDs(0).isEmpty)
        manager.resume(try XCTUnwrap(episode(0)))
        await manager.waitForIdle()
        XCTAssertEqual(liveIDs(0).map(\.entryIndex), [1, 2])
        XCTAssertEqual(preparer.calls.count, 2)
    }

    func testMismatchedRefreshRestartsEpisode() async throws {
        try await enqueueAndSettle()
        await transport.finish(liveIDs(0)[0], layout: layout)
        preparer.segments["https://cdn.example/ep0.m3u8"] = 4
        await transport.finish(liveIDs(0)[0], layout: layout, status: 401, body: tokenBody, contentType: "application/json")
        await manager.waitForIdle()
        XCTAssertEqual(episode(0)?.totalEntries, 4)
        XCTAssertEqual(episode(0)?.doneEntries, 0)
        XCTAssertEqual(liveIDs(0).count, 4)
    }

    func testResumeKeepsProgressWhenTheSourceMovesItsAds() async throws {
        // The source inserts the same ad at a random place on every fetch.
        //
        // 源站每次获取都把同一段广告插入到随机位置.
        func playlist(adAfter: Int) -> String {
            var text = "#EXTM3U\n#EXT-X-TARGETDURATION:5\n"
            for content in 0..<3 {
                text += "#EXTINF:2,\nhttps://kmtv.example/api/v1/proxy/segment?url=c\(content)&mt=g{g}\n"
                if content == adAfter {
                    text += "#EXT-X-DISCONTINUITY\n#EXTINF:5,\nhttps://kmtv.example/api/v1/proxy/segment?url=ad&mt=g{g}\n"
                    text += "#EXT-X-DISCONTINUITY\n"
                }
            }
            return text + "#EXT-X-ENDLIST\n"
        }
        let url = "https://cdn.example/ep0.m3u8"
        preparer.playlists[url] = playlist(adAfter: 0)
        try await enqueueAndSettle()
        await transport.finish(liveIDs(0)[0], layout: layout)
        await transport.finish(liveIDs(0)[0], layout: layout)
        await manager.pause(try XCTUnwrap(episode(0)))
        preparer.playlists[url] = playlist(adAfter: 1)
        manager.resume(try XCTUnwrap(episode(0)))
        await manager.waitForIdle()
        XCTAssertEqual(episode(0)?.doneEntries, 2)
        XCTAssertEqual(liveIDs(0).map(\.entryIndex), [2, 3])
        XCTAssertEqual(liveIDs(0).compactMap { transport.live[$0]?.url.absoluteString },
                       ["https://kmtv.example/api/v1/proxy/segment?url=c1&mt=g2",
                        "https://kmtv.example/api/v1/proxy/segment?url=c2&mt=g2"])
    }

    func testResumeRestartsWhenAProxiedFileChangesBehindEqualDurations() async throws {
        // The ad file gets a new name on every fetch; every segment lasts 2 s, so index and duration
        // still line up, but the proxied identities show the file changed.
        //
        // 广告文件每次获取都换名; 每个分片都是 2 秒, 序号与时长仍然对得上, 但代理身份表明文件已变.
        func playlist(ad: String) -> String {
            var text = "#EXTM3U\n#EXT-X-TARGETDURATION:2\n"
            for name in ["c0", ad, "c1"] {
                text += "#EXTINF:2,\nhttps://kmtv.example/api/v1/proxy/segment?url=\(name)&mt=g{g}\n"
            }
            return text + "#EXT-X-ENDLIST\n"
        }
        let url = "https://cdn.example/ep0.m3u8"
        preparer.playlists[url] = playlist(ad: "adX")
        try await enqueueAndSettle()
        await transport.finish(liveIDs(0)[0], layout: layout)
        await transport.finish(liveIDs(0)[0], layout: layout)
        await manager.pause(try XCTUnwrap(episode(0)))
        preparer.playlists[url] = playlist(ad: "adY")
        manager.resume(try XCTUnwrap(episode(0)))
        await manager.waitForIdle()
        XCTAssertEqual(episode(0)?.doneEntries, 0)
        XCTAssertEqual(liveIDs(0).count, 3)
    }

    func testBackgroundDefersPreparationUntilInactive() async throws {
        await manager.handleScenePhase(.background)
        try await enqueueAndSettle()
        XCTAssertTrue(preparer.calls.isEmpty)
        await manager.handleScenePhase(.inactive)
        await manager.waitForIdle()
        XCTAssertEqual(preparer.calls.count, 1)
        XCTAssertEqual(liveIDs(0).count, 3)
    }

    func testSignedOutPreparationPausesScopeAndActivateResumes() async throws {
        preparer.errors["https://cdn.example/ep0.m3u8"] = .signedOut
        try await enqueueAndSettle()
        XCTAssertEqual(episode(0)?.state, .paused)
        XCTAssertEqual(episode(0)?.pauseReason, .signedOut)
        preparer.errors = [:]
        await manager.activate(scopeKey: scope, preparer: preparer)
        await manager.waitForIdle()
        XCTAssertEqual(episode(0)?.state, .downloading)
    }

    func testRelaunchReconcilesStaleAndMissingTasks() async throws {
        try await enqueueAndSettle()
        let ids = liveIDs(0)
        let stale = DownloadTaskID(scopeHash: ids[0].scopeHash, showDir: ids[0].showDir, episodeDir: ids[0].episodeDir,
                                   generation: 9, entryIndex: 0)
        transport.live[stale] = DownloadTaskRequest(id: stale, url: URL(string: "https://x.example")!,
                                                    earliestBegin: nil, priority: 0.5, allowsCellular: false)
        transport.live[ids[2]] = nil
        await manager.persistAll()
        let relaunched = makeManager()
        await relaunched.activate(scopeKey: scope, preparer: preparer)
        await relaunched.waitForIdle()
        XCTAssertTrue(transport.cancelled.contains(stale))
        XCTAssertEqual(Set(transport.live.keys.filter { $0.episodeKey == ids[0].episodeKey }.map(\.entryIndex)), [0, 1, 2])
        XCTAssertEqual(preparer.calls.count, 1)
    }

    func testStorageFullPausesScope() async throws {
        try await enqueueAndSettle()
        await transport.onEvent?(.storageFull(liveIDs(0)[0]))
        XCTAssertEqual(episode(0)?.state, .paused)
        XCTAssertEqual(episode(0)?.pauseReason, .noSpace)
        XCTAssertTrue(liveIDs(0).isEmpty)
    }

    func testCellularSettingReenqueuesWithNewPolicy() async throws {
        try await enqueueAndSettle()
        await manager.setAllowsCellular(true)
        await manager.waitForIdle()
        XCTAssertTrue(manager.allowsCellular)
        XCTAssertEqual(transport.cancelled.count, 3)
        XCTAssertTrue(transport.enqueued.suffix(3).allSatisfy(\.allowsCellular))
        XCTAssertTrue(defaults.bool(forKey: DownloadManager.cellularKey))
    }

    // MARK: - Library

    /// Inserts a show row and one episode row per index directly, as another scope's downloads
    /// would be on disk; completed and paused rows never start transfers.
    @discardableResult
    private func insertLibraryRows(scope: String, title: String, indexes: [Int], state: DownloadState,
                                   createdAt: Date) -> [DownloadEpisode] {
        let context = container.mainContext
        let show = DownloadShow(scopeKey: scope, title: title, cover: "", type: "", year: "", createdAt: createdAt)
        context.insert(show)
        let rows = indexes.map { index in
            let ep = DownloadEpisode(show: show, sourceKey: "src", sourceName: "Source", videoId: "v-\(title)",
                                     episodeIndex: index, episodeName: "E\(index + 1)", lineIndex: 0,
                                     episodeCount: 10, episodeURL: "u", queueOrder: index, createdAt: createdAt)
            ep.state = state
            context.insert(ep)
            return ep
        }
        try? context.save()
        return rows
    }

    func testLibraryMergesShowsAndEpisodesAcrossScopes() async throws {
        let other = syncScopeKey(serverURL: "https://other.example", userID: 2)
        insertLibraryRows(scope: other, title: "Show", indexes: [0, 1], state: .completed,
                          createdAt: Date(timeIntervalSince1970: 10))
        insertLibraryRows(scope: scope, title: "Show", indexes: [1, 2], state: .paused,
                          createdAt: Date(timeIntervalSince1970: 20))
        insertLibraryRows(scope: other, title: "Other Show", indexes: [0], state: .completed,
                          createdAt: Date(timeIntervalSince1970: 5))

        XCTAssertEqual(manager.libraryShows().map(\.title), ["Show", "Other Show"])
        XCTAssertEqual(manager.libraryShow(showKey: normalizeSyncKey("Show"))?.scopeKey, scope,
                       "the active scope's row stands for the show")

        let episodes = manager.libraryEpisodes(showKey: normalizeSyncKey("Show"))
        XCTAssertEqual(episodes.map(\.episodeIndex), [0, 1, 2])
        XCTAssertEqual(episodes.map(\.scopeKey), [other, other, scope])
        guard episodes.count == 3 else { return }
        XCTAssertEqual(episodes[1].scopeKey, other, "a completed copy wins over the active scope's paused one")
        XCTAssertEqual(episodes[1].state, .completed)
        XCTAssertTrue(manager.canManage(episodes[2]))
        XCTAssertFalse(manager.canManage(episodes[0]), "another account's episode cannot be managed here")
        XCTAssertTrue(manager.hasCompletedDownloads)
    }

    func testLibraryDeletesEveryCopy() async throws {
        let other = syncScopeKey(serverURL: "https://other.example", userID: 2)
        insertLibraryRows(scope: other, title: "Show", indexes: [0, 1], state: .completed,
                          createdAt: Date(timeIntervalSince1970: 10))
        insertLibraryRows(scope: scope, title: "Show", indexes: [0], state: .completed,
                          createdAt: Date(timeIntervalSince1970: 20))
        let showKey = normalizeSyncKey("Show")

        await manager.deleteFromLibrary(manager.libraryEpisodes(showKey: showKey)[0])
        XCTAssertEqual(manager.libraryEpisodes(showKey: showKey).map(\.episodeIndex), [1],
                       "both copies of the episode are gone")

        await manager.deleteShowFromLibrary(showKey: showKey)
        XCTAssertTrue(manager.libraryShows().isEmpty)

        insertLibraryRows(scope: other, title: "Again", indexes: [0], state: .completed, createdAt: .now)
        await manager.deleteAllDownloads()
        XCTAssertTrue(manager.libraryEpisodes().isEmpty)
        XCTAssertFalse(manager.hasCompletedDownloads)
    }

    func testLocalPlaybackUsesAnotherAccountsCopy() async throws {
        let other = syncScopeKey(serverURL: "https://other.example", userID: 2)
        let rows = insertLibraryRows(scope: other, title: "Show", indexes: [0], state: .completed, createdAt: .now)
        let dir = layout.scopeDir(rows[0].scopeHash).appending(path: "\(rows[0].showDir)/\(rows[0].episodeDir)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try Data("#EXTM3U\n".utf8).write(to: dir.appending(path: "index.m3u8"))

        let showKey = normalizeSyncKey("Show")
        let url = await manager.localPlaybackURL(showKey: showKey, sourceKey: "src", videoId: "v-Show", episodeIndex: 0)
        XCTAssertNotNil(url, "downloads are local first whoever is signed in")
        XCTAssertTrue(url?.absoluteString.hasSuffix("/\(rows[0].scopeHash)/\(rows[0].showDir)/\(rows[0].episodeDir)/index.m3u8") == true,
                      "one server rooted at the downloads directory serves every scope")
        let missing = await manager.localPlaybackURL(showKey: showKey, sourceKey: "src", videoId: "v-Show", episodeIndex: 1)
        XCTAssertNil(missing)
        let otherShow = await manager.localPlaybackURL(showKey: normalizeSyncKey("Another"), sourceKey: "src",
                                                       videoId: "v-Show", episodeIndex: 0)
        XCTAssertNil(otherShow, "a matching source key on another show is a different video")
    }

    func testEnqueueSkipsEpisodesAnotherAccountDownloaded() async throws {
        let other = syncScopeKey(serverURL: "https://other.example", userID: 2)
        let rows = insertLibraryRows(scope: other, title: "Show", indexes: [0], state: .completed, createdAt: .now)
        let request = DownloadEpisodeRequest(sourceKey: "src", sourceName: "Source", videoId: rows[0].videoId,
                                             episodeIndex: 0, episodeName: "E1", lineIndex: 0, episodeCount: 10,
                                             episodeURL: "u")
        let added = try manager.enqueue(show: DownloadShowInfo(title: "Show", cover: "", type: "", year: "", coverURL: nil),
                                        episodes: [request])
        XCTAssertEqual(added, 0)
        XCTAssertTrue(manager.episodes(in: scope).isEmpty)
    }

    func testActivationDropsCopiesAnotherAccountFinished() async throws {
        let other = syncScopeKey(serverURL: "https://other.example", userID: 2)
        insertLibraryRows(scope: other, title: "Show", indexes: [0], state: .completed, createdAt: .now)
        let mine = insertLibraryRows(scope: scope, title: "Show", indexes: [0, 1], state: .paused, createdAt: .now)
        for ep in mine { ep.pauseReason = .signedOut }
        await manager.deactivate()
        await manager.activate(scopeKey: scope, preparer: preparer)
        XCTAssertEqual(manager.episodes(in: scope).map(\.episodeIndex), [1],
                       "the finished elsewhere copy is gone; the other one is still queued")
    }

    func testDeleteScopeRemovesRowsFilesAndBytes() async throws {
        try await enqueueAndSettle()
        for id in liveIDs(0) { await transport.finish(id, layout: layout) }
        XCTAssertEqual(manager.usedBytes, 12)
        await manager.deleteScope(scope)
        XCTAssertTrue(manager.shows(in: scope).isEmpty)
        XCTAssertNil(episode(0))
        XCTAssertEqual(manager.usedBytes, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: layout.scopeDir(DownloadPaths.scopeHash(scope)).path))
    }

    func testEnqueueRetriesFailedAndResumesPausedEpisodes() async throws {
        try await enqueueAndSettle([0, 1])
        await transport.finish(liveIDs(0)[0], layout: layout, status: 404, body: Data("missing".utf8), contentType: "text/plain")
        await manager.pause(try XCTUnwrap(episode(1)))
        await manager.waitForIdle()
        XCTAssertEqual(episode(0)?.state, .failed)
        XCTAssertEqual(try manager.enqueue(show: info, episodes: [request(0), request(1)]), 2)
        await manager.waitForIdle()
        XCTAssertEqual(episode(0)?.state, .downloading)
        XCTAssertEqual(episode(1)?.state, .downloading)
    }

    func testFilesIntactDetectsMissingFiles() async throws {
        try await enqueueAndSettle()
        for id in liveIDs(0) { await transport.finish(id, layout: layout) }
        await manager.waitForIdle()
        let ep = try XCTUnwrap(episode(0))
        XCTAssertEqual(ep.state, .completed)
        XCTAssertTrue(manager.filesIntact(ep))
        let dir = layout.episodeDir(scopeHash: ep.scopeHash, showDir: ep.showDir, episodeDir: ep.episodeDir)
        let manifest = try XCTUnwrap(DownloadManifest.load(from: layout.manifestURL(episodeDir: dir)))
        try FileManager.default.removeItem(at: dir.appending(path: try XCTUnwrap(manifest.entries.last).fileName))
        XCTAssertFalse(manager.filesIntact(ep))
    }

    func testBackgroundDuringPrepareDefersTasksUntilForeground() async throws {
        let gate = try await enqueueGated([0, 1])
        await manager.handleScenePhase(.background)
        gate.open()
        await manager.waitForIdle()
        XCTAssertTrue(transport.enqueued.isEmpty)
        XCTAssertEqual(preparer.calls.count, 1)
        let ep = try XCTUnwrap(episode(0))
        XCTAssertEqual(ep.state, .downloading)
        XCTAssertEqual(ep.totalEntries, 3)
        let dir = layout.episodeDir(scopeHash: ep.scopeHash, showDir: ep.showDir, episodeDir: ep.episodeDir)
        // Manifests are written in the background; wait for the writer before reading the file.
        //
        // manifest 在后台写入; 读取文件之前先等待写入器.
        await manager.persistAll()
        XCTAssertNotNil(DownloadManifest.load(from: layout.manifestURL(episodeDir: dir)))
        XCTAssertEqual(episode(1)?.state, .queued)
        await manager.handleScenePhase(.inactive)
        await manager.waitForIdle()
        XCTAssertEqual(liveIDs(0).map(\.entryIndex), [0, 1, 2])
        XCTAssertEqual(liveIDs(1).count, 3)
        XCTAssertEqual(preparer.calls.map(\.generation), [1, 1])
    }

    func testDeleteDuringPrepareEnqueuesNothing() async throws {
        let gate = try await enqueueGated([0, 1])
        let show = try XCTUnwrap(manager.shows(in: scope).first)
        let showDir = layout.showDir(scopeHash: show.scopeHash, showDir: show.showDir)
        await manager.deleteShow(show)
        gate.open()
        await manager.waitForIdle()
        XCTAssertNil(episode(0))
        XCTAssertNil(episode(1))
        XCTAssertTrue(manager.shows(in: scope).isEmpty)
        XCTAssertTrue(transport.enqueued.isEmpty)
        XCTAssertEqual(preparer.calls.count, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: showDir.path))
    }

    func testFailureOfDoneEntryIsIgnored() async throws {
        try await enqueueAndSettle()
        let id = liveIDs(0)[0]
        await transport.finish(id, layout: layout)
        // A redundant duplicate of a finished entry fails later.
        //
        // 已完成条目的一个多余副本稍后失败.
        await transport.fail(id, code: .timedOut)
        XCTAssertEqual(transport.enqueued.count, 3)
        XCTAssertEqual(episode(0)?.state, .downloading)
        await tick()
        XCTAssertEqual(episode(0)?.doneEntries, 1)
    }

    func testBackgroundWakeStopsAtDeadlineAndPersists() async throws {
        manager = makeManager(wakeBudget: .milliseconds(200))
        await manager.activate(scopeKey: scope, preparer: preparer)
        try await enqueueAndSettle([0])
        await manager.handleScenePhase(.background)
        _ = try manager.enqueue(show: info, episodes: (1...5).map(request))
        // An entry finished in the background is cached but not yet written to disk.
        //
        // 在后台完成的条目已缓存, 但尚未写入磁盘.
        await transport.finish(liveIDs(0)[0], layout: layout)
        XCTAssertEqual(savedManifest(0)?.doneCount, 0)
        let gate = PrepareGate()
        preparer.gate = gate

        let start = ContinuousClock.now
        await manager.handleBackgroundWake()
        let elapsed = ContinuousClock.now - start
        XCTAssertLessThan(elapsed, .seconds(2))
        XCTAssertEqual(savedManifest(0)?.doneCount, 1)
        XCTAssertEqual(preparer.calls.count, 2)
        XCTAssertEqual((2...5).compactMap { episode($0)?.state }, Array(repeating: .queued, count: 4))

        // The prepare that outlived the wake finishes without starting more, and the next
        // foreground pump picks up the rest.
        //
        // 超出唤醒时长的准备完成后不会再开始新的准备, 剩余剧集由下一次前台推进处理.
        gate.open()
        await manager.waitForIdle()
        XCTAssertEqual(preparer.calls.count, 2)
        XCTAssertEqual(episode(1)?.state, .downloading)
        await manager.handleScenePhase(.inactive)
        await manager.waitForIdle()
        XCTAssertEqual(preparer.calls.count, 6)
        XCTAssertTrue((1...5).allSatisfy { episode($0)?.state == .downloading })
    }

    func testPumpCompletesDownloadingEpisodeWithCompleteManifest() async throws {
        try await enqueueAndSettle()
        for id in liveIDs(0) { await transport.finish(id, layout: layout) }
        await manager.waitForIdle()
        let ep = try XCTUnwrap(episode(0))
        XCTAssertEqual(ep.state, .completed)
        // The app stopped after `complete` wrote the manifest but before the row was saved.
        //
        // App 在 `complete` 写入 manifest 之后, 保存数据行之前停止.
        let dir = layout.episodeDir(scopeHash: ep.scopeHash, showDir: ep.showDir, episodeDir: ep.episodeDir)
        try FileManager.default.removeItem(at: layout.playlistURL(episodeDir: dir))
        ep.state = .downloading
        ep.completedAt = nil
        try container.mainContext.save()

        let relaunched = makeManager()
        await relaunched.activate(scopeKey: scope, preparer: preparer)
        await relaunched.waitForIdle()
        XCTAssertEqual(episode(0)?.state, .completed)
        XCTAssertNotNil(episode(0)?.completedAt)
        XCTAssertTrue(FileManager.default.fileExists(atPath: layout.playlistURL(episodeDir: dir).path))
        XCTAssertEqual(preparer.calls.count, 1)
    }

    func testEncryptedSegmentsStartingWithBraceComplete() async throws {
        preparer.encrypted = true
        try await enqueueAndSettle()
        let ids = liveIDs(0)
        XCTAssertEqual(ids.count, 4)
        // Ciphertext can start with `{`; only plain segments are sniffed for JSON error bodies.
        //
        // 密文可能以 `{` 开头; 只有未加密的分片才会被检查是否为 JSON 错误响应体.
        let cipher = Data([UInt8(ascii: "{")] + Array(repeating: 0x5A, count: 31))
        for id in ids {
            let body = id.entryIndex == 0 ? Data(repeating: 7, count: 16) : cipher
            await transport.finish(id, layout: layout, body: body)
        }
        await manager.waitForIdle()
        XCTAssertEqual(episode(0)?.state, .completed)
        XCTAssertEqual(transport.enqueued.count, 4)
    }

    func testAcceptedEntriesDoNotChangeStructure() async throws {
        preparer.segments["https://cdn.example/ep0.m3u8"] = 20
        try await enqueueAndSettle()
        let structure = manager.changeCount
        for id in liveIDs(0).prefix(10) { await transport.finish(id, layout: layout) }
        // Rows see the entries on the next progress tick; views keyed on structure do not re-render
        // per entry.
        //
        // 数据行在下一次进度通知时反映这些条目; 依赖结构变化的视图不会因每个条目而重新渲染.
        await tick()
        XCTAssertEqual(episode(0)?.doneEntries, 10)
        XCTAssertEqual(manager.changeCount, structure)
    }

    func testProgressNotificationsCoalesceAndStopWhenIdle() async throws {
        preparer.segments["https://cdn.example/ep0.m3u8"] = 20
        try await enqueueAndSettle()
        XCTAssertNil(manager.progressTask)
        let start = manager.progressTick
        let used = manager.usedBytes
        for id in liveIDs(0).prefix(10) { await transport.finish(id, layout: layout) }
        XCTAssertEqual(manager.progressTick, start)
        XCTAssertNotNil(manager.progressTask)
        await tick()
        // Ten entries within one interval produce a single notification.
        //
        // 一个间隔内完成的十个条目只产生一次通知.
        XCTAssertEqual(manager.progressTick, start + 1)
        XCTAssertEqual(manager.usedBytes, used + 40)
        // No timer keeps running once entries stop finishing.
        //
        // 条目不再完成后, 不会有计时器继续运行.
        XCTAssertNil(manager.progressTask)
        await transport.finish(liveIDs(0)[0], layout: layout)
        await tick()
        XCTAssertEqual(manager.progressTick, start + 2)
    }

    func testActiveEpisodeCountChangesOnlyOnStateTransitions() async throws {
        try await enqueueAndSettle([0, 1])
        XCTAssertEqual(manager.activeEpisodeCount, 2)
        let changed = ObservationFlag()
        withObservationTracking { _ = manager.activeEpisodeCount } onChange: { changed.set() }
        await transport.finish(liveIDs(0)[0], layout: layout)
        await transport.finish(liveIDs(0)[0], layout: layout)
        // Let the progress tick fire, so the assertion covers it too.
        //
        // 让进度通知先发出, 断言因此也覆盖它.
        await tick()
        XCTAssertFalse(changed.value)
        await manager.pause(try XCTUnwrap(episode(1)))
        XCTAssertTrue(changed.value)
        XCTAssertEqual(manager.activeEpisodeCount, 1)
        await transport.finish(liveIDs(0)[0], layout: layout)
        XCTAssertEqual(episode(0)?.state, .completed)
        XCTAssertEqual(manager.activeEpisodeCount, 0)
        manager.resume(try XCTUnwrap(episode(1)))
        XCTAssertEqual(manager.activeEpisodeCount, 1)
    }

    func testEntriesBeyondTheOutstandingLimitAreEnqueuedAsRoomOpens() async throws {
        manager = makeManager(outstandingLimit: 3)
        await manager.activate(scopeKey: scope, preparer: preparer)
        preparer.segments["https://cdn.example/ep0.m3u8"] = 5
        try await enqueueAndSettle()
        XCTAssertEqual(transport.enqueued.count, 3)
        // The app stays in the foreground: no scene change pumps, only finished entries make room.
        //
        // App 一直在前台: 没有场景变化来推进队列, 只有完成的条目腾出空间.
        for _ in 0..<5 {
            let id = try XCTUnwrap(liveIDs(0).first)
            await transport.finish(id, layout: layout)
            await manager.waitForIdle()
            XCTAssertLessThanOrEqual(transport.live.count, 3)
        }
        XCTAssertEqual(transport.enqueued.count, 5)
        XCTAssertEqual(Set(transport.enqueued.map(\.id)).count, 5)
        XCTAssertEqual(episode(0)?.state, .completed)
    }

    func testReconcileKeepsTasksEnqueuedWhileItAwaitsTheTransport() async throws {
        // Prepare finishes in the background, so its tasks wait for the foreground.
        //
        // 准备在后台完成, 其任务要等回到前台才提交.
        let gate = try await enqueueGated([0])
        await manager.handleScenePhase(.background)
        gate.open()
        await manager.waitForIdle()
        XCTAssertTrue(transport.enqueued.isEmpty)
        // Returning, `.inactive` reconciles from a snapshot taken before `.active` pumps.
        //
        // 返回前台时, `.inactive` 的对账快照早于 `.active` 的队列推进.
        let reconcileGate = PrepareGate()
        transport.outstandingGate = reconcileGate
        let inactive = Task { await manager.handleScenePhase(.inactive) }
        for _ in 0..<1000 where !transport.outstandingEntered { await Task.yield() }
        XCTAssertTrue(transport.outstandingEntered)
        await manager.handleScenePhase(.active)
        await manager.waitForIdle()
        XCTAssertEqual(transport.enqueued.count, 3)
        reconcileGate.open()
        await inactive.value
        // Any later pump must not enqueue the same entries again.
        //
        // 之后的任何队列推进都不能再次提交相同的条目.
        await manager.handleScenePhase(.active)
        await manager.waitForIdle()
        XCTAssertEqual(transport.enqueued.count, 3)
    }

    func testCellularToggleKeepsTasksRecreatedDuringTheCancel() async throws {
        try await enqueueAndSettle()
        XCTAssertEqual(transport.live.count, 3)
        let gate = PrepareGate()
        transport.cancelGate = gate
        let toggle = Task { await manager.setAllowsCellular(true) }
        for _ in 0..<1000 where !transport.cancelEntered { await Task.yield() }
        XCTAssertTrue(transport.cancelEntered)
        // A pump during the cancel must not re-create the IDs being cancelled.
        //
        // 取消期间的队列推进不得重建正在取消的 ID.
        await manager.handleScenePhase(.active)
        await manager.waitForIdle()
        gate.open()
        await toggle.value
        await manager.waitForIdle()
        XCTAssertEqual(transport.live.count, 3)
        XCTAssertTrue(transport.live.values.allSatisfy(\.allowsCellular))
        XCTAssertEqual(transport.enqueued.count, 6)
    }

    func testAcceptedEntriesReachTheRowOnTheProgressTick() async throws {
        preparer.segments["https://cdn.example/ep0.m3u8"] = 40
        try await enqueueAndSettle()
        let ep = try XCTUnwrap(episode(0))
        var writes = 0
        func counting(_ step: () async -> Void) async {
            let changed = ObservationFlag()
            withObservationTracking {
                _ = ep.doneEntries
                _ = ep.bytes
            } onChange: { changed.set() }
            await step()
            if changed.value { writes += 1 }
        }
        for id in liveIDs(0).prefix(30) {
            await counting { await transport.finish(id, layout: layout) }
        }
        await counting { await tick() }
        // Thirty entries: one write when the manifest is saved after 20, one on the tick.
        //
        // 三十个条目: 第 20 个后保存 manifest 时写一次, 进度通知时再写一次.
        XCTAssertLessThanOrEqual(writes, 2)
        XCTAssertEqual(ep.doneEntries, 30)
        XCTAssertEqual(ep.bytes, 120)
        // A pause writes the exact count to the row and the manifest at once.
        //
        // 暂停会立即把准确的数量写入数据行与 manifest.
        await transport.finish(liveIDs(0)[0], layout: layout)
        await manager.pause(ep)
        XCTAssertEqual(ep.doneEntries, 31)
        XCTAssertEqual(ep.bytes, 124)
        XCTAssertEqual(savedManifest(0)?.doneCount, 31)
    }

    func testPersistAllWritesPendingProgress() async throws {
        try await enqueueAndSettle()
        await transport.finish(liveIDs(0)[0], layout: layout)
        XCTAssertEqual(episode(0)?.doneEntries, 0)
        await manager.persistAll()
        XCTAssertEqual(episode(0)?.doneEntries, 1)
        XCTAssertEqual(episode(0)?.bytes, 4)
        XCTAssertEqual(savedManifest(0)?.doneCount, 1)
    }

    func testStorageTotalsFollowRowsWithoutReadingFreeSpacePerTick() async throws {
        try await enqueueAndSettle([0, 1])
        let reads = space.reads
        for id in liveIDs(0) { await transport.finish(id, layout: layout) }
        await transport.finish(liveIDs(1)[0], layout: layout)
        await tick()
        await manager.pause(try XCTUnwrap(episode(1)))
        // Neither progress ticks nor structural changes touch the volume.
        //
        // 进度通知与结构变化都不会访问磁盘卷.
        XCTAssertEqual(space.reads, reads)
        XCTAssertEqual(manager.usedBytes, manager.libraryEpisodes().reduce(0) { $0 + $1.bytes })
        XCTAssertEqual(manager.usedBytes, 16)
        manager.markDamaged(try XCTUnwrap(episode(0)))
        XCTAssertEqual(manager.usedBytes, 4)
        await manager.delete(try XCTUnwrap(episode(1)))
        XCTAssertEqual(manager.usedBytes, 0)
        // The total covers every scope's downloads, so a scope change leaves it alone.
        //
        // 总量涵盖所有作用域的下载, 因此作用域切换不会改变它.
        try await enqueueAndSettle([2])
        for id in liveIDs(2) { await transport.finish(id, layout: layout) }
        let other = syncScopeKey(serverURL: "https://kmtv.example", userID: 2)
        await manager.activate(scopeKey: other, preparer: preparer)
        XCTAssertEqual(manager.usedBytes, 12)
        // Free space is read off the main actor, on demand.
        //
        // 剩余空间按需在主 actor 之外读取.
        space.value = 7_000_000_000
        await manager.refreshFreeSpace()
        XCTAssertEqual(manager.freeBytes, 7_000_000_000)
    }

    func testPrepareBumpsStructureOnceForTheStateChange() async throws {
        let gate = PrepareGate()
        preparer.gate = gate
        _ = try manager.enqueue(show: info, episodes: [request(0)])
        let enqueued = manager.changeCount
        for _ in 0..<1000 where manager.preparingKeys.isEmpty { await Task.yield() }
        let key = try XCTUnwrap(episode(0)?.episodeKey)
        // Starting the prepare bumps nothing; the picker sees it through the revision's keys.
        //
        // 开始准备不会递增结构计数; 选集面板通过版本中的键看到它.
        XCTAssertEqual(manager.changeCount, enqueued)
        XCTAssertEqual(manager.displayRevision.preparing, [key])
        gate.open()
        await manager.waitForIdle()
        XCTAssertEqual(manager.changeCount, enqueued + 1)
        XCTAssertEqual(manager.displayRevision.preparing, [])
        XCTAssertEqual(episode(0)?.state, .downloading)
    }

    func testCanDownloadFollowsThePreparer() async throws {
        manager.openOffline(scopeKey: scope)
        XCTAssertFalse(manager.canDownload)
        let changed = ObservationFlag()
        withObservationTracking { _ = manager.canDownload } onChange: { changed.set() }
        await manager.activate(scopeKey: scope, preparer: preparer)
        XCTAssertTrue(changed.value)
        XCTAssertTrue(manager.canDownload)
    }

    func testRefillWaitsForABatchOfFreeSlots() async throws {
        manager = makeManager(outstandingLimit: 20)
        await manager.activate(scopeKey: scope, preparer: preparer)
        preparer.segments["https://cdn.example/ep0.m3u8"] = 25
        try await enqueueAndSettle()
        XCTAssertEqual(transport.enqueued.count, 20)
        // A limit of 20 refills in batches of 2: one free slot does not pump, two do.
        //
        // 上限为 20 时按 2 个一批补充: 空出一个位置不会推进队列, 空出两个才会.
        await transport.finish(liveIDs(0)[0], layout: layout)
        await manager.waitForIdle()
        XCTAssertEqual(transport.enqueued.count, 20)
        await transport.finish(liveIDs(0)[0], layout: layout)
        await manager.waitForIdle()
        XCTAssertEqual(transport.enqueued.count, 22)
        XCTAssertEqual(transport.live.count, 20)
    }

    func testReconcileDoesNotAdoptTasksCancelledDuringItsAwait() async throws {
        try await enqueueAndSettle()
        // In the background the cellular toggle's pump does nothing, so nothing re-creates the
        // cancelled tasks before the reconcile resumes with its older snapshot.
        //
        // 在后台时蜂窝数据切换后的队列推进不会执行, 因此在对账带着较旧的快照恢复之前, 没有任何操作会
        // 重建被取消的任务.
        await manager.handleScenePhase(.background)
        let gate = PrepareGate()
        transport.outstandingGate = gate
        let reconcile = Task { await manager.reconcile() }
        for _ in 0..<1000 where !transport.outstandingEntered { await Task.yield() }
        XCTAssertTrue(transport.outstandingEntered)
        await manager.setAllowsCellular(true)
        XCTAssertTrue(transport.live.isEmpty)
        gate.open()
        await reconcile.value
        XCTAssertTrue(manager.inFlight.isEmpty)
        await manager.handleScenePhase(.active)
        await manager.waitForIdle()
        XCTAssertEqual(transport.live.count, 3)
        XCTAssertTrue(transport.live.values.allSatisfy(\.allowsCellular))
    }

    func testReconcileKeepsTasksRecreatedAfterACancelDuringItsAwait() async throws {
        try await enqueueAndSettle()
        let gate = PrepareGate()
        transport.outstandingGate = gate
        let reconcile = Task { await manager.reconcile() }
        for _ in 0..<1000 where !transport.outstandingEntered { await Task.yield() }
        XCTAssertTrue(transport.outstandingEntered)
        // In the foreground the toggle's pump re-creates the same IDs before the reconcile resumes.
        //
        // 在前台, 切换后的队列推进会在对账恢复之前重建相同的 ID.
        await manager.setAllowsCellular(true)
        await manager.waitForIdle()
        XCTAssertEqual(transport.live.count, 3)
        XCTAssertEqual(transport.enqueued.count, 6)
        gate.open()
        await reconcile.value
        XCTAssertEqual(manager.inFlight.count, 3)
        await manager.handleScenePhase(.active)
        await manager.waitForIdle()
        XCTAssertEqual(transport.enqueued.count, 6)
    }

    func testPersistDuringADeleteDoesNotBringTheFilesBack() async throws {
        preparer.segments["https://cdn.example/ep0.m3u8"] = 25
        try await enqueueAndSettle()
        let ep = try XCTUnwrap(episode(0))
        let dir = layout.episodeDir(scopeHash: ep.scopeHash, showDir: ep.showDir, episodeDir: ep.episodeDir)
        // The 20th entry's save is held, which keeps the delete's discard waiting; a persist during
        // that wait must not queue a write that lands after the directory is removed.
        //
        // 第 20 个条目的保存被阻塞, 删除的丢弃操作因此一直等待; 等待期间的持久化不能排入一次在目录删除后
        // 才执行的写入.
        writes.close()
        for id in liveIDs(0).prefix(20) { await transport.finish(id, layout: layout) }
        for _ in 0..<1000 where writes.held == 0 { await Task.yield() }
        XCTAssertEqual(writes.held, 1)
        let delete = Task { await manager.delete(ep) }
        for _ in 0..<1000 where transport.cancelled.isEmpty { await Task.yield() }
        for _ in 0..<50 { await Task.yield() }
        let persist = Task { await manager.persistAll() }
        for _ in 0..<50 { await Task.yield() }
        // Let the held write and the discard finish; a write queued by the persist runs only after
        // the files are gone.
        //
        // 让被阻塞的写入与丢弃操作完成; 持久化排入的写入只会在文件删除之后执行.
        writes.release()
        await delete.value
        writes.open()
        await persist.value
        await manager.persistAll()
        XCTAssertFalse(FileManager.default.fileExists(atPath: dir.path))
    }

    func testSaveEveryFlushStillMarksTheShowOnTheTick() async throws {
        preparer.segments["https://cdn.example/ep0.m3u8"] = 25
        try await enqueueAndSettle()
        let ep = try XCTUnwrap(episode(0))
        // Exactly 20 entries: the save flushes the row before the tick fires.
        //
        // 正好 20 个条目: 保存时会在进度通知发出之前写入数据行.
        for id in liveIDs(0).prefix(20) { await transport.finish(id, layout: layout) }
        await tick()
        XCTAssertEqual(manager.showProgressTicks[ep.showDir], manager.progressTick)
    }

    func testCompletionThatRacesAPauseStillCompletes() async throws {
        try await enqueueAndSettle()
        let ids = liveIDs(0)
        await transport.finish(ids[0], layout: layout)
        await transport.finish(ids[1], layout: layout)
        // The last entry's completion waits on the held writer while the user pauses.
        //
        // 最后一个条目的完成流程在被阻塞的写入器上等待时, 用户暂停了该集.
        writes.close()
        let finishing = Task { await transport.finish(ids[2], layout: layout) }
        for _ in 0..<1000 where writes.held == 0 { await Task.yield() }
        let pausing = Task { await manager.pause(try XCTUnwrap(episode(0))) }
        for _ in 0..<1000 where episode(0)?.state != .paused { await Task.yield() }
        writes.open()
        await finishing.value
        _ = await pausing.result
        XCTAssertEqual(episode(0)?.state, .completed)
        XCTAssertNil(episode(0)?.pauseReason)
        XCTAssertEqual(episode(0)?.doneEntries, 3)
    }

    func testRetryKeepsAttemptsInMemoryUntilASave() async throws {
        try await enqueueAndSettle()
        await manager.persistAll()
        let id = liveIDs(0)[0]
        await transport.fail(id, code: .timedOut)
        XCTAssertEqual(savedManifest(0)?.entries[id.entryIndex].attempts, 0)
        await manager.persistAll()
        XCTAssertEqual(savedManifest(0)?.entries[id.entryIndex].attempts, 1)
    }

    func testDeleteAfterAQueuedManifestWriteLeavesNoFiles() async throws {
        preparer.segments["https://cdn.example/ep0.m3u8"] = 25
        try await enqueueAndSettle()
        // The 20th entry queues a manifest write; the delete right after must win.
        //
        // 第 20 个条目会排入一次 manifest 写入; 紧随其后的删除必须生效.
        for id in liveIDs(0).prefix(20) { await transport.finish(id, layout: layout) }
        let ep = try XCTUnwrap(episode(0))
        let dir = layout.episodeDir(scopeHash: ep.scopeHash, showDir: ep.showDir, episodeDir: ep.episodeDir)
        await manager.delete(ep)
        await manager.persistAll()
        XCTAssertFalse(FileManager.default.fileExists(atPath: dir.path))
    }

    func testDeleteEpisodeRemovesEmptyShowAndMarkDamagedClearsFiles() async throws {
        try await enqueueAndSettle([0, 1])
        for id in liveIDs(0) { await transport.finish(id, layout: layout) }
        let completed = try XCTUnwrap(episode(0))
        manager.markDamaged(completed)
        XCTAssertEqual(episode(0)?.failure, .damaged)
        XCTAssertEqual(episode(0)?.bytes, 0)
        await manager.delete(try XCTUnwrap(episode(0)))
        XCTAssertNil(episode(0))
        XCTAssertEqual(manager.shows(in: scope).count, 1)
        await manager.delete(try XCTUnwrap(episode(1)))
        XCTAssertTrue(manager.shows(in: scope).isEmpty)
    }

    // MARK: - Scope transitions

    func testActivateDuringASuspendedDeactivateEndsActive() async throws {
        try await enqueueAndSettle()
        XCTAssertEqual(liveIDs(0).count, 3)
        // A quick re-login: `activate` for the same scope arrives while `deactivate` waits on the
        // transport's cancel. The deactivate's tail must not sign the scope out after it.
        //
        // 快速重新登录: `deactivate` 等待传输层取消期间, 同一作用域的 `activate` 到达. `deactivate`
        // 的收尾不能在它之后让该作用域登出.
        let gate = PrepareGate()
        transport.cancelGate = gate
        let deactivating = Task { await manager.deactivate() }
        for _ in 0..<1000 where !transport.cancelEntered { await Task.yield() }
        XCTAssertTrue(transport.cancelEntered)
        let activating = Task { await manager.activate(scopeKey: scope, preparer: preparer) }
        for _ in 0..<50 { await Task.yield() }
        gate.open()
        await deactivating.value
        await activating.value
        await manager.waitForIdle()
        XCTAssertEqual(manager.activeScopeKey, scope)
        XCTAssertTrue(manager.canDownload)
        XCTAssertEqual(episode(0)?.state, .downloading)
        XCTAssertNil(episode(0)?.pauseReason)
        XCTAssertEqual(liveIDs(0).count, 3, "the pump re-created the cancelled tasks")
        XCTAssertTrue(liveIDs(0).allSatisfy { $0.generation == 2 })
    }

    func testOpenOfflineDuringASuspendedDeactivateRunsAfterIt() async throws {
        try await enqueueAndSettle()
        let gate = PrepareGate()
        transport.cancelGate = gate
        let deactivating = Task { await manager.deactivate() }
        for _ in 0..<1000 where !transport.cancelEntered { await Task.yield() }
        XCTAssertTrue(transport.cancelEntered)
        // Offline mode opens while the sign-out still waits; it applies after the sign-out.
        //
        // 登出仍在等待时打开离线模式; 它在登出之后生效.
        manager.openOffline(scopeKey: scope)
        gate.open()
        await deactivating.value
        // A later transition returns only after the queued offline open ran.
        //
        // 之后的切换只会在排队的离线打开执行之后返回.
        await manager.deleteScope(syncScopeKey(serverURL: "https://none.example", userID: 9))
        XCTAssertEqual(manager.activeScopeKey, scope)
        XCTAssertFalse(manager.canDownload)
    }

    // MARK: - Trash

    func testDeletesMoveFilesToTheTrashAndEmptyItInTheBackground() async throws {
        try await enqueueAndSettle()
        for id in liveIDs(0) { await transport.finish(id, layout: layout) }
        let ep = try XCTUnwrap(episode(0))
        XCTAssertEqual(ep.state, .completed)
        let showDir = layout.showDir(scopeHash: ep.scopeHash, showDir: ep.showDir)
        await manager.delete(ep)
        // The path is free at once; the files go away off the main actor.
        //
        // 路径立即空出; 文件在主 actor 之外删除.
        XCTAssertFalse(FileManager.default.fileExists(atPath: showDir.path))
        await manager.trash.flush()
        let left = (try? FileManager.default.contentsOfDirectory(atPath: layout.trashDir.path)) ?? []
        XCTAssertEqual(left, [])
        XCTAssertTrue(manager.libraryShows().isEmpty, "the trash is never a show")
    }

    func testLaunchSweepsTrashLeftBehind() async throws {
        let leftover = layout.trashDir.appending(path: "old/show/episode")
        try FileManager.default.createDirectory(at: leftover, withIntermediateDirectories: true)
        try Data([1, 2, 3]).write(to: leftover.appending(path: "seg-00000.ts"))
        let relaunched = makeManager()
        await relaunched.trash.flush()
        let left = (try? FileManager.default.contentsOfDirectory(atPath: layout.trashDir.path)) ?? []
        XCTAssertEqual(left, [])
    }

    func testRelaunchDecodesSavedManifestsBeforeThePump() async throws {
        try await enqueueAndSettle()
        await transport.finish(liveIDs(0)[0], layout: layout)
        await manager.persistAll()
        // A relaunch finds the episode downloading with its manifest only on disk; the pump picks
        // up where it left off without preparing again.
        //
        // 重启后该集处于下载中, 其 manifest 只在磁盘上; 队列推进从中断处继续, 不会重新准备.
        for id in liveIDs(0) { transport.live[id] = nil }
        let relaunched = makeManager()
        await relaunched.activate(scopeKey: scope, preparer: preparer)
        await relaunched.waitForIdle()
        XCTAssertEqual(preparer.calls.count, 1)
        XCTAssertEqual(liveIDs(0).map(\.entryIndex), [1, 2])
        XCTAssertTrue(liveIDs(0).allSatisfy { $0.generation == 1 })
    }
}


/// A flag set from an observation change handler, which may run off the test's actor.
///
/// 由 observation 变化回调设置的标记, 该回调可能不在测试所在的 actor 上运行.
private final class ObservationFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var _value = false

    var value: Bool { lock.withLock { _value } }

    func set() { lock.withLock { _value = true } }
}

/// Records cover fetches and returns canned bytes (nil simulates a failed download).
///
/// 记录封面获取次数并返回预设数据 (nil 表示下载失败).
private final class CoverFetchRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var _count = 0
    private var _data: Data?
    private var _urls: [URL] = []

    var count: Int { lock.withLock { _count } }
    var urls: [URL] { lock.withLock { _urls } }
    var data: Data? {
        get { lock.withLock { _data } }
        set { lock.withLock { _data = newValue } }
    }

    func fetch(_ url: URL) -> Data? {
        lock.withLock {
            _count += 1
            _urls.append(url)
            return _data
        }
    }
}
