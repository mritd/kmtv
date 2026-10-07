import XCTest
import UIKit
@testable import KMTV

@MainActor
final class ProfileViewModelTests: XCTestCase {
    func testClearWatchHistoryUsesTheSyncStore() throws {
        let container = try ModelContainerFactory.makeInMemory()
        let store = makeSyncStore(container)
        store.upsert(.watch(WatchPayload(title: "Video 1")))
        store.upsert(.watch(WatchPayload(title: "Finished", completed: true)))
        makeSyncStore(container, serverURL: "https://other.example").upsert(.watch(WatchPayload(title: "Video 2")))
        let api = AuthAPIFake()
        let vm = ProfileViewModel(apiClient: api, syncStore: store, user: api.user)

        XCTAssertEqual(store.watchItems.filter { !$0.completed }.count, 1)
        XCTAssertTrue(vm.clearWatchHistory())
        XCTAssertEqual(store.watchItems.filter { !$0.completed }.count, 0)
        XCTAssertEqual(makeSyncStore(container, serverURL: "https://other.example").watchItems.count, 1)
        XCTAssertNotNil(vm.successMessage)
    }

    func testUpdateUsernameUpdatesUserState() async throws {
        let api = AuthAPIFake()
        let vm = ProfileViewModel(
            apiClient: api,
            syncStore: nil,
            user: api.user
        )
        vm.editUsername = "kovacs"

        await vm.updateUsername()

        XCTAssertEqual(vm.user?.username, "kovacs")
        XCTAssertFalse(vm.isEditingUsername)
    }

    func testChangePasswordRejectsMismatchedConfirmation() async throws {
        let api = AuthAPIFake()
        let vm = ProfileViewModel(
            apiClient: api,
            syncStore: nil,
            user: api.user
        )
        vm.passwordOld = "old"
        vm.passwordNew = "new"
        vm.passwordConfirm = "different"

        await vm.changePassword()

        XCTAssertNil(api.changedPassword)
    }

    func testChangePasswordSuccessClearsFields() async throws {
        let api = AuthAPIFake()
        let vm = ProfileViewModel(
            apiClient: api,
            syncStore: nil,
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
        let api = AuthAPIFake()
        api.user.avatar = "/avatar.jpg"
        let vm = ProfileViewModel(
            apiClient: api,
            syncStore: nil,
            user: api.user
        )

        await vm.deleteAvatar()

        XCTAssertNil(vm.user?.avatar)
        XCTAssertNotNil(vm.successMessage)
    }

    func testUploadAvatarConvertsImageToJPEGAndUpdatesUserState() async throws {
        let api = AuthAPIFake()
        let vm = ProfileViewModel(
            apiClient: api,
            syncStore: nil,
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

    func testClearWatchHistoryWithoutStoreReportsNoSuccess() {
        let api = AuthAPIFake()
        let vm = ProfileViewModel(apiClient: api, syncStore: nil, user: api.user)

        XCTAssertFalse(vm.clearWatchHistory())
        XCTAssertNil(vm.successMessage)
        XCTAssertFalse(ProfileViewModel.clearWatchHistory(in: nil))
    }

    func testPickAvatarUploadsLoadedPhotoAndSkipsOnLoadFailure() async {
        let api = AuthAPIFake()
        let vm = ProfileViewModel(apiClient: api, syncStore: nil, user: api.user)

        await vm.pickAvatar { nil }
        await vm.pickAvatar { throw URLError(.badURL) }
        XCTAssertNil(api.uploadedAvatar)
    }
}
