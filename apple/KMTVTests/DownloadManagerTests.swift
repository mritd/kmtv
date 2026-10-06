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
                        backgroundWakeBudget: wakeBudget, progressWait: { [ticks] _ in await ticks.wait() })
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
        XCTAssertTrue(manager.hasCompleted(in: scope))
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
        manager.persistAll()
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

    func testDeleteScopeAndOtherScopeBytes() async throws {
        try await enqueueAndSettle()
        for id in liveIDs(0) { await transport.finish(id, layout: layout) }
        let other = syncScopeKey(serverURL: "https://other.example", userID: 2)
        XCTAssertEqual(manager.otherScopesBytes(excluding: other), 12)
        XCTAssertEqual(manager.usedBytes(in: scope), 12)
        await manager.deleteScope(scope)
        XCTAssertTrue(manager.shows(in: scope).isEmpty)
        XCTAssertNil(episode(0))
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
        let used = manager.storage.activeBytes
        for id in liveIDs(0).prefix(10) { await transport.finish(id, layout: layout) }
        XCTAssertEqual(manager.progressTick, start)
        XCTAssertNotNil(manager.progressTask)
        await tick()
        // Ten entries within one interval produce a single notification.
        //
        // 一个间隔内完成的十个条目只产生一次通知.
        XCTAssertEqual(manager.progressTick, start + 1)
        XCTAssertEqual(manager.storage.activeBytes, used + 40)
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
        // A pause writes the exact count at once, and so does a relaunch.
        //
        // 暂停会立即写入准确的数量, 重启后同样如此.
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
        manager.persistAll()
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
        XCTAssertEqual(manager.storage.activeBytes, manager.usedBytes(in: scope))
        XCTAssertEqual(manager.storage.activeBytes, 16)
        manager.markDamaged(try XCTUnwrap(episode(0)))
        XCTAssertEqual(manager.storage.activeBytes, 4)
        await manager.delete(try XCTUnwrap(episode(1)))
        XCTAssertEqual(manager.storage.activeBytes, 0)
        // Another scope's bytes move to "other" when the scope changes.
        //
        // 作用域切换后, 原作用域的字节数计入 "其他".
        try await enqueueAndSettle([2])
        for id in liveIDs(2) { await transport.finish(id, layout: layout) }
        let other = syncScopeKey(serverURL: "https://kmtv.example", userID: 2)
        await manager.activate(scopeKey: other, preparer: preparer)
        XCTAssertEqual(manager.storage.activeBytes, 0)
        XCTAssertEqual(manager.storage.otherBytes, manager.otherScopesBytes(excluding: other))
        XCTAssertEqual(manager.storage.otherBytes, 12)
        // Free space is read off the main actor, on demand.
        //
        // 剩余空间按需在主 actor 之外读取.
        space.value = 7_000_000_000
        await manager.refreshFreeSpace()
        XCTAssertEqual(manager.storage.freeBytes, 7_000_000_000)
    }

    func testPrepareBumpsStructureOnceForTheStateChange() async throws {
        let before = manager.displayRevision
        let gate = try await enqueueGated([0])
        let enqueued = manager.changeCount
        // The picker still sees the episode start preparing, through the revision.
        //
        // 选集面板仍可通过版本号看到该集开始准备.
        XCTAssertNotEqual(manager.displayRevision, before)
        gate.open()
        await manager.waitForIdle()
        XCTAssertEqual(manager.changeCount - enqueued, 1)
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

    var count: Int { lock.withLock { _count } }
    var data: Data? {
        get { lock.withLock { _data } }
        set { lock.withLock { _data = newValue } }
    }

    func fetch(_ url: URL) -> Data? {
        lock.withLock {
            _count += 1
            return _data
        }
    }
}
