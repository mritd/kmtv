import Foundation

/// Authentication API surface used by app and profile state.
/// App 与个人资料状态使用的认证 API 边界.
protocol AuthAPIProtocol: Sendable {
    /// Logs in and returns a bearer token response.
    /// 登录并返回 bearer token 响应.
    func login(username: String, password: String) async throws -> LoginResponse
    /// Logs out the current bearer token.
    /// 注销当前 bearer token.
    func logout(timeoutInterval: TimeInterval?) async throws
    /// Returns the current authenticated user.
    /// 返回当前已认证用户.
    func me() async throws -> User
    /// Updates current user profile.
    /// 更新当前用户资料.
    func updateProfile(username: String) async throws -> User
    /// Changes current user password.
    /// 修改当前用户密码.
    func changePassword(oldPassword: String, newPassword: String) async throws
    /// Deletes current user avatar.
    /// 删除当前用户头像.
    func deleteAvatar() async throws -> User
    /// Uploads current user avatar.
    /// 上传当前用户头像.
    func uploadAvatar(imageData: Data, mimeType: String) async throws -> User
}

/// Search API surface used by search screens.
/// 搜索页面使用的 API 边界.
protocol SearchAPIProtocol: Sendable {
    /// Runs a normal paged search.
    /// 执行普通分页搜索.
    func search(query: String, page: Int) async throws -> SearchResponse
    /// Runs a streaming search with progress callbacks.
    /// 执行带进度回调的流式搜索.
    func searchStream(query: String, page: Int, onProgress: @escaping @Sendable (APIClient.SearchProgress) async -> Void) async throws -> SearchResponse
}

extension SearchAPIProtocol {
    /// Runs a first-page normal search.
    /// 执行第一页普通搜索.
    func search(query: String) async throws -> SearchResponse {
        try await search(query: query, page: 1)
    }

    /// Runs a first-page streaming search.
    /// 执行第一页流式搜索.
    func searchStream(query: String, onProgress: @escaping @Sendable (APIClient.SearchProgress) async -> Void) async throws -> SearchResponse {
        try await searchStream(query: query, page: 1, onProgress: onProgress)
    }
}

/// Detail API surface used by playback source switching.
/// 播放源切换使用的详情 API 边界.
protocol DetailAPIProtocol: Sendable {
    /// Fetches detail for one source-video pair.
    /// 获取单个 source-video 对应的详情.
    func detail(sourceKey: String, videoId: String) async throws -> VideoDetail
}

/// Playback URL API surface used before AVPlayer receives media URLs.
/// AVPlayer 接收媒体地址前使用的播放 URL API 边界.
protocol PlaybackAPIProtocol: Sendable {
    /// Resolves a raw episode URL into a playable URL.
    /// 将原始分集地址解析为可播放地址.
    func playbackURL(url: String, source: String) async throws -> PlaybackURLResponse
}

/// Douban discovery API surface used by home and category screens.
/// 首页与分类页面使用的 Douban 发现 API 边界.
protocol DoubanAPIProtocol: Sendable {
    /// Fetches discovery home sections.
    /// 获取发现首页分区.
    func doubanHome() async throws -> DoubanHomeResponse
    /// Fetches category filter metadata.
    /// 获取分类筛选元数据.
    func doubanCategories() async throws -> DoubanCategoriesResponse
    /// Fetches a filtered recommendation page.
    /// 获取带筛选条件的推荐分页.
    func doubanRecommend(kind: String, tag: String, format: String, region: String, start: Int, count: Int) async throws -> DoubanListResponse
}

extension DoubanAPIProtocol {
    /// Fetches a recommendation page with default empty filters.
    /// 使用默认空筛选条件获取推荐分页.
    func doubanRecommend(kind: String, tag: String = "", format: String = "", region: String = "", start: Int = 0, count: Int = 20) async throws -> DoubanListResponse {
        try await doubanRecommend(kind: kind, tag: tag, format: format, region: region, start: start, count: count)
    }
}

/// Admin API surface used by the admin view model.
/// 管理页面视图模型使用的管理 API 边界.
protocol AdminAPIProtocol: Sendable {
    /// Lists all video sources.
    /// 获取全部视频源.
    func listSources() async throws -> SourcesResponse
    /// Updates one video source.
    /// 更新单个视频源.
    func updateSource(id: Int, _ req: UpdateSourceRequest) async throws
    /// Triggers health checks for all sources.
    /// 触发全部视频源健康检查.
    func checkAllSources() async throws
    /// Deletes one video source.
    /// 删除单个视频源.
    func deleteSource(id: Int) async throws
    /// Lists all source subscriptions.
    /// 获取全部视频源订阅.
    func listSubscriptions() async throws -> SubscriptionsResponse
    /// Creates one source subscription.
    /// 创建单个视频源订阅.
    func createSubscription(_ req: CreateSubscriptionRequest) async throws -> Subscription
    /// Triggers one subscription sync.
    /// 触发单个订阅同步.
    func syncSubscription(id: Int) async throws
    /// Deletes one source subscription.
    /// 删除单个视频源订阅.
    func deleteSubscription(id: Int) async throws
    /// Lists all users.
    /// 获取全部用户.
    func listUsers() async throws -> UsersResponse
    /// Creates one user.
    /// 创建单个用户.
    func createUser(_ req: CreateUserRequest) async throws -> User
    /// Deletes one user.
    /// 删除单个用户.
    func deleteUser(id: Int) async throws
    /// Fetches settings visible to the current caller.
    /// 获取当前调用方可见的设置.
    func getSettings() async throws -> SettingsResponse
    /// Updates admin settings.
    /// 更新管理设置.
    func updateSettings(_ settings: [String: String]) async throws
}

/// Combined playback dependencies needed by PlayerViewModel.
/// PlayerViewModel 需要的播放相关组合依赖.
typealias PlaybackDetailAPIProtocol = DetailAPIProtocol & PlaybackAPIProtocol
/// Full API surface implemented by APIClient.
/// APIClient 实现的完整 API 边界.
typealias AppAPIProtocol = AuthAPIProtocol & SearchAPIProtocol & DetailAPIProtocol & PlaybackAPIProtocol & DoubanAPIProtocol & AdminAPIProtocol

extension APIClient: AppAPIProtocol {}
