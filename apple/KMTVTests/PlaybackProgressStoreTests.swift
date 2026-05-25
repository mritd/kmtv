import SwiftData
import XCTest
@testable import KMTV

@MainActor
final class PlaybackProgressStoreTests: XCTestCase {
    func testLoadSettingsCreatesDefaultRecord() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let store = PlaybackProgressStore(
            modelContext: container.mainContext,
            serverURL: "https://kmtv.example",
            title: "Video"
        )

        let settings = store.loadSettings()

        XCTAssertEqual(settings.serverURL, "https://kmtv.example")
        XCTAssertEqual(settings.title, "Video")
        XCTAssertEqual(settings.skipIntroSeconds, 0)
    }

    func testStartTimeUsesSavedProgressBeforeIntroSkip() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let context = container.mainContext
        WatchHistoryItem.upsert(
            in: context,
            serverURL: "https://kmtv.example",
            sourceKey: "s1",
            videoId: "v1",
            title: "Video",
            cover: "",
            episode: "EP1",
            episodeIndex: 0,
            progress: 42,
            duration: 100
        )
        let store = PlaybackProgressStore(
            modelContext: context,
            serverURL: "https://kmtv.example",
            title: "Video"
        )

        let startTime = store.startTime(sourceKey: "s1", videoId: "v1", episodeIndex: 0, skipIntroSeconds: 12)

        XCTAssertEqual(startTime, 42)
    }

    func testStartTimeFallsBackToIntroSkipWhenHistoryDoesNotMatch() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let context = container.mainContext
        WatchHistoryItem.upsert(
            in: context,
            serverURL: "https://kmtv.example",
            sourceKey: "s1",
            videoId: "v1",
            title: "Video",
            cover: "",
            episode: "EP1",
            episodeIndex: 0,
            progress: 42,
            duration: 100
        )
        let store = PlaybackProgressStore(
            modelContext: context,
            serverURL: "https://kmtv.example",
            title: "Video"
        )

        let startTime = store.startTime(sourceKey: "s1", videoId: "v1", episodeIndex: 1, skipIntroSeconds: 12)

        XCTAssertEqual(startTime, 12)
    }

    func testSaveProgressPersistsWatchHistory() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let context = container.mainContext
        let store = PlaybackProgressStore(
            modelContext: context,
            serverURL: "https://kmtv.example",
            title: "Video"
        )
        let detail = VideoDetail(
            id: "v1",
            title: "Video",
            type: "",
            year: "",
            cover: "https://img.example/cover.jpg",
            desc: "",
            director: "",
            actor: "",
            area: "",
            episodes: []
        )

        store.saveProgress(
            detail: detail,
            sourceKey: "s1",
            videoId: "v1",
            episode: Episode(name: "EP1", url: "https://cdn.example/ep1.m3u8"),
            episodeIndex: 0,
            current: 30,
            duration: 120
        )

        let history = WatchHistoryItem.recent(in: context, serverURL: "https://kmtv.example")
        XCTAssertEqual(history.count, 1)
        XCTAssertEqual(history.first?.sourceKey, "s1")
        XCTAssertEqual(history.first?.videoId, "v1")
        XCTAssertEqual(history.first?.progress, 30)
        XCTAssertEqual(history.first?.duration, 120)
    }

    func testSaveProgressIgnoresInvalidProgress() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let context = container.mainContext
        let store = PlaybackProgressStore(
            modelContext: context,
            serverURL: "https://kmtv.example",
            title: "Video"
        )
        let detail = VideoDetail(
            id: "v1",
            title: "Video",
            type: "",
            year: "",
            cover: "",
            desc: "",
            director: "",
            actor: "",
            area: "",
            episodes: []
        )

        store.saveProgress(
            detail: detail,
            sourceKey: "s1",
            videoId: "",
            episode: Episode(name: "EP1", url: "https://cdn.example/ep1.m3u8"),
            episodeIndex: 0,
            current: 30,
            duration: 120
        )
        store.saveProgress(
            detail: detail,
            sourceKey: "s1",
            videoId: "v1",
            episode: Episode(name: "EP1", url: "https://cdn.example/ep1.m3u8"),
            episodeIndex: 0,
            current: 0,
            duration: 120
        )
        store.saveProgress(
            detail: detail,
            sourceKey: "s1",
            videoId: "v1",
            episode: Episode(name: "EP1", url: "https://cdn.example/ep1.m3u8"),
            episodeIndex: 0,
            current: 30,
            duration: .infinity
        )

        XCTAssertTrue(WatchHistoryItem.recent(in: context, serverURL: "https://kmtv.example").isEmpty)
    }
}
