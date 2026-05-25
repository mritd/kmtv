import XCTest
@testable import KMTV

@MainActor
final class AdminViewModelTests: XCTestCase {
    func testLoadSettingsAndUpdateSetting() async {
        let api = AdminAPIFake()
        api.settings = SettingsResponse(settings: ["playback_mode": "proxy"])
        let vm = AdminViewModel(apiClient: api, currentUserId: 1)

        await vm.loadSettings()
        await vm.updateSetting(key: "playback_mode", value: "direct")

        XCTAssertEqual(vm.settings["playback_mode"], "direct")
        XCTAssertEqual(api.updatedSettings.last, ["playback_mode": "direct"])
    }

    func testDeleteCurrentUserIsRejectedLocally() async {
        let api = AdminAPIFake()
        let vm = AdminViewModel(apiClient: api, currentUserId: 1)

        await vm.deleteUser(User(id: 1, username: "admin", role: "admin", avatar: nil))

        XCTAssertEqual(vm.error, String(localized: "Cannot delete yourself"))
    }
}
