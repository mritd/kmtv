import XCTest
@testable import KMTV

/// A server failure with a known message.
///
/// 带有已知提示的服务端失败.
private func serverFailure() -> APIError { .serverError(500, 1300, "upstream down") }

/// A request URLSession cancelled, as the API client reports it.
///
/// 被 URLSession 取消的请求, 即 API 客户端报告的形式.
private func cancelledFailure() -> APIError { .networkError(URLError(.cancelled)) }

/// Fails every Douban call with `error`.
///
/// 让每个豆瓣请求都以 `error` 失败.
private struct FailingDoubanAPI: DoubanAPIProtocol {
    let failure: @Sendable () -> Error

    init(_ failure: @escaping @Sendable () -> Error) {
        self.failure = failure
    }

    func doubanHome() async throws -> DoubanHomeResponse { throw failure() }
    func doubanCategories() async throws -> DoubanCategoriesResponse { throw failure() }
    func doubanRecommend(kind: String, tag: String, format: String, region: String, start: Int,
                         count: Int) async throws -> DoubanListResponse { throw failure() }
}

/// Fails both the streaming and the plain search with `error`.
///
/// 让流式搜索与普通搜索都以 `error` 失败.
private struct FailingSearchAPI: SearchAPIProtocol {
    let failure: @Sendable () -> Error

    init(_ failure: @escaping @Sendable () -> Error) {
        self.failure = failure
    }

    func search(query: String, page: Int) async throws -> SearchResponse { throw failure() }
    func searchStream(query: String, page: Int,
                      onProgress: @escaping @Sendable (APIClient.SearchProgress) async -> Void) async throws -> SearchResponse {
        throw failure()
    }
}

/// Fails profile edits with `error`.
///
/// 让个人资料修改以 `error` 失败.
private struct FailingProfileAPI: ProfileAPIProtocol {
    let failure: @Sendable () -> Error

    init(_ failure: @escaping @Sendable () -> Error) {
        self.failure = failure
    }

    func login(username: String, password: String) async throws -> LoginResponse { throw failure() }
    func logout(timeoutInterval: TimeInterval?) async throws {}
    func me() async throws -> User { throw failure() }
    func updateProfile(username: String) async throws -> User { throw failure() }
    func changePassword(oldPassword: String, newPassword: String) async throws { throw failure() }
    func deleteAvatar() async throws -> User { throw failure() }
    func uploadAvatar(imageData: Data, mimeType: String) async throws -> User { throw failure() }
}

/// Covers what the view models show the user on error paths, through an injected `ToastPresenting`.
///
/// 通过注入的 `ToastPresenting` 覆盖视图模型在错误路径上向用户展示的内容.
@MainActor
final class ToastPresentingTests: XCTestCase {
    private static let coverSuite = "ToastPresentingTests.covers"
    private let serverError = serverFailure()
    private let cancelledRequest = cancelledFailure()

    override func tearDown() async throws {
        clearCoverRegistrySuite(Self.coverSuite)
    }

    // MARK: - Error.userMessage

    func testUserMessageSkipsCancellations() {
        XCTAssertNil(CancellationError().userMessage)
        XCTAssertNil(URLError(.cancelled).userMessage)
        XCTAssertNil(cancelledRequest.userMessage)
        XCTAssertNil(APIError.networkError(CancellationError()).userMessage)
        XCTAssertTrue(cancelledRequest.isCancellation)
        XCTAssertFalse(serverError.isCancellation)
    }

    func testUserMessageKeepsTheExistingText() {
        XCTAssertEqual(serverError.userMessage, serverError.localizedMessage)
        let offline = APIError.networkError(URLError(.notConnectedToInternet))
        XCTAssertEqual(offline.userMessage, offline.localizedMessage)
        let timedOut = URLError(.timedOut)
        XCTAssertEqual(timedOut.userMessage, timedOut.localizedDescription)
    }

    func testShowErrorSkipsCancellationsAndUsesTheErrorStyle() {
        let toasts = ToastRecorder()
        toasts.show(error: cancelledRequest)
        toasts.show(error: serverError)
        XCTAssertEqual(toasts.messages, [serverError.localizedMessage])
        XCTAssertEqual(toasts.shown.first?.style, .error)
    }

    // MARK: - View models

