import Foundation
import os

extension Notification.Name {
    /// Posted when an authenticated API request receives a token-expired response.
    /// 已认证 API 请求收到 token 过期响应时发送该通知.
    static let authExpired = Notification.Name("authExpired")
}

/// Concrete HTTP client for the KMTV backend API.
/// KMTV 后端 API 的具体 HTTP 客户端.
///
/// APIClient owns URL construction, bearer-token injection, JSON decoding, SSE streaming,
/// and shared media/image helper wiring. Feature-specific endpoint methods live in extension
/// files so each API surface stays small and testable through protocols.
/// APIClient 负责 URL 构造、bearer token 注入、JSON 解码、SSE 流读取以及媒体/图片 helper 连接。
/// 具体业务接口方法拆分在 extension 文件中，便于通过 protocol 做单元测试替换。
///
/// SAFETY: All stored properties are immutable (let). If adding var properties,
/// either use synchronization or remove @unchecked Sendable.
/// 安全性: 当前所有存储属性都是不可变 let. 如果后续新增 var, 需要加同步或移除 @unchecked Sendable.
final class APIClient: @unchecked Sendable {
    private let logger = Logger(subsystem: "com.mritd.kmtv", category: "network")
    let baseURL: String
    let session: URLSession
    private let tokenProvider: @Sendable () -> String?

    /// Lightweight request executor built from the shared session and token provider.
    /// 基于共享 session 与 token provider 构建的轻量请求执行器.
    private var executor: APIRequestExecutor {
        APIRequestExecutor(session: session, tokenProvider: tokenProvider, logger: logger)
    }

    /// Image helper that reuses this client's base URL and URLSession configuration.
    /// 复用当前客户端 base URL 与 URLSession 配置的图片 helper.
    private var imageClient: ImageClient {
        ImageClient(baseURL: baseURL, sessionConfiguration: session.configuration)
    }

    /// Creates an API client for a backend base URL.
    /// 使用后端 base URL 创建 API 客户端.
    ///
    /// The base URL is normalized by removing a trailing slash. If no session is injected,
    /// a cookie-disabled URLSession is created because KMTV uses opaque bearer tokens instead
    /// of cookie sessions.
    /// base URL 会移除末尾斜杠做归一化. 如果没有注入 session, 会创建禁用 cookie 的 URLSession,
    /// 因为 KMTV 使用 opaque bearer token, 不再使用 cookie session.
    init(
        baseURL: String,
        session: URLSession? = nil,
        tokenProvider: @escaping @Sendable () -> String? = { nil }
    ) {
        self.baseURL = baseURL.hasSuffix("/") ? String(baseURL.dropLast()) : baseURL
        self.tokenProvider = tokenProvider
        if let session {
            self.session = session
        } else {
            // Disable cookies because bearer auth is the only supported API credential path.
            // 禁用 cookie, 因为 API 认证只通过 bearer token 传递.
            let config = URLSessionConfiguration.default
            config.httpCookieAcceptPolicy = .never
            config.httpShouldSetCookies = false
            self.session = URLSession(configuration: config)
        }
    }

