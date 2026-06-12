import XCTest
import AVFoundation
import Observation
@testable import KMTV

final class PlayerViewModelTests: XCTestCase {
    private final class FakePlayerAPI: PlaybackDetailAPIProtocol, @unchecked Sendable {
        var playbackRequests: [(url: String, source: String)] = []
        var playbackResponse = PlaybackURLResponse(
            mode: "proxy",
            url: "https://kmtv.example/api/v1/proxy/m3u8?mt=Base58MediaToken"
        )
        var detailResponse = VideoDetail(
            id: "video-1", title: "Video", type: "movie", year: "2026",
            cover: "", desc: "", director: "", actor: "", area: "",
            episodes: [[Episode(name: "EP1", url: "https://cdn.example/video.m3u8")]]
        )

        func detail(sourceKey: String, videoId: String) async throws -> VideoDetail {
            detailResponse
        }

        func playbackURL(url: String, source: String) async throws -> PlaybackURLResponse {
            playbackRequests.append((url: url, source: source))
            return playbackResponse
        }
    }

    @MainActor
    func testInitialPlaybackState() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let vm = PlayerViewModel(
            apiClient: APIClient(baseURL: "http://localhost"),
            modelContext: container.mainContext,
            serverURL: "http://localhost",
            sources: [], sourceKey: "test", videoId: "1", title: "Test"
        )
        XCTAssertEqual(vm.currentTime, 0)
        XCTAssertEqual(vm.duration, 0)
        XCTAssertEqual(vm.playbackRate, 1.0)
        XCTAssertFalse(vm.isPlaying)
        XCTAssertNil(vm.player)
    }

    @MainActor
    func testOnTimeUpdateSetsProperties() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let vm = PlayerViewModel(
            apiClient: APIClient(baseURL: "http://localhost"),
            modelContext: container.mainContext,
            serverURL: "http://localhost",
            sources: [], sourceKey: "test", videoId: "1", title: "Test"
        )
        vm.onTimeUpdate(current: 45.0, total: 120.0)
        XCTAssertEqual(vm.currentTime, 45.0)
        XCTAssertEqual(vm.duration, 120.0)
    }

    @MainActor
    func testSkipCalculation() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let vm = PlayerViewModel(
            apiClient: APIClient(baseURL: "http://localhost"),
            modelContext: container.mainContext,
            serverURL: "http://localhost",
            sources: [], sourceKey: "test", videoId: "1", title: "Test"
        )
        // Without a player, skip should not crash
        vm.skip(by: 30)
        vm.skip(by: -30)
    }

    @MainActor
    func testTogglePlayPauseWithoutPlayer() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let vm = PlayerViewModel(
            apiClient: APIClient(baseURL: "http://localhost"),
            modelContext: container.mainContext,
            serverURL: "http://localhost",
            sources: [], sourceKey: "test", videoId: "1", title: "Test"
        )
        // Should not crash when player is nil
        vm.togglePlayPause()
    }

    @MainActor
    func testSetRate() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let vm = PlayerViewModel(
            apiClient: APIClient(baseURL: "http://localhost"),
            modelContext: container.mainContext,
            serverURL: "http://localhost",
            sources: [], sourceKey: "test", videoId: "1", title: "Test"
        )
        vm.setRate(2.0)
        XCTAssertEqual(vm.playbackRate, 2.0)
    }

    @MainActor
    func testSeekWithoutPlayer() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let vm = PlayerViewModel(
            apiClient: APIClient(baseURL: "http://localhost"),
            modelContext: container.mainContext,
            serverURL: "http://localhost",
            sources: [], sourceKey: "test", videoId: "1", title: "Test"
        )
        // Should not crash
        vm.seek(to: 60.0)
    }

    @MainActor
    func testPreparePlaybackURLUsesServerPlaybackEndpoint() async throws {
        let container = try ModelContainerFactory.makeInMemory()
        let api = FakePlayerAPI()
        let vm = PlayerViewModel(
            apiClient: api,
            modelContext: container.mainContext,
            serverURL: "https://kmtv.example",
            sources: [SourceResult(
                sourceKey: "source-a",
                sourceName: "Source A",
                videoId: "video-1",
                durationMs: 0,
                episodes: [Episode(name: "EP1", url: "https://cdn.example/video.m3u8")]
            )],
            sourceKey: "source-a",
            videoId: "video-1",
            title: "Video"
        )
        vm.detail = api.detailResponse

        let url = try await vm.preparePlaybackURL()

        XCTAssertEqual(url.absoluteString, "https://kmtv.example/api/v1/proxy/m3u8?mt=Base58MediaToken")
        XCTAssertEqual(api.playbackRequests.count, 1)
        XCTAssertEqual(api.playbackRequests.first?.url, "https://cdn.example/video.m3u8")
        XCTAssertEqual(api.playbackRequests.first?.source, "source-a")
    }

    @MainActor
    func testPreparePlaybackURLThrowsWithoutEpisode() async throws {
        let container = try ModelContainerFactory.makeInMemory()
        let vm = PlayerViewModel(
            apiClient: FakePlayerAPI(),
            modelContext: container.mainContext,
            serverURL: "https://kmtv.example",
            sources: [],
            sourceKey: "source-a",
            videoId: "video-1",
            title: "Video"
        )

        do {
            _ = try await vm.preparePlaybackURL()
            XCTFail("expected missing episode error")
        } catch PlayerError.missingEpisode {
            // expected
        }
    }

    @MainActor
    func testStartPlaybackNotifiesPlayerAvailability() async throws {
        let container = try ModelContainerFactory.makeInMemory()
        let api = FakePlayerAPI()
        api.playbackResponse = PlaybackURLResponse(mode: "direct", url: "file:///tmp/kmtv-test.m3u8")
        let vm = PlayerViewModel(
            apiClient: api,
            modelContext: container.mainContext,
            serverURL: "https://kmtv.example",
            sources: [SourceResult(
                sourceKey: "source-a",
                sourceName: "Source A",
                videoId: "video-1",
                durationMs: 0,
                episodes: [Episode(name: "EP1", url: "https://cdn.example/video.m3u8")]
            )],
            sourceKey: "source-a",
            videoId: "video-1",
            title: "Video"
        )
        vm.detail = api.detailResponse

        let playerAvailable = expectation(description: "player availability change is observed")
        withObservationTracking {
            _ = vm.player
        } onChange: {
            playerAvailable.fulfill()
        }

        await vm.startPlaybackAsync()

        XCTAssertNotNil(vm.player)
        await fulfillment(of: [playerAvailable], timeout: 1.0)
    }

    @MainActor
    func testStartPlaybackShowsInitialBufferingState() async throws {
        let container = try ModelContainerFactory.makeInMemory()
        let api = FakePlayerAPI()
        api.playbackResponse = PlaybackURLResponse(mode: "direct", url: "file:///tmp/kmtv-test.m3u8")
        let vm = PlayerViewModel(
            apiClient: api,
            modelContext: container.mainContext,
            serverURL: "https://kmtv.example",
            sources: [SourceResult(
                sourceKey: "source-a",
                sourceName: "Source A",
                videoId: "video-1",
                durationMs: 0,
                episodes: [Episode(name: "EP1", url: "https://cdn.example/video.m3u8")]
            )],
            sourceKey: "source-a",
            videoId: "video-1",
            title: "Video"
        )
        vm.detail = api.detailResponse

        await vm.startPlaybackAsync()

        XCTAssertTrue(vm.isBuffering)
        XCTAssertFalse(vm.isPlaying)
    }

    @MainActor
    func testSwitchSourcePreservesMetadataAndRefreshesEpisodes() async throws {
        let container = try ModelContainerFactory.makeInMemory()
        let api = FakePlayerAPI()
        let initialDetail = VideoDetail(
            id: "video-1", title: "Video", type: "movie", year: "2026",
            cover: "cover-a", desc: "description", director: "director", actor: "actor", area: "area",
            episodes: [[Episode(name: "EP1", url: "https://cdn.example/a1.m3u8")]]
        )
        api.detailResponse = VideoDetail(
            id: "video-1", title: "Replacement", type: "movie", year: "2026",
            cover: "cover-b", desc: "new description", director: "", actor: "", area: "",
            episodes: [[Episode(name: "EP2", url: "https://cdn.example/b2.m3u8")]]
        )
        let vm = PlayerViewModel(
            apiClient: api,
            modelContext: container.mainContext,
            serverURL: "https://kmtv.example",
            sources: [
                SourceResult(
                    sourceKey: "source-a",
                    sourceName: "Source A",
                    videoId: "video-1",
                    durationMs: 0,
                    episodes: initialDetail.episodes.first ?? []
                ),
                SourceResult(
                    sourceKey: "source-b",
                    sourceName: "Source B",
                    videoId: "video-1",
                    durationMs: 0,
                    episodes: []
                )
            ],
            sourceKey: "source-a",
            videoId: "video-1",
            title: "Video"
        )
        vm.detail = initialDetail

        await vm.switchSource("source-b")

        XCTAssertEqual(vm.currentSourceKey, "source-b")
        XCTAssertEqual(vm.detail?.title, "Video")
        XCTAssertEqual(vm.detail?.cover, "cover-a")
        XCTAssertEqual(vm.episodes.map(\.name), ["EP2"])
        XCTAssertEqual(vm.currentEpisodeIndex, 0)
    }

    @MainActor
    func testLoadDetailAppliesInitialEpisodeIndex() async throws {
        let container = try ModelContainerFactory.makeInMemory()
        let api = FakePlayerAPI()
        api.detailResponse = VideoDetail(
            id: "video-1", title: "Video", type: "show", year: "2026",
            cover: "", desc: "", director: "", actor: "", area: "",
            episodes: [[
                Episode(name: "EP1", url: "https://cdn.example/ep1.m3u8"),
                Episode(name: "EP2", url: "https://cdn.example/ep2.m3u8"),
                Episode(name: "EP3", url: "https://cdn.example/ep3.m3u8")
            ]]
        )
        let vm = PlayerViewModel(
            apiClient: api,
            modelContext: container.mainContext,
            serverURL: "https://kmtv.example",
            sources: [SourceResult(
                sourceKey: "source-a",
                sourceName: "Source A",
                videoId: "video-1",
                durationMs: 0,
                episodes: []
            )],
            sourceKey: "source-a",
            videoId: "video-1",
            title: "Video",
            initialEpisodeIndex: 2
        )

        let ok = await vm.loadDetail(sourceKey: "source-a", videoId: "video-1")

        XCTAssertTrue(ok)
        XCTAssertEqual(vm.currentEpisodeIndex, 2)
        XCTAssertEqual(vm.currentEpisodeName, "EP3")
    }

    @MainActor
    func testLoadDetailClampsInitialEpisodeIndexToAvailableEpisodes() async throws {
        let container = try ModelContainerFactory.makeInMemory()
        let api = FakePlayerAPI()
        api.detailResponse = VideoDetail(
            id: "video-1", title: "Video", type: "show", year: "2026",
            cover: "", desc: "", director: "", actor: "", area: "",
            episodes: [[
                Episode(name: "EP1", url: "https://cdn.example/ep1.m3u8"),
                Episode(name: "EP2", url: "https://cdn.example/ep2.m3u8"),
                Episode(name: "EP3", url: "https://cdn.example/ep3.m3u8")
            ]]
        )
        let vm = PlayerViewModel(
            apiClient: api,
            modelContext: container.mainContext,
            serverURL: "https://kmtv.example",
            sources: [SourceResult(
                sourceKey: "source-a",
                sourceName: "Source A",
                videoId: "video-1",
                durationMs: 0,
                episodes: []
            )],
            sourceKey: "source-a",
            videoId: "video-1",
            title: "Video",
            initialEpisodeIndex: 9
        )

        let ok = await vm.loadDetail(sourceKey: "source-a", videoId: "video-1")

        XCTAssertTrue(ok)
        XCTAssertEqual(vm.currentEpisodeIndex, 2)
        XCTAssertEqual(vm.currentEpisodeName, "EP3")
    }

    @MainActor
    func testCoverHintFillsMissingDetailCoverForWatchHistory() async throws {
        let container = try ModelContainerFactory.makeInMemory()
        let api = FakePlayerAPI()
        api.detailResponse = VideoDetail(
            id: "video-1", title: "Video", type: "show", year: "2026",
            cover: "", desc: "", director: "", actor: "", area: "",
            episodes: [[Episode(name: "EP1", url: "https://cdn.example/ep1.m3u8")]]
        )
        let vm = PlayerViewModel(
            apiClient: api,
            modelContext: container.mainContext,
            serverURL: "https://kmtv.example",
            sources: [SourceResult(
                sourceKey: "source-a",
                sourceName: "Source A",
                videoId: "video-1",
                durationMs: 0,
                episodes: []
            )],
            sourceKey: "source-a",
            videoId: "video-1",
            title: "Video",
            coverHint: "https://img.example/cover.jpg"
        )

        let ok = await vm.loadDetail(sourceKey: "source-a", videoId: "video-1")
        vm.onTimeUpdate(current: 10, total: 120)

        let history = WatchHistoryItem.recent(in: container.mainContext, serverURL: "https://kmtv.example")
        XCTAssertTrue(ok)
        XCTAssertEqual(vm.detail?.cover, "https://img.example/cover.jpg")
        XCTAssertEqual(history.first?.cover, "https://img.example/cover.jpg")
    }
}