    func testCategoriesLoadFailureShowsItsMessage() async {
        let toasts = ToastRecorder()
        let vm = CategoriesViewModel(apiClient: FailingDoubanAPI(serverFailure), covers: nil, toasts: toasts)

        await vm.loadCategories()

        XCTAssertEqual(toasts.messages, [serverError.localizedMessage])
        XCTAssertFalse(vm.isLoading)
    }

    func testCategoriesCancelledRequestShowsNothing() async {
        let toasts = ToastRecorder()
        let vm = CategoriesViewModel(apiClient: FailingDoubanAPI(cancelledFailure), covers: nil, toasts: toasts)

        await vm.loadCategories()

        XCTAssertTrue(toasts.messages.isEmpty, "a cancelled request is not reported: \(toasts.messages)")
        XCTAssertFalse(vm.isLoading)
    }

    func testSearchFailureShowsItsMessage() async {
        let toasts = ToastRecorder()
        let vm = SearchViewModel(apiClient: FailingSearchAPI(serverFailure), syncStore: nil, syncEngine: nil,
                                 toasts: toasts)

        await vm.search(query: "Movie")

        XCTAssertEqual(toasts.messages, [serverError.localizedMessage])
        XCTAssertFalse(vm.isSearching)
        XCTAssertTrue(vm.hasSearched)
    }

    func testSearchCancelledRequestShowsNothing() async {
        let toasts = ToastRecorder()
        let vm = SearchViewModel(apiClient: FailingSearchAPI(cancelledFailure), syncStore: nil, syncEngine: nil,
                                 toasts: toasts)

        await vm.search(query: "Movie")

        XCTAssertTrue(toasts.messages.isEmpty, "a cancelled request is not reported: \(toasts.messages)")
    }

    func testProfileFailuresShowTheirMessages() async {
        let toasts = ToastRecorder()
        let failure = APIError.serverError(409, 1004, "taken")
        let api = FailingProfileAPI { APIError.serverError(409, 1004, "taken") }
        let vm = ProfileViewModel(apiClient: api, syncStore: nil,
                                  user: User(id: 1, username: "admin", role: "admin", avatar: nil), toasts: toasts)
        vm.editUsername = "kovacs"

        await vm.updateUsername()
        vm.passwordNew = "new"
        vm.passwordConfirm = "different"
        await vm.changePassword()
        await vm.pickAvatar { nil }

        XCTAssertEqual(toasts.messages, [
            failure.localizedMessage,
            String(localized: "Passwords don't match", bundle: .main),
            String(localized: "Could not load the selected photo", bundle: .main),
        ])
        XCTAssertNil(vm.successMessage)
    }

    func testHomeFailureStaysOnThePageOnIOS() async {
        let toasts = ToastRecorder()
        let vm = HomeViewModel(apiClient: FailingDoubanAPI(serverFailure), syncStore: nil, syncEngine: nil,
                               covers: nil, toasts: toasts)

        await vm.load()

        #if os(iOS)
        XCTAssertEqual(vm.error, serverError.localizedMessage)
        XCTAssertTrue(toasts.messages.isEmpty)
        #else
        XCTAssertEqual(toasts.messages, [serverError.localizedMessage])
        #endif
        XCTAssertFalse(vm.isLoading)
    }

    func testHomeCancelledRequestShowsNothing() async {
        let toasts = ToastRecorder()
        let vm = HomeViewModel(apiClient: FailingDoubanAPI(cancelledFailure), syncStore: nil, syncEngine: nil,
                               covers: nil, toasts: toasts)

        await vm.load()

        XCTAssertNil(vm.error)
        XCTAssertTrue(toasts.messages.isEmpty)
        XCTAssertFalse(vm.isLoading)
    }

    func testHomeLoadRegistersCoversInTheInjectedRegistry() async throws {
        let covers = try makeCoverRegistry(suite: Self.coverSuite)
        let api = DoubanAPIFake()
        api.home = DoubanHomeResponse(sections: [
            HomeSection(name: "Hot", tag: "hot", type: "movie", items: [
                DoubanItem(id: "1", title: "A", cover: "/api/v1/image?u=a", rate: "", year: ""),
            ]),
        ])
        let vm = HomeViewModel(apiClient: api, baseURL: "http://localhost:8081", syncStore: nil, syncEngine: nil,
                               covers: covers, toasts: ToastRecorder())

        await vm.load()

        XCTAssertEqual(covers.cover(for: "A")?.absoluteString, "http://localhost:8081/api/v1/image?u=a")
    }
}
