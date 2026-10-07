import SwiftData
import XCTest
@testable import KMTV

/// Covers the download library's merge rules across scopes and its row lookups, against an
/// in-memory store without the download engine.
///
/// 使用内存存储且不依赖下载引擎, 覆盖下载库跨作用域的合并规则与数据行查询.
@MainActor
final class DownloadLibraryTests: XCTestCase {
    private let active = "scope-active"
    private let other = "scope-other"
    private let third = "scope-third"
    private var container: ModelContainer!
    private var library: DownloadLibrary!

    override func setUp() async throws {
        container = try ModelContainerFactory.makeInMemory()
        library = DownloadLibrary(context: container.mainContext)
    }

    @discardableResult
    private func show(_ scope: String, title: String = "Show", at time: TimeInterval) -> DownloadShow {
        let show = DownloadShow(scopeKey: scope, title: title, cover: "", type: "tv", year: "2026",
                                createdAt: Date(timeIntervalSince1970: time))
        container.mainContext.insert(show)
        return show
    }

    @discardableResult
    private func episode(_ show: DownloadShow, index: Int = 0, videoId: String = "v1", state: DownloadState = .queued,
                         at time: TimeInterval) -> DownloadEpisode {
        let ep = DownloadEpisode(show: show, sourceKey: "src", sourceName: "Source", videoId: videoId, episodeIndex: index,
                                 episodeName: "EP\(index + 1)", lineIndex: 0, episodeCount: 3,
                                 episodeURL: "https://cdn.example/ep\(index).m3u8", queueOrder: index,
                                 createdAt: Date(timeIntervalSince1970: time))
        ep.state = state
        container.mainContext.insert(ep)
        return ep
    }

    func testCompletedCopyWinsOverTheActiveScopesUnfinishedOne() throws {
        let mine = episode(show(active, at: 1), state: .downloading, at: 3)
        let done = episode(show(other, at: 2), state: .completed, at: 2)
        try container.mainContext.save()
        XCTAssertTrue(DownloadLibrary.prefers(done, over: mine, activeScopeKey: active))
        XCTAssertFalse(DownloadLibrary.prefers(mine, over: done, activeScopeKey: active))
        XCTAssertEqual(library.libraryEpisodes(showKey: nil, activeScopeKey: active).map(\.scopeKey), [other])
    }

    func testActiveScopeWinsBetweenUnfinishedCopiesThenTheNewest() throws {
        let mine = episode(show(active, at: 1), state: .paused, at: 1)
        let newer = episode(show(other, at: 2), state: .queued, at: 5)
        let newest = episode(show(third, at: 3), state: .failed, at: 9)
        try container.mainContext.save()
        XCTAssertTrue(DownloadLibrary.prefers(mine, over: newest, activeScopeKey: active))
        XCTAssertEqual(library.libraryEpisodes(showKey: nil, activeScopeKey: active).map(\.scopeKey), [active])
        // Without an active copy, the newest stands for the episode.
        //
        // 没有当前作用域的副本时, 由最新的副本代表该集.
        XCTAssertTrue(DownloadLibrary.prefers(newest, over: newer, activeScopeKey: nil))
        XCTAssertEqual(library.libraryEpisodes(showKey: nil, activeScopeKey: nil).map(\.scopeKey), [third])
    }

    func testLibraryEpisodesAreOnePerEpisodeOrderedByIndexAndFilteredByShow() throws {
        let mine = show(active, at: 1)
        let theirs = show(other, at: 2)
        let movie = show(other, title: "Movie", at: 3)
        episode(mine, index: 1, at: 1)
        episode(theirs, index: 1, at: 2)
        episode(theirs, index: 0, state: .completed, at: 2)
        // Another title is another video; one scope stores one row per source, video, and episode.
        //
        // 另一部作品对应另一个视频; 同一作用域对每个来源, 视频与分集只存一行.
        episode(movie, index: 0, videoId: "v2", at: 3)
        try container.mainContext.save()
        let all = library.libraryEpisodes(showKey: nil, activeScopeKey: active)
        XCTAssertEqual(all.count, 3)
        let picked = library.libraryEpisodes(showKey: mine.showKey, activeScopeKey: active)
        XCTAssertEqual(picked.map(\.episodeIndex), [0, 1])
        XCTAssertEqual(picked.map(\.scopeKey), [other, active])
    }

