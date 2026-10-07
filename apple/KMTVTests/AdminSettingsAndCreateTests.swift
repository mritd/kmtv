import XCTest
@testable import KMTV

/// An admin API whose writes can be made to fail.
///
/// 写操作可以被设为失败的管理 API.
private final class FailingAdminAPI: AdminAPIProtocol, @unchecked Sendable {
    var failWrites = false
    var settings: [String: String] = [:]
    var updateCalls: [[String: String]] = []
    var deletedUserIds: [Int] = []
    var userListCalls = 0

    func listSources() async throws -> SourcesResponse { SourcesResponse(sources: []) }
    func updateSource(id: Int, _ req: UpdateSourceRequest) async throws {}
    func checkAllSources() async throws {}
    func deleteSource(id: Int) async throws {}
    func listSubscriptions() async throws -> SubscriptionsResponse { SubscriptionsResponse(subscriptions: []) }
    func createSubscription(_ req: CreateSubscriptionRequest) async throws -> Subscription {
        if failWrites { throw APIError.serverError(500, 500, "boom") }
        return Subscription(id: 1, url: req.url, autoUpdate: req.autoUpdate, interval: req.interval, lastSync: nil, updatedAt: nil)
    }
    func syncSubscription(id: Int) async throws {}
    func deleteSubscription(id: Int) async throws {}
    func listUsers() async throws -> UsersResponse { userListCalls += 1; return UsersResponse(users: []) }
    func createUser(_ req: CreateUserRequest) async throws -> User {
        if failWrites { throw APIError.serverError(500, 500, "boom") }
        return User(id: 2, username: req.username, role: req.role)
    }
    func deleteUser(id: Int) async throws { deletedUserIds.append(id) }
    func getSettings() async throws -> SettingsResponse { SettingsResponse(settings: settings) }
    func updateSettings(_ settings: [String: String]) async throws {
        updateCalls.append(settings)
        if failWrites { throw APIError.serverError(500, 500, "boom") }
    }
}

@MainActor
final class AdminSettingsAndCreateTests: XCTestCase {
    func testFailedCreateUserReturnsFalseAndKeepsErrorForTheSheet() async {
        let api = FailingAdminAPI()
        api.failWrites = true
        let vm = AdminViewModel(apiClient: api, currentUserId: 1)

        let created = await vm.createUser(username: "a", password: "p", role: "user", allowAdultContent: false)

        XCTAssertFalse(created)
        XCTAssertNotNil(vm.createError)
        XCTAssertNil(vm.error, "the error shows inside the sheet, not in the parent alert")
        XCTAssertEqual(api.userListCalls, 0)
    }

    func testFailedCreateSubscriptionReturnsFalseAndSuccessClearsError() async {
        let api = FailingAdminAPI()
        api.failWrites = true
        let vm = AdminViewModel(apiClient: api, currentUserId: 1)

        let failed = await vm.createSubscription(url: "https://x.example/s.json", interval: 60, autoUpdate: true)
        XCTAssertFalse(failed)
        XCTAssertNotNil(vm.createError)

        api.failWrites = false
        let created = await vm.createSubscription(url: "https://x.example/s.json", interval: 60, autoUpdate: true)
        XCTAssertTrue(created)
        XCTAssertNil(vm.createError)
    }

    func testFailedSettingUpdateRestoresPreviousValue() async {
        let api = FailingAdminAPI()
        api.settings = ["playback_mode": "proxy"]
        let vm = AdminViewModel(apiClient: api, currentUserId: 1)
        await vm.loadSettings()
        api.failWrites = true

        await vm.updateSetting(key: "playback_mode", value: "direct")
        await vm.updateSetting(key: "ad_filter_enabled", value: "true")

        XCTAssertEqual(vm.settings["playback_mode"], "proxy")
        XCTAssertNil(vm.settings["ad_filter_enabled"])
        XCTAssertNotNil(vm.error)
    }

    func testValueOfDefaultsWhenServerHasNone() async {
        let vm = AdminViewModel(apiClient: FailingAdminAPI(), currentUserId: 1)
        vm.settings["douban_image_proxy"] = ""

        XCTAssertEqual(vm.value(of: .playbackMode), "proxy")
        XCTAssertEqual(vm.value(of: .imageProxy), "server")
        XCTAssertEqual(vm.value(of: .mediaTokenTTL), "21600")
        XCTAssertEqual(vm.value(of: .anonymousAccess), "false")
    }

    func testSetValueIsNoOpForTheEffectiveValue() async {
        let api = FailingAdminAPI()
        let vm = AdminViewModel(apiClient: api, currentUserId: 1)

        await vm.setValue("proxy", for: .playbackMode)
        XCTAssertTrue(api.updateCalls.isEmpty, "the default counts as the current value")

        await vm.setValue("direct", for: .playbackMode)
        await vm.setValue("direct", for: .playbackMode)
        XCTAssertEqual(api.updateCalls, [["playback_mode": "direct"]])
    }

    func testDeleteUsersReloadsOnceAndRejectsSelfDelete() async {
        let api = FailingAdminAPI()
        let vm = AdminViewModel(apiClient: api, currentUserId: 1)

        await vm.deleteUsers([User(id: 2, username: "b", role: "user"), User(id: 3, username: "c", role: "user")])
        XCTAssertEqual(api.deletedUserIds, [2, 3])
        XCTAssertEqual(api.userListCalls, 1)

        await vm.deleteUsers([User(id: 4, username: "d", role: "user"), User(id: 1, username: "me", role: "admin")])
        XCTAssertEqual(api.deletedUserIds, [2, 3], "a batch with the signed-in admin is rejected whole")
        XCTAssertEqual(vm.error, String(localized: "Cannot delete yourself"))
    }

    func testUserIsAdminAndRoleDisplayName() {
        let admin = User(id: 1, username: "a", role: "admin")
        let regular = User(id: 2, username: "b", role: "user")

        XCTAssertTrue(admin.isAdmin)
        XCTAssertFalse(regular.isAdmin)
        XCTAssertEqual(admin.roleDisplayName, String(localized: "Admin"))
        XCTAssertEqual(regular.roleDisplayName, String(localized: "Regular User"))
    }
}
