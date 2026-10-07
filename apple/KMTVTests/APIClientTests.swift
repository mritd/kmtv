import XCTest
@testable import KMTV

actor SearchProgressRecorder {
    private var progresses: [APIClient.SearchProgress] = []

    func append(_ progress: APIClient.SearchProgress) {
        progresses.append(progress)
    }

    func all() -> [APIClient.SearchProgress] {
        progresses
    }
}

actor SSEEventRecorder {
    private(set) var events: [String] = []

    func append(_ event: String, _ data: Data) {
        events.append("\(event)=\(String(decoding: data, as: UTF8.self))")
    }
}

/// Collects the rejected tokens posted with `.authExpired` while it is alive.
///
/// 在存活期间收集随 `.authExpired` 发送的被拒 token.
final class RejectedTokenRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: [String?] = []
    private var observer: (any NSObjectProtocol)?

    init() {
        observer = NotificationCenter.default.addObserver(forName: .authExpired, object: nil, queue: nil) { [weak self] note in
            let token = note.userInfo?[Notification.rejectedTokenKey] as? String
            self?.lock.withLock { self?.stored.append(token) }
        }
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }

    var tokens: [String?] { lock.withLock { stored } }
}

final class APIClientTests: XCTestCase {
    override func tearDown() {
        URLProtocolStub.requestHandler = nil
        super.tearDown()
    }

    func testBuildURL() throws {
        let client = APIClient(baseURL: "https://kmtv.example.com")
        let url = try client.buildURL(path: "/api/v1/search", query: ["q": "test", "page": "1"])
        XCTAssertEqual(url.scheme, "https")
        XCTAssertEqual(url.host, "kmtv.example.com")
        XCTAssertEqual(url.path, "/api/v1/search")
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        let queryItems = components.queryItems!.sorted { $0.name < $1.name }
        XCTAssertEqual(queryItems[0], URLQueryItem(name: "page", value: "1"))
        XCTAssertEqual(queryItems[1], URLQueryItem(name: "q", value: "test"))
    }

    func testBuildURLNoQuery() throws {
        let client = APIClient(baseURL: "https://kmtv.example.com")
        let url = try client.buildURL(path: "/api/v1/auth/me")
        XCTAssertEqual(url.absoluteString, "https://kmtv.example.com/api/v1/auth/me")
    }

    func testBuildURLTrailingSlash() throws {
        let client = APIClient(baseURL: "https://kmtv.example.com/")
        let url = try client.buildURL(path: "/api/v1/auth/me")
        XCTAssertEqual(url.path, "/api/v1/auth/me")
    }

    func testBuildImageProxyURL() {
        let client = APIClient(baseURL: "https://kmtv.example.com")
        let url = client.buildImageProxyURL(imageURL: "https://img2.doubanio.com/pic.jpg")
        XCTAssertTrue(url.absoluteString.contains("/api/v1/proxy/image"))
        XCTAssertTrue(url.absoluteString.contains("url="))
    }

    func testPerformAddsBearerAuthorizationHeader() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [URLProtocolStub.self]
        let client = APIClient(
            baseURL: "https://kmtv.example.com",
            session: URLSession(configuration: config),
            tokenProvider: { "Base58AccessToken" }
        )

        URLProtocolStub.requestHandler = { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer Base58AccessToken")
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (response, #"{"message":"ok"}"#.data(using: .utf8)!)
        }

        let response: MessageResponse = try await client.get("/api/v1/settings")
        XCTAssertEqual(response.message, "ok")
    }

    func testPerformMapsBackendErrorCodeToServerError() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [URLProtocolStub.self]
        let client = APIClient(
            baseURL: "https://kmtv.example.com",
            session: URLSession(configuration: config),
            tokenProvider: { "AccessToken" }
        )
        URLProtocolStub.requestHandler = { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer AccessToken")
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 403,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let data = #"{"code":1204,"error":"missing"}"#.data(using: .utf8)!
            return (response, data)
        }

