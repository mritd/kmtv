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

    func testToggleSourceEnabledSendsCompletePayload() async {
        let api = AdminAPIFake()
        let source = Source(
            id: 7,
            key: "source-a",
            name: "Source A",
            api: "https://source-a.example/api",
            detail: "https://source-a.example",
            enabled: false,
            isAdult: true,
            searchable: true,
            comment: "keep",
            health: "healthy"
        )
        api.sources = SourcesResponse(sources: [source])
        let vm = AdminViewModel(apiClient: api, currentUserId: 1)

        await vm.toggleSourceEnabled(source)

        XCTAssertEqual(api.updatedSources.count, 1)
        XCTAssertEqual(api.updatedSources[0].id, 7)
        XCTAssertEqual(api.updatedSources[0].request.name, "Source A")
        XCTAssertEqual(api.updatedSources[0].request.api, "https://source-a.example/api")
        XCTAssertEqual(api.updatedSources[0].request.detail, "https://source-a.example")
        XCTAssertEqual(api.updatedSources[0].request.comment, "keep")
        XCTAssertEqual(api.updatedSources[0].request.enabled, true)
        XCTAssertEqual(api.updatedSources[0].request.isAdult, true)
    }

    func testCreateUserSendsAllowAdultContentPolicy() async {
        let api = AdminAPIFake()
        let vm = AdminViewModel(apiClient: api, currentUserId: 1)

        await vm.createUser(username: "viewer", password: "pass", role: "user", allowAdultContent: true)

        XCTAssertEqual(api.createdUsers.count, 1)
        XCTAssertEqual(api.createdUsers[0].username, "viewer")
        XCTAssertEqual(api.createdUsers[0].role, "user")
        XCTAssertEqual(api.createdUsers[0].allowAdultContent, true)
    }
}
