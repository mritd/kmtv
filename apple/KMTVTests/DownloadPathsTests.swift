import XCTest
@testable import KMTV

/// Covers download hashing, task IDs, layout paths, and the last-identity store.
///
/// 覆盖下载用的哈希, 任务 ID, 目录布局与最后登录身份的存储.
final class DownloadPathsTests: XCTestCase {
    func testHashesAreStableSixteenHexCharacters() {
        let hash = DownloadPaths.hash16("kmtv.sync.v1:https://kmtv.example:1")
        XCTAssertEqual(hash.count, 16)
        XCTAssertTrue(hash.allSatisfy { $0.isHexDigit })
        XCTAssertEqual(hash, DownloadPaths.hash16("kmtv.sync.v1:https://kmtv.example:1"))
        XCTAssertNotEqual(DownloadPaths.episodeDir(sourceKey: "a", videoId: "1", episodeIndex: 0),
                          DownloadPaths.episodeDir(sourceKey: "a", videoId: "1", episodeIndex: 1))
        XCTAssertEqual(DownloadPaths.scopeHash("s"), DownloadPaths.hash16("s"))
    }

    func testTaskIDRoundTripsAndRejectsGarbage() throws {
        let id = DownloadTaskID(scopeHash: "aaaa", showDir: "bbbb", episodeDir: "cccc", generation: 3, entryIndex: 42)
        XCTAssertEqual(id.description, "aaaa/bbbb/cccc/3/42")
        XCTAssertEqual(DownloadTaskID(description: id.description), id)
        XCTAssertEqual(id.episodeKey, "aaaa/bbbb/cccc")
        XCTAssertNil(DownloadTaskID(description: "a/b/c/x/1"))
        XCTAssertNil(DownloadTaskID(description: "a/b/c/1"))
        XCTAssertNil(DownloadTaskID(description: ""))
    }

    func testLayoutPaths() {
        let layout = DownloadLayout(root: URL(fileURLWithPath: "/tmp/dl"))
        let id = DownloadTaskID(scopeHash: "s", showDir: "h", episodeDir: "e", generation: 2, entryIndex: 7)
        XCTAssertEqual(layout.episodeDir(id).path, "/tmp/dl/s/h/e")
        XCTAssertEqual(layout.incomingFile(id).path, "/tmp/dl/s/h/e/incoming/2-7")
        XCTAssertEqual(layout.manifestURL(episodeDir: layout.episodeDir(id)).lastPathComponent, "manifest.json")
        XCTAssertEqual(layout.playlistURL(episodeDir: layout.episodeDir(id)).lastPathComponent, "index.m3u8")
    }

    func testEpisodeKeyKeepsTheStringFormat() {
        let id = DownloadTaskID(scopeHash: "s", showDir: "h", episodeDir: "e", generation: 2, entryIndex: 7)
        let key = EpisodeKey(scopeHash: "s", showDir: "h", episodeDir: "e")
        XCTAssertEqual(id.episode, key)
        XCTAssertEqual(key.relativePath, "s/h/e")
        XCTAssertEqual(id.episodeKey, key.relativePath)
        XCTAssertEqual(EpisodeKey(relativePath: "s/h/e"), key)
        XCTAssertNil(EpisodeKey(relativePath: "s/h"))
        XCTAssertNil(EpisodeKey(relativePath: "s/h/e/1"))
        XCTAssertTrue(EpisodeKey.path("s/h/e", isInScope: "s"))
        XCTAssertFalse(EpisodeKey.path("s/h/e", isInScope: "h"))
        XCTAssertFalse(EpisodeKey.path("ss/h/e", isInScope: "s"))
        let layout = DownloadLayout(root: URL(fileURLWithPath: "/tmp/dl"))
        XCTAssertEqual(layout.episodeDir(key), layout.episodeDir(id))

        let show = DownloadShow(scopeKey: "scope", title: "Show", cover: "", type: "", year: "",
                                createdAt: Date(timeIntervalSince1970: 0))
        let ep = DownloadEpisode(show: show, sourceKey: "src", sourceName: "", videoId: "v", episodeIndex: 1,
                                 episodeName: "", lineIndex: 0, episodeCount: 1, episodeURL: "", queueOrder: 0,
                                 createdAt: Date(timeIntervalSince1970: 0))
        XCTAssertEqual(ep.episodeKey, "\(ep.scopeHash)/\(ep.showDir)/\(ep.episodeDir)")
        XCTAssertEqual(ep.key.relativePath, ep.episodeKey)
    }

    func testIdentityMatchesNormalizedServerAndStoreRoundTrips() throws {
        let identity = DownloadIdentity(serverURL: "https://KMTV.example/", userID: 5, username: "alice")
        XCTAssertTrue(identity.matches(serverURL: "https://kmtv.example"))
        XCTAssertFalse(identity.matches(serverURL: "https://other.example"))
        XCTAssertEqual(identity.scopeKey, syncScopeKey(serverURL: "https://kmtv.example", userID: 5))

        let defaults = try XCTUnwrap(UserDefaults(suiteName: "DownloadPathsTests-\(UUID().uuidString)"))
        let store = LastIdentityStore(defaults: defaults)
        XCTAssertNil(store.load())
        store.save(identity)
        XCTAssertEqual(store.load(), identity)
        store.clear()
        XCTAssertNil(store.load())
    }

    func testFailureCodesRoundTrip() {
        for failure in [DownloadFailure.unsupportedFormat, .separateAudio, .sourceStatus(404), .sourceRejects,
                        .invalidContent, .network, .damaged] {
            XCTAssertEqual(DownloadFailure(code: failure.code, status: failure.status), failure)
        }
        XCTAssertNil(DownloadFailure(code: "", status: 0))
    }
}
