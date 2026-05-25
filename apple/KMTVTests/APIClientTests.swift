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
}
