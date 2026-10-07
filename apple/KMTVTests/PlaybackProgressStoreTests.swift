import SwiftData
import XCTest
@testable import KMTV

@MainActor
final class PlaybackProgressStoreTests: XCTestCase {
    func testLoadSettingsCreatesDefaultRecord() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let store = PlaybackProgressStore(modelContext: container.mainContext, serverURL: "https://kmtv.example", syncStore: nil, title: "Video")

        let settings = store.loadSettings()

        XCTAssertEqual(settings.serverURL, "https://kmtv.example")
        XCTAssertEqual(settings.title, "Video")
        XCTAssertEqual(settings.skipIntroSeconds, 0)
    }

    func testSaveSettingsPersistsSkipSeconds() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let store = PlaybackProgressStore(modelContext: container.mainContext, serverURL: "https://kmtv.example", syncStore: nil, title: "Video")

        store.saveSettings(skipIntroSeconds: 15)
        store.saveSettings(skipOutroSeconds: 40)

        let reloaded = PlaybackProgressStore(modelContext: container.mainContext, serverURL: "https://kmtv.example",
                                             syncStore: nil, title: "Video").loadSettings()
        XCTAssertEqual(reloaded.skipIntroSeconds, 15)
        XCTAssertEqual(reloaded.skipOutroSeconds, 40)
        XCTAssertFalse(container.mainContext.hasChanges, "the change was saved, not left pending")
    }

    private let detail = VideoDetail(id: "v1", title: "Video", type: "movie", year: "2026", cover: "c",
                                     desc: "", director: "", actor: "", area: "",
                                     episodes: [[Episode(name: "EP1", url: "u")]])

    func testStartTimeUsesMatchingWatchRecordBeforeIntroSkip() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let sync = makeSyncStore(container)
        sync.upsert(.watch(WatchPayload(title: "Video", sourceKey: "s1", videoId: "v1", groupIndex: 1, progressSec: 42, durationSec: 100)))
        let store = PlaybackProgressStore(modelContext: container.mainContext, serverURL: "https://kmtv.example", syncStore: sync, title: "Video")

        XCTAssertEqual(store.startTime(sourceKey: "s1", videoId: "v1", groupIndex: 1, episodeIndex: 0, skipIntroSeconds: 12), 42)
        XCTAssertEqual(store.startTime(sourceKey: "s1", videoId: "v1", groupIndex: 0, episodeIndex: 0, skipIntroSeconds: 12), 12)
        XCTAssertEqual(store.startTime(sourceKey: "s2", videoId: "v1", groupIndex: 1, episodeIndex: 0, skipIntroSeconds: 0), 0)
    }

    func testSaveProgressWritesWatchRecordAndKeepsCompletedFlag() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let sync = makeSyncStore(container)
        let store = PlaybackProgressStore(modelContext: container.mainContext, serverURL: "https://kmtv.example", syncStore: sync, title: "Video")

        store.saveProgress(detail: detail, sourceKey: "s1", videoId: "v1", episode: Episode(name: "EP1", url: "u"),
                           groupIndex: 0, episodeIndex: 0, current: 30, duration: 120)
        XCTAssertEqual(sync.watch(title: "Video"), WatchPayload(title: "Video", cover: "c", sourceKey: "s1", videoId: "v1",
                                                                episode: "EP1", progressSec: 30, durationSec: 120))

        store.saveProgress(detail: detail, sourceKey: "s1", videoId: "v1", episode: Episode(name: "EP1", url: "u"),
                           groupIndex: 0, episodeIndex: 0, current: 119, duration: 120, completed: true)
        XCTAssertEqual(sync.watch(title: "Video")?.completed, true)
        XCTAssertEqual(store.startTime(sourceKey: "s1", videoId: "v1", episodeIndex: 0, skipIntroSeconds: 5), 5)
    }

    func testSaveProgressIgnoresInvalidProgress() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let sync = makeSyncStore(container)
        let store = PlaybackProgressStore(modelContext: container.mainContext, serverURL: "https://kmtv.example", syncStore: sync, title: "Video")
        store.saveProgress(detail: detail, sourceKey: "s1", videoId: "", episode: Episode(name: "EP1", url: "u"),
                           episodeIndex: 0, current: 30, duration: 120)
        store.saveProgress(detail: detail, sourceKey: "s1", videoId: "v1", episode: Episode(name: "EP1", url: "u"),
                           episodeIndex: 0, current: 0, duration: 120)
        store.saveProgress(detail: detail, sourceKey: "s1", videoId: "v1", episode: Episode(name: "EP1", url: "u"),
                           episodeIndex: 0, current: 10, duration: .nan)
        store.saveProgress(detail: detail, sourceKey: "s1", videoId: "v1", episode: Episode(name: "EP1", url: "u"),
                           episodeIndex: 0, current: .nan, duration: 120)
        XCTAssertNil(sync.watch(title: "Video"))
    }

    @MainActor
    func testTitleBasedSaveWritesTheSameWatchRecord() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let sync = makeSyncStore(container)
        let store = PlaybackProgressStore(modelContext: container.mainContext, serverURL: "https://kmtv.example",
                                          syncStore: sync, title: "Show")
        store.saveProgress(title: "Show", cover: "c", sourceKey: "src", videoId: "v1", episodeName: "EP2",
                           groupIndex: 1, episodeIndex: 1, current: 42, duration: 600, completed: false)
        let record = try XCTUnwrap(sync.watch(title: "Show"))
        XCTAssertEqual(record.sourceKey, "src")
        XCTAssertEqual(record.groupIndex, 1)
        XCTAssertEqual(record.episodeIndex, 1)
        XCTAssertEqual(record.episode, "EP2")
        XCTAssertEqual(record.progressSec, 42)
        XCTAssertFalse(record.completed)
    }
}