    func testLibraryShowsAreOnePerShowNewestFirstWithTheActiveRow() throws {
        let older = show(other, at: 1)
        let mine = show(active, at: 2)
        let newest = show(third, at: 5)
        let movie = show(third, title: "Movie", at: 4)
        try container.mainContext.save()
        let shows = library.libraryShows(activeScopeKey: active)
        XCTAssertEqual(shows.map(\.showKey), [newest.showKey, movie.showKey])
        XCTAssertTrue(shows[0] === mine)
        XCTAssertTrue(library.libraryShows(activeScopeKey: nil)[0] === newest)
        XCTAssertTrue(library.libraryShow(showKey: older.showKey, activeScopeKey: active) === mine)
        XCTAssertTrue(library.libraryShow(showKey: older.showKey, activeScopeKey: nil) === newest)
        XCTAssertNil(library.libraryShow(showKey: "none", activeScopeKey: active))
    }

    func testCompletedCopyPrefersTheActiveScopeThenTheNewest() throws {
        let theirs = episode(show(other, at: 1), state: .completed, at: 5)
        let mine = episode(show(active, at: 2), state: .completed, at: 1)
        episode(show(third, at: 3), state: .downloading, at: 9)
        try container.mainContext.save()
        let key = theirs.showKey
        XCTAssertTrue(library.completedCopy(showKey: key, sourceKey: "src", videoId: "v1", episodeIndex: 0,
                                            activeScopeKey: active) === mine)
        XCTAssertTrue(library.completedCopy(showKey: key, sourceKey: "src", videoId: "v1", episodeIndex: 0,
                                            activeScopeKey: third) === theirs)
        XCTAssertNil(library.completedCopy(showKey: key, sourceKey: "src", videoId: "v1", episodeIndex: 1,
                                           activeScopeKey: active))
        XCTAssertTrue(library.hasCompletedDownloads)
        XCTAssertEqual(library.copies(of: mine).count, 3)
        XCTAssertEqual(library.scopeKeys(), [active, other, third])
    }

    func testEpisodeForKeyCachesTheRowAndFetchesAgainAfterADelete() throws {
        let row = show(active, at: 1)
        let ep = episode(row, at: 1)
        try container.mainContext.save()
        let key = ep.episodeKey
        XCTAssertTrue(library.episode(forKey: key) === ep)
        XCTAssertTrue(library.episode(forKey: key) === ep)
        XCTAssertNil(library.episode(forKey: "not/a"))
        container.mainContext.delete(ep)
        try container.mainContext.save()
        XCTAssertNil(library.episode(forKey: key))
        let again = episode(row, at: 2)
        try container.mainContext.save()
        XCTAssertTrue(library.episode(forKey: key) === again)
    }

    func testCountsAndBytes() throws {
        let mine = show(active, at: 1)
        episode(mine, index: 0, state: .queued, at: 1).bytes = 10
        episode(mine, index: 1, state: .downloading, at: 1).bytes = 20
        episode(mine, index: 2, state: .completed, at: 1).bytes = 30
        episode(show(other, at: 1), state: .downloading, at: 1).bytes = 5
        try container.mainContext.save()
        XCTAssertEqual(library.activeEpisodeCount(in: active), 2)
        XCTAssertEqual(library.activeEpisodeCount(in: nil), 0)
        XCTAssertEqual(library.totalBytes(), 65)
        XCTAssertEqual(library.downloadingEpisodes().count, 2)
    }

    func testSnapshotKeysShowsAndGroupsEpisodesInLibraryOrder() throws {
        let mine = show(active, at: 1)
        let theirs = show(other, at: 2)
        let movie = show(other, title: "Movie", at: 3)
        episode(mine, index: 1, at: 1)
        episode(theirs, index: 0, state: .completed, at: 2)
        episode(movie, index: 0, videoId: "v2", at: 3)
        try container.mainContext.save()
        let snapshot = DownloadLibrarySnapshot(
            revision: 7, shows: library.libraryShows(activeScopeKey: active),
            episodes: library.libraryEpisodes(showKey: nil, activeScopeKey: active),
            scopeEpisodes: library.episodes(in: active))
        XCTAssertEqual(snapshot.revision, 7)
        XCTAssertEqual(snapshot.shows.map(\.showKey), [movie.showKey, mine.showKey])
        XCTAssertTrue(snapshot.show(showKey: mine.showKey) === mine, "the active scope's row stands for the show")
        XCTAssertNil(snapshot.show(showKey: "none"))
        let grouped = snapshot.episodes(showKey: mine.showKey)
        let direct = library.libraryEpisodes(showKey: mine.showKey, activeScopeKey: active)
        XCTAssertEqual(grouped.map(\.episodeIndex), [0, 1])
        XCTAssertEqual(grouped.map(\.scopeKey), direct.map(\.scopeKey))
        XCTAssertTrue(snapshot.episodes(showKey: "none").isEmpty)
        XCTAssertEqual(snapshot.scopeEpisodes.map(\.episodeIndex), [1])
        XCTAssertTrue(DownloadLibrarySnapshot().shows.isEmpty)
    }
}
