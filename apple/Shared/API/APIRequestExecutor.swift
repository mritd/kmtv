import Foundation
import os

/// Shared request executor that applies bearer auth and normalizes HTTP errors.
///
/// 统一执行请求, 注入 bearer 认证并归一化 HTTP 错误.
struct APIRequestExecutor: Sendable {
    let session: URLSession
    let tokenProvider: @Sendable () -> String?
    let logger: Logger

    /// Whether a 401 on a request that carried a bearer posts `.authExpired`. Download
    /// preparation runs without it, so a background download can never sign the user out.
    ///
    /// 携带 bearer 的请求收到 401 时是否发送 `.authExpired`. 下载准备不发送, 因此后台下载永远不会把
    /// 用户登出.
    var notifiesAuthExpired: Bool = true

    /// Adds the current opaque bearer token to API requests when available.
    ///
    /// 如果存在当前 opaque bearer token, 将其加入 API 请求.
    func authorize(_ request: inout URLRequest) {
        guard request.value(forHTTPHeaderField: "Authorization") == nil,
              let token = tokenProvider(),
              !token.isEmpty else {
            return
        }
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }

    /// Executes a request and returns validated response bytes.
    ///
    /// 执行请求并返回已通过 HTTP 状态校验的响应数据.
    func data(for input: URLRequest) async throws -> Data {
        var request = input
        authorize(&request)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            logger.error("\(request.httpMethod ?? "?") \(request.url?.path ?? "?") failed: \(error.localizedDescription)")
            throw APIError.networkError(error)
        }

        try await validate(response, body: data, for: request)
        return data
    }

    /// Checks the HTTP status of a response to `request` and throws the API error it stands for.
    /// Plain requests and SSE streams both use it, so they report 401s and server errors the same
    /// way. A 401 on a request that carried a bearer posts `.authExpired` with the rejected token,
    /// so the app can ignore a 401 for a token it no longer uses.
    ///
    /// 检查 `request` 响应的 HTTP 状态, 并抛出对应的 API 错误. 普通请求与 SSE 流都使用它, 因此 401
    /// 与服务端错误的报告方式一致. 携带 bearer 的请求收到 401 时, 会随被拒 token 一起发送
    /// `.authExpired`, 应用因此可以忽略已不再使用的 token 的 401.
    @discardableResult
    func validate(_ response: URLResponse, body data: Data, for request: URLRequest) async throws -> HTTPURLResponse {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError(0, 1300, "Not an HTTP response")
        }

        logger.info("\(request.httpMethod ?? "?") \(request.url?.path ?? "?") -> \(httpResponse.statusCode)")

        if httpResponse.statusCode == 401 {
            // Broadcast auth expiration only for requests that actually carried a token.
            //
            // 只有携带 token 的请求收到 401 时才广播认证过期, 避免匿名接口误触发登出.
            let parsed = try? JSONDecoder().decode(ServerErrorResponse.self, from: data)
            if let parsed {
                logger.warning("Server error: [\(parsed.code ?? 0)] \(parsed.error)")
            }
            let error = APIError.serverError(401, parsed?.code ?? 1002, parsed?.error ?? "not logged in")
            if notifiesAuthExpired, let token = Self.bearerToken(of: request) {
                await MainActor.run {
                    NotificationCenter.default.post(name: .authExpired, object: error,
                                                    userInfo: [Notification.rejectedTokenKey: token])
                }
            }
            throw error
        }

        if httpResponse.statusCode >= 400 {
            // Prefer backend machine-readable errors so UI messages stay stable across clients.
            //
            // 优先使用后端机器可读错误, 保持不同客户端的 UI 提示稳定.
            if let parsed = try? JSONDecoder().decode(ServerErrorResponse.self, from: data) {
                logger.warning("Server error: [\(parsed.code ?? 0)] \(parsed.error)")
                throw APIError.serverError(httpResponse.statusCode, parsed.code ?? 1300, parsed.error)
            }
            throw APIError.serverError(httpResponse.statusCode, 1300, String(data: data, encoding: .utf8) ?? "")
        }

        return httpResponse
    }

    /// The bearer token a request carried, if any.
    ///
    /// 请求携带的 bearer token, 没有则为 nil.
    private static func bearerToken(of request: URLRequest) -> String? {
        guard let header = request.value(forHTTPHeaderField: "Authorization"), !header.isEmpty else { return nil }
        return header.hasPrefix("Bearer ") ? String(header.dropFirst(7)) : header
    }

    /// Executes a request and decodes JSON using the app's API date strategy.
    ///
    /// 执行请求并使用应用 API 日期策略解码 JSON.
    func decode<T: Decodable>(_ type: T.Type, from request: URLRequest) async throws -> T {
        let data = try await data(for: request)
        do {
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }
}
