import SwiftData
import XCTest
@testable import KMTV

/// Covers the offline player's start position, next-episode choice, and checkpoints.
///
/// 覆盖离线播放器的起播位置, 下一集选择与进度保存.
@MainActor
final class OfflinePlayerViewModelTests: XCTestCase {
    private let scope = syncScopeKey(serverURL: "https://kmtv.example", userID: 1)
    private var root: URL!
    private var container: ModelContainer!
    private var manager: DownloadManager!
    private var transport: FakeDownloadTransport!
    private var sync: SyncStore!

    override func setUp() async throws {
        root = FileManager.default.temporaryDirectory.appending(path: "opv-\(UUID().uuidString)")
        container = try ModelContainerFactory.makeInMemory()
        transport = FakeDownloadTransport()
        let layout = DownloadLayout(root: root)
        manager = DownloadManager(context: container.mainContext, layout: layout, transport: transport,
                                  defaults: UserDefaults(suiteName: "opv-\(UUID().uuidString)")!,
                                  freeSpace: { .max }, outstandingLimit: 100)
        await manager.activate(scopeKey: scope, preparer: FakePreparer())
        let requests = (0..<3).map {
            DownloadEpisodeRequest(sourceKey: "src", sourceName: "Source", videoId: "v1", episodeIndex: $0,
                                   episodeName: "EP\($0 + 1)", lineIndex: 0, episodeCount: 3,
                                   episodeURL: "https://cdn.example/ep\($0).m3u8")
        }
        _ = try manager.enqueue(show: DownloadShowInfo(title: "Show", cover: "c", type: "tv", year: "2026", coverURL: nil),
                                episodes: requests)
        await manager.waitForIdle()
        // Complete episodes 0 and 2; episode 1 stays downloading.
        //
        // 完成第 0 与第 2 集; 第 1 集保持下载中.
        for index in [0, 2] {
            let key = try XCTUnwrap(episode(index)).episodeKey
            for id in transport.live.keys.filter({ $0.episodeKey == key }) { await transport.finish(id, layout: layout) }
        }
        sync = makeSyncStore(container)
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: root)
    }

    private func episode(_ index: Int) -> DownloadEpisode? {
        manager.episode(scopeKey: scope, sourceKey: "src", videoId: "v1", episodeIndex: index)
    }

    private func viewModel(_ index: Int) throws -> OfflinePlayerViewModel {
        let ep = try XCTUnwrap(episode(index))
        let show = try XCTUnwrap(manager.show(scopeKey: scope, showKey: ep.showKey))
        return OfflinePlayerViewModel(manager: manager, show: show, episode: ep, modelContext: container.mainContext,
                                      serverURL: "https://kmtv.example", syncStore: sync)
    }

    func testStartTimePrefersExactWatchRecordThenLocalPosition() throws {
        let ep = try XCTUnwrap(episode(0))
        let exact = WatchPayload(title: "Show", sourceKey: "src", videoId: "v1", episode: "EP1", episodeIndex: 0,
                                 progressSec: 90, durationSec: 600)
        XCTAssertEqual(OfflinePlayerViewModel.startTime(record: exact, episode: ep, skipIntroSeconds: 10), 90)
        let other = WatchPayload(title: "Show", sourceKey: "other", videoId: "v1", episode: "EP1", episodeIndex: 0,
                                 progressSec: 90, durationSec: 600)
        ep.positionSec = 30
        XCTAssertEqual(OfflinePlayerViewModel.startTime(record: other, episode: ep, skipIntroSeconds: 10), 30)
        ep.finished = true
        XCTAssertEqual(OfflinePlayerViewModel.startTime(record: nil, episode: ep, skipIntroSeconds: 10), 10)
    }

    func testNextEpisodeSkipsUnfinishedDownloads() throws {
        XCTAssertEqual(try viewModel(0).nextEpisode?.episodeIndex, 2)
        XCTAssertNil(try viewModel(2).nextEpisode)
    }

    func testCheckpointsWriteWatchRecordAndLocalPosition() throws {
        let vm = try viewModel(0)
        vm.record(current: 100, duration: 1000, finished: false)
        let record = try XCTUnwrap(sync.watch(title: "Show"))
        XCTAssertEqual(record.progressSec, 100)
        XCTAssertEqual(record.episodeIndex, 0)
        XCTAssertFalse(record.completed)
        XCTAssertEqual(episode(0)?.positionSec, 100)
        XCTAssertEqual(episode(0)?.finished, false)
    }

    func testOnlyTheLastEpisodeCompletesTheTitle() throws {
        try viewModel(0).record(current: 1000, duration: 1000, finished: true)
        XCTAssertEqual(sync.watch(title: "Show")?.completed, false)
        XCTAssertEqual(episode(0)?.finished, true)
        try viewModel(2).record(current: 1000, duration: 1000, finished: true)
        XCTAssertEqual(sync.watch(title: "Show")?.completed, true)
    }
}