    /// Builds a backend URL from a path and optional query parameters.
    /// 根据 path 和可选 query 参数构造后端 URL.
    ///
    /// Paths are expected to start with `/api/v1` or another absolute backend path.
    /// path 应以 `/api/v1` 或其他后端绝对路径开头.
    func buildURL(path: String, query: [String: String]? = nil) throws -> URL {
        guard var components = URLComponents(string: baseURL + path) else {
            throw APIError.invalidURL
        }
        if let query, !query.isEmpty {
            components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        guard let url = components.url else {
            throw APIError.invalidURL
        }
        return url
    }

    /// Builds a proxied image URL for untrusted remote images.
    /// 为不可信远程图片构造后端代理 URL.
    func buildImageProxyURL(imageURL: String) -> URL {
        imageClient.buildImageProxyURL(imageURL: imageURL)
    }

    /// Configures Kingfisher to use the same cache and downloader policy as the API client.
    /// 配置 Kingfisher 使用与 API 客户端一致的缓存和下载策略.
    func configureKingfisher() {
        imageClient.configureKingfisher()
    }

    // MARK: - HTTP Methods

    /// Sends a GET request and decodes the JSON response.
    /// 发送 GET 请求并解码 JSON 响应.
    func get<T: Decodable>(_ path: String, query: [String: String]? = nil) async throws -> T {
        let url = try buildURL(path: path, query: query)
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        return try await perform(request)
    }

    /// Sends a POST request with an optional JSON body and decodes the JSON response.
    /// 发送带可选 JSON body 的 POST 请求并解码 JSON 响应.
    func post<T: Decodable>(_ path: String, body: (some Encodable)? = Optional<String>.none) async throws -> T {
        let url = try buildURL(path: path)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        if let body {
            request.httpBody = try JSONEncoder().encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return try await perform(request)
    }

    /// Sends a PUT request with a JSON body and decodes the JSON response.
    /// 发送带 JSON body 的 PUT 请求并解码 JSON 响应.
    func put<T: Decodable>(_ path: String, body: some Encodable) async throws -> T {
        let url = try buildURL(path: path)
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.httpBody = try JSONEncoder().encode(body)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return try await perform(request)
    }

    /// Sends a DELETE request that returns the standard message response.
    /// 发送返回标准 message 响应的 DELETE 请求.
    func delete(_ path: String) async throws -> MessageResponse {
        let url = try buildURL(path: path)
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        return try await perform(request)
    }

    /// Sends a DELETE request and decodes a custom JSON response type.
    /// 发送 DELETE 请求并解码自定义 JSON 响应类型.
    func deleteReturning<T: Decodable>(_ path: String) async throws -> T {
        let url = try buildURL(path: path)
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        return try await perform(request)
    }

    /// Sends a POST request with already-encoded bytes.
    /// 发送 body 已经编码完成的 POST 请求.
    func postRaw<T: Decodable>(_ path: String, body: Data, contentType: String = "application/json") async throws -> T {
        let url = try buildURL(path: path)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        return try await perform(request)
    }

    /// Fetches protected binary data with the same bearer auth pipeline.
    /// 使用相同 bearer 认证链路获取受保护的二进制数据.
    func getData(_ path: String) async throws -> Data {
        let url = try buildURL(path: path)
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        return try await performData(request)
    }

    /// Uploads a user avatar using multipart/form-data.
    /// 使用 multipart/form-data 上传用户头像.
    ///
    /// APIClient constructs the multipart body directly to avoid adding a production
    /// dependency for one small upload endpoint.
    /// 这里直接构造 multipart body, 避免为单个小上传接口新增生产依赖.
    func uploadAvatar(imageData: Data, mimeType: String) async throws -> User {
        let url = try buildURL(path: "/api/v1/auth/avatar")
        let boundary = UUID().uuidString
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"avatar\"; filename=\"avatar.jpg\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: \(mimeType)\r\n\r\n".data(using: .utf8)!)
        body.append(imageData)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        request.httpBody = body

        return try await perform(request)
    }

    // MARK: - SSE Stream

    /// Reads an SSE stream line-by-line, calling onEvent for each parsed event.
    /// Returns when the stream ends or an error occurs.
    /// The async onEvent callback is awaited for each event, ensuring the caller
    /// can perform MainActor updates before the next event is processed.
    /// 逐行读取 SSE 流并回调解析后的事件, 回调会被顺序 await, 确保 MainActor 更新先完成.
    func sseStream(
        path: String,
        query: [String: String]? = nil,
        onEvent: @escaping @Sendable (String, Data) async -> Void
    ) async throws {
        let url = try buildURL(path: path, query: query)
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        try await SSEClient(session: session, executor: executor, logger: logger).stream(request: request, onEvent: onEvent)
    }

    // MARK: - Core request

    /// Executes a request and returns validated response bytes.
    /// 执行请求并返回已校验的响应字节.
    private func performData(_ request: URLRequest) async throws -> Data {
        try await executor.data(for: request)
    }

    /// Executes a request and decodes its JSON response.
    /// 执行请求并解码 JSON 响应.
    func perform<T: Decodable>(_ request: URLRequest) async throws -> T {
        try await executor.decode(T.self, from: request)
    }
}