        do {
            let _: MessageResponse = try await client.get("/api/v1/settings")
            XCTFail("expected server error")
        } catch APIError.serverError(let status, let code, let message) {
            XCTAssertEqual(status, 403)
            XCTAssertEqual(code, 1204)
            XCTAssertEqual(message, "missing")
        }
    }

    func testPerformWrapsDecodingFailure() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [URLProtocolStub.self]
        let client = APIClient(baseURL: "https://kmtv.example.com", session: URLSession(configuration: config))
        URLProtocolStub.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (response, Data("not-json".utf8))
        }

        do {
            let _: MessageResponse = try await client.get("/api/v1/settings")
            XCTFail("expected decoding error")
        } catch APIError.decodingError {
            // Expected path.
        }
    }

    func testPerformWrapsNetworkFailure() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [URLProtocolStub.self]
        let client = APIClient(baseURL: "https://kmtv.example.com", session: URLSession(configuration: config))
        URLProtocolStub.requestHandler = { _ in
            throw URLError(.notConnectedToInternet)
        }

        do {
            let _: MessageResponse = try await client.get("/api/v1/settings")
            XCTFail("expected network error")
        } catch APIError.networkError(let error as URLError) {
            XCTAssertEqual(error.code, .notConnectedToInternet)
        }
    }

    func testPerformUsesRawBodyForUnstructuredServerError() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [URLProtocolStub.self]
        let client = APIClient(baseURL: "https://kmtv.example.com", session: URLSession(configuration: config))
        URLProtocolStub.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 502, httpVersion: nil, headerFields: nil)!
            return (response, Data("bad gateway".utf8))
        }

        do {
            let _: MessageResponse = try await client.get("/api/v1/settings")
            XCTFail("expected server error")
        } catch APIError.serverError(let status, let code, let message) {
            XCTAssertEqual(status, 502)
            XCTAssertEqual(code, 1300)
            XCTAssertEqual(message, "bad gateway")
        }
    }

    func testSearchStreamParsesProgressAndResultEvents() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [URLProtocolStub.self]
        let client = APIClient(baseURL: "https://kmtv.example.com", session: URLSession(configuration: config))
        URLProtocolStub.requestHandler = { request in
            XCTAssertEqual(request.url?.path, "/api/v1/search/stream")
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            let body = """
            event: progress
            data: {"phase":"searching","completed":1,"total":2}
            event: result
            data: {"results":[]}
            """
            return (response, Data(body.utf8))
        }

        let progressRecorder = SearchProgressRecorder()
        let response = try await client.searchStream(query: "movie", page: 1) { progress in
            await progressRecorder.append(progress)
        }
        let progresses = await progressRecorder.all()

        XCTAssertEqual(response.results.count, 0)
        XCTAssertEqual(progresses.first?.phase, "searching")
        XCTAssertEqual(progresses.first?.completed, 1)
    }

    func testSearchStreamThrowsWhenStreamEndsWithoutResult() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [URLProtocolStub.self]
        let client = APIClient(baseURL: "https://kmtv.example.com", session: URLSession(configuration: config))
        URLProtocolStub.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (response, Data("event: progress\ndata: {\"phase\":\"searching\",\"completed\":1,\"total\":1}".utf8))
        }

        do {
            _ = try await client.searchStream(query: "movie", page: 1) { _ in }
            XCTFail("expected missing result error")
        } catch APIError.serverError(_, let code, let message) {
            XCTAssertEqual(code, 1300)
            XCTAssertTrue(message.contains("SSE stream ended without result"))
        }
    }

    @MainActor
    func testPerformPostsAuthExpiredNotificationOnUnauthorized() async {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [URLProtocolStub.self]
        let client = APIClient(
            baseURL: "https://kmtv.example.com",
            session: URLSession(configuration: config),
            tokenProvider: { "Base58AccessToken" }
        )

        URLProtocolStub.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 401, httpVersion: nil, headerFields: nil)!
            return (response, #"{"code":1002,"error":"not logged in"}"#.data(using: .utf8)!)
        }

        let exp = expectation(forNotification: .authExpired, object: nil)
        do {
            let _: MessageResponse = try await client.get("/api/v1/auth/me")
            XCTFail("Expected unauthorized error")
        } catch {
            XCTAssertNotNil(error as? APIError)
        }
        await fulfillment(of: [exp], timeout: 1)
    }

    func testSyncPullBuildsQuery() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [URLProtocolStub.self]
        let client = APIClient(
            baseURL: "https://kmtv.example.com",
            session: URLSession(configuration: config),
            tokenProvider: { "AccessToken" }
        )
        URLProtocolStub.requestHandler = { request in
            let url = request.url!
            XCTAssertEqual(url.path, "/api/v1/sync/pull")
            let items = Set(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? [])
            XCTAssertEqual(items, [URLQueryItem(name: "since", value: "4"), URLQueryItem(name: "limit", value: "500"),
                                   URLQueryItem(name: "epoch", value: "e1")])
            XCTAssertNil(items.first { $0.name == "full" })
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!
            let body = #"{"epoch":"e1","server_time_ms":1,"rev":4,"reset":false,"has_more":false,"clears":[],"records":[]}"#
            return (response, Data(body.utf8))
        }

        let page = try await client.syncPull(since: 4, epoch: "e1", limit: 500, full: false)
        XCTAssertEqual(page.rev, 4)
    }

    func testSyncPullSendsFullOnlyWhenRequested() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [URLProtocolStub.self]
        let client = APIClient(
            baseURL: "https://kmtv.example.com",
            session: URLSession(configuration: config),
            tokenProvider: { "AccessToken" }
        )
        URLProtocolStub.requestHandler = { request in
            let url = request.url!
            let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            XCTAssertEqual(items.first { $0.name == "full" }?.value, "1")
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!
            let body = #"{"epoch":"e1","server_time_ms":1,"rev":0,"reset":false,"has_more":false,"clears":[],"records":[]}"#
            return (response, Data(body.utf8))
        }
        _ = try await client.syncPull(since: 0, epoch: "", limit: 500, full: true)
    }

    func testSyncPushBodyIsEncodedWithoutEscapingSlashes() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [URLProtocolStub.self]
        let client = APIClient(
            baseURL: "https://kmtv.example.com",
            session: URLSession(configuration: config),
            tokenProvider: { "AccessToken" }
        )
        let change = SyncChangeWire(kind: .favorite, op: .upsert, key: "a/b",
                                    payload: .favorite(FavoritePayload(title: "a/b", cover: "https://img.example/a/b.jpg")),
                                    eventTimeMs: 5)
        let request = SyncPushRequest(epoch: "e1", cursor: 0, changes: [change])
        var sent = 0
        var escaped = false
        URLProtocolStub.requestHandler = { req in
            var data = req.httpBody ?? Data()
            if data.isEmpty, let stream = req.httpBodyStream {
                stream.open()
                defer { stream.close() }
                var buffer = [UInt8](repeating: 0, count: 4096)
                while stream.hasBytesAvailable {
                    let n = stream.read(&buffer, maxLength: buffer.count)
                    if n <= 0 { break }
                    data.append(buffer, count: n)
                }
            }
            sent = data.count
            escaped = String(decoding: data, as: UTF8.self).contains("\\/")
            let response = HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (response, Data(#"{"epoch":"e1","rev":0,"server_time_ms":1,"results":[]}"#.utf8))
        }
        _ = try await client.syncPush(request)

        // The batch budget is measured without slash escaping, so the wire body must match it.
        //
        // 批次预算按不转义斜杠计算, 因此实际请求体必须与之一致.
        let encoder = JSONEncoder()
        encoder.outputFormatting = .withoutEscapingSlashes
        XCTAssertEqual(sent, try encoder.encode(request).count)
        XCTAssertFalse(escaped)
    }

    private func stubbedClient(token: String? = nil) -> APIClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [URLProtocolStub.self]
        return APIClient(baseURL: "https://kmtv.example.com", session: URLSession(configuration: config),
                         tokenProvider: { token })
    }

    @MainActor
    func testUnauthorizedPostsTheRejectedToken() async {
        let client = stubbedClient(token: "OldToken")
        URLProtocolStub.requestHandler = { request in
            (HTTPURLResponse(url: request.url!, statusCode: 401, httpVersion: nil, headerFields: nil)!,
             Data(#"{"code":1002,"error":"not logged in"}"#.utf8))
        }
        let recorder = RejectedTokenRecorder()
        _ = try? await client.me()
        XCTAssertEqual(recorder.tokens, ["OldToken"])
    }

    func testSSEJoinsMultiLineDataAndAcceptsFieldsWithoutASpace() async throws {
        let client = stubbedClient()
        URLProtocolStub.requestHandler = { request in
            let body = """
            : comment
            event:progress
            data:{"a":1,
            data: "b":2}
            event: result
            data: {"c":3}
            """
            return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, Data(body.utf8))
        }
        let recorder = SSEEventRecorder()
        try await client.sseStream(path: "/api/v1/search/stream") { event, data in
            await recorder.append(event, data)
        }
        let events = await recorder.events
        XCTAssertEqual(events, ["progress={\"a\":1,\n\"b\":2}", "result={\"c\":3}"])
    }

    @MainActor
    func testSSEErrorsMapLikeOtherRequests() async {
        let client = stubbedClient(token: "SSEToken")
        URLProtocolStub.requestHandler = { request in
            (HTTPURLResponse(url: request.url!, statusCode: 403, httpVersion: nil, headerFields: nil)!,
             Data(#"{"code":1302,"error":"blocked"}"#.utf8))
        }
        do {
            try await client.sseStream(path: "/api/v1/search/stream") { _, _ in }
            XCTFail("expected an error")
        } catch APIError.serverError(let status, let code, let message) {
            XCTAssertEqual(status, 403)
            XCTAssertEqual(code, 1302)
            XCTAssertEqual(message, "blocked")
        } catch {
            XCTFail("unexpected \(error)")
        }

        URLProtocolStub.requestHandler = { request in
            (HTTPURLResponse(url: request.url!, statusCode: 401, httpVersion: nil, headerFields: nil)!,
             Data(#"{"code":1002,"error":"token expired"}"#.utf8))
        }
        let recorder = RejectedTokenRecorder()
        do {
            try await client.sseStream(path: "/api/v1/search/stream") { _, _ in }
            XCTFail("expected an error")
        } catch APIError.serverError(let status, _, let message) {
            XCTAssertEqual(status, 401)
            XCTAssertEqual(message, "token expired")
        } catch {
            XCTFail("unexpected \(error)")
        }
        XCTAssertEqual(recorder.tokens, ["SSEToken"])
    }

    func testAvatarFilenameFollowsTheMimeType() {
        XCTAssertEqual(APIClient.avatarFilename(mimeType: "image/png"), "avatar.png")
        XCTAssertEqual(APIClient.avatarFilename(mimeType: "image/gif"), "avatar.gif")
        XCTAssertTrue(APIClient.avatarFilename(mimeType: "image/jpeg").hasPrefix("avatar.jp"))
    }
}
