import Foundation
@testable import KMTV

final class PlaybackAPIFake: PlaybackAPIProtocol, DetailAPIProtocol, @unchecked Sendable {
    var detailResponse = VideoDetail(
        id: "video-1",
        title: "Video",
        type: "movie",
        year: "2026",
        cover: "",
        desc: "",
        director: "",
        actor: "",
        area: "",
        episodes: [[Episode(name: "EP1", url: "https://cdn.example/video.m3u8")]]
    )
    var playbackResponse = PlaybackURLResponse(
        mode: "proxy",
        url: "https://kmtv.example/api/v1/proxy/m3u8?mt=Base58MediaToken"
    )
    var playbackRequests: [(url: String, source: String)] = []

    func detail(sourceKey: String, videoId: String) async throws -> VideoDetail {
        detailResponse
    }

    func playbackURL(url: String, source: String) async throws -> PlaybackURLResponse {
        playbackRequests.append((url: url, source: source))
        return playbackResponse
    }
}

final class SearchAPIFake: SearchAPIProtocol, @unchecked Sendable {
    var streamResult = SearchResponse(results: [])
    var syncResult = SearchResponse(results: [])
    var streamError: Error?
    var syncCalled = false

    func search(query: String, page: Int) async throws -> SearchResponse {
        syncCalled = true
        return syncResult
    }

    func searchStream(
        query: String,
        page: Int,
        onProgress: @escaping @Sendable (APIClient.SearchProgress) async -> Void
    ) async throws -> SearchResponse {
        if let streamError { throw streamError }
        await onProgress(APIClient.SearchProgress(phase: "searching", completed: 1, total: 2))
        return streamResult
    }
}

final class AdminAPIFake: AdminAPIProtocol, @unchecked Sendable {
    var settings = SettingsResponse(settings: [:])
    var updatedSettings: [[String: String]] = []
    var sources = SourcesResponse(sources: [])
    var subscriptions = SubscriptionsResponse(subscriptions: [])
    var users = UsersResponse(users: [])
    var updatedSources: [(id: Int, request: UpdateSourceRequest)] = []
    var createdUsers: [CreateUserRequest] = []

    func listSources() async throws -> SourcesResponse { sources }
    func updateSource(id: Int, _ req: UpdateSourceRequest) async throws {
        updatedSources.append((id: id, request: req))
    }
    func checkAllSources() async throws {}
    func deleteSource(id: Int) async throws {}
    func listSubscriptions() async throws -> SubscriptionsResponse { subscriptions }
    func createSubscription(_ req: CreateSubscriptionRequest) async throws -> Subscription {
        Subscription(id: 1, url: req.url, autoUpdate: req.autoUpdate, interval: req.interval, lastSync: nil, updatedAt: nil)
    }
    func syncSubscription(id: Int) async throws {}
    func deleteSubscription(id: Int) async throws {}
    func listUsers() async throws -> UsersResponse { users }
    func createUser(_ req: CreateUserRequest) async throws -> User {
        createdUsers.append(req)
        return User(id: 2, username: req.username, role: req.role, allowAdultContent: req.allowAdultContent, avatar: nil)
    }
    func deleteUser(id: Int) async throws {}
    func getSettings() async throws -> SettingsResponse { settings }
    func updateSettings(_ settings: [String: String]) async throws {
        updatedSettings.append(settings)
    }
}

final class DoubanAPIFake: DoubanAPIProtocol, @unchecked Sendable {
    var home = DoubanHomeResponse(sections: [])
    var homeError: Error?
    var categories = DoubanCategoriesResponse(categories: [])
    var recommend = DoubanListResponse(items: [])
    var recommendResponses: [DoubanListResponse] = []
    var recommendRequests: [(kind: String, tag: String, format: String, region: String, start: Int, count: Int)] = []

    func doubanHome() async throws -> DoubanHomeResponse {
        if let homeError { throw homeError }
        return home
    }
    func doubanCategories() async throws -> DoubanCategoriesResponse { categories }
    func doubanRecommend(
        kind: String,
        tag: String,
        format: String,
        region: String,
        start: Int,
        count: Int
    ) async throws -> DoubanListResponse {
        recommendRequests.append((kind: kind, tag: tag, format: format, region: region, start: start, count: count))
        if !recommendResponses.isEmpty {
            return recommendResponses.removeFirst()
        }
        return recommend
    }
}

final class AuthAPIFake: AuthAPIProtocol, @unchecked Sendable {
    var user = User(id: 1, username: "admin", role: "admin", avatar: nil)
    var changedPassword: (old: String, new: String)?
    var uploadedAvatar: (bytes: Int, mimeType: String)?

    func login(username: String, password: String) async throws -> LoginResponse {
        throw APIError.serverError(501, 1300, "login is not used by these tests")
    }

    func logout(timeoutInterval: TimeInterval?) async throws {}

    func me() async throws -> User { user }

    func updateProfile(username: String) async throws -> User {
        user = User(id: user.id, username: username, role: user.role, allowAdultContent: user.allowAdultContent, avatar: user.avatar)
        return user
    }

    func changePassword(oldPassword: String, newPassword: String) async throws {
        changedPassword = (oldPassword, newPassword)
    }

    func deleteAvatar() async throws -> User {
        user.avatar = nil
        return user
    }

    func uploadAvatar(imageData: Data, mimeType: String) async throws -> User {
        uploadedAvatar = (imageData.count, mimeType)
        user.avatar = "/api/v1/auth/avatar"
        return user
    }
}
