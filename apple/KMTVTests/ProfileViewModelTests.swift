import XCTest
import UIKit
@testable import KMTV

@MainActor
final class ProfileViewModelTests: XCTestCase {
    func testLoadCountsWatchHistoryForCurrentServerOnly() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let context = container.mainContext
        WatchHistoryItem.upsert(
            in: context,
            serverURL: "https://kmtv.example",
            sourceKey: "s1",
            videoId: "v1",
            title: "Video 1",
            cover: "",
            episode: "EP1",
            episodeIndex: 0,
            progress: 20,
            duration: 100
        )
        WatchHistoryItem.upsert(
            in: context,
            serverURL: "https://other.example",
            sourceKey: "s1",
            videoId: "v2",
            title: "Video 2",
            cover: "",
            episode: "EP1",
            episodeIndex: 0,
            progress: 20,
            duration: 100
        )
        let vm = ProfileViewModel(
            apiClient: AuthAPIFake(),
            modelContext: context,
            serverURL: "https://kmtv.example",
            user: nil
        )

        vm.load()

        XCTAssertEqual(vm.watchHistoryCount, 1)
    }

    func testUpdateUsernameUpdatesUserState() async throws {
        let container = try ModelContainerFactory.makeInMemory()
        let api = AuthAPIFake()
        let vm = ProfileViewModel(
            apiClient: api,
            modelContext: container.mainContext,
            serverURL: "https://kmtv.example",
            user: api.user
        )
        vm.editUsername = "kovacs"

        await vm.updateUsername()

        XCTAssertEqual(vm.user?.username, "kovacs")
        XCTAssertFalse(vm.isEditingUsername)
    }

    func testChangePasswordRejectsMismatchedConfirmation() async throws {
        let container = try ModelContainerFactory.makeInMemory()
        let api = AuthAPIFake()
        let vm = ProfileViewModel(
            apiClient: api,
            modelContext: container.mainContext,
            serverURL: "https://kmtv.example",
            user: api.user
        )
        vm.passwordOld = "old"
        vm.passwordNew = "new"
        vm.passwordConfirm = "different"

        await vm.changePassword()

        XCTAssertNil(api.changedPassword)
    }

    func testChangePasswordSuccessClearsFields() async throws {
        let container = try ModelContainerFactory.makeInMemory()
        let api = AuthAPIFake()
        let vm = ProfileViewModel(
            apiClient: api,
            modelContext: container.mainContext,
            serverURL: "https://kmtv.example",
            user: api.user
        )
        vm.passwordOld = "old"
        vm.passwordNew = "new"
        vm.passwordConfirm = "new"

        await vm.changePassword()

        XCTAssertEqual(api.changedPassword?.old, "old")
        XCTAssertEqual(api.changedPassword?.new, "new")
        XCTAssertEqual(vm.passwordOld, "")
        XCTAssertEqual(vm.passwordNew, "")
        XCTAssertEqual(vm.passwordConfirm, "")
        XCTAssertFalse(vm.isChangingPassword)
    }

    func testDeleteAvatarUpdatesUserState() async throws {
        let container = try ModelContainerFactory.makeInMemory()
        let api = AuthAPIFake()
        api.user.avatar = "/avatar.jpg"
        let vm = ProfileViewModel(
            apiClient: api,
            modelContext: container.mainContext,
            serverURL: "https://kmtv.example",
            user: api.user
        )

        await vm.deleteAvatar()

        XCTAssertNil(vm.user?.avatar)
        XCTAssertNotNil(vm.successMessage)
    }

    func testUploadAvatarConvertsImageToJPEGAndUpdatesUserState() async throws {
        let container = try ModelContainerFactory.makeInMemory()
        let api = AuthAPIFake()
        let vm = ProfileViewModel(
            apiClient: api,
            modelContext: container.mainContext,
            serverURL: "https://kmtv.example",
            user: api.user
        )
        let imageData = UIGraphicsImageRenderer(size: CGSize(width: 4, height: 4)).pngData { context in
            UIColor.red.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 4, height: 4))
        }

        await vm.uploadAvatar(imageData: imageData)

        XCTAssertEqual(api.uploadedAvatar?.mimeType, "image/jpeg")
        XCTAssertGreaterThan(api.uploadedAvatar?.bytes ?? 0, 0)
        XCTAssertEqual(vm.user?.avatar, "/api/v1/auth/avatar")
    }

    func testClearWatchHistoryRemovesServerScopedRows() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let context = container.mainContext
        WatchHistoryItem.upsert(
            in: context,
            serverURL: "https://kmtv.example",
            sourceKey: "s1",
            videoId: "v1",
            title: "Video 1",
            cover: "",
            episode: "EP1",
            episodeIndex: 0,
            progress: 20,
            duration: 100
        )
        WatchHistoryItem.upsert(
            in: context,
            serverURL: "https://other.example",
            sourceKey: "s1",
            videoId: "v2",
            title: "Video 2",
            cover: "",
            episode: "EP1",
            episodeIndex: 0,
            progress: 20,
            duration: 100
        )
        let vm = ProfileViewModel(
            apiClient: AuthAPIFake(),
            modelContext: context,
            serverURL: "https://kmtv.example",
            user: nil
        )

        vm.clearWatchHistory()

        XCTAssertTrue(WatchHistoryItem.recent(in: context, serverURL: "https://kmtv.example").isEmpty)
        XCTAssertEqual(WatchHistoryItem.recent(in: context, serverURL: "https://other.example").count, 1)
        XCTAssertEqual(vm.watchHistoryCount, 0)
    }
}
