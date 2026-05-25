import Foundation
import os

/// Shared request executor that applies bearer auth and normalizes HTTP errors.
/// 统一执行请求, 注入 bearer 认证并归一化 HTTP 错误.
struct APIRequestExecutor: Sendable {
    let session: URLSession
    let tokenProvider: @Sendable () -> String?
    let logger: Logger

    /// Adds the current opaque bearer token to API requests when available.
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
    /// 执行请求并返回已通过 HTTP 状态校验的响应数据.
    func data(for input: URLRequest) async throws -> Data {
        var request = input
        authorize(&request)
        let shouldNotifyAuthExpired = request.value(forHTTPHeaderField: "Authorization") != nil

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            logger.error("\(request.httpMethod ?? "?") \(request.url?.path ?? "?") failed: \(error.localizedDescription)")
            throw APIError.networkError(error)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError(0, 1300, "Not an HTTP response")
        }

        logger.info("\(request.httpMethod ?? "?") \(request.url?.path ?? "?") -> \(httpResponse.statusCode)")

        if httpResponse.statusCode == 401 {
            // Broadcast auth expiration only for requests that actually carried a token.
            // 只有携带 token 的请求收到 401 时才广播认证过期, 避免匿名接口误触发登出.
            let parsed = try? JSONDecoder().decode(ServerErrorResponse.self, from: data)
            if let parsed {
                logger.warning("Server error: [\(parsed.code ?? 0)] \(parsed.error)")
            }
            let error = APIError.serverError(401, parsed?.code ?? 1002, parsed?.error ?? "not logged in")
            if shouldNotifyAuthExpired {
                await MainActor.run {
                    NotificationCenter.default.post(name: .authExpired, object: error)
                }
            }
            throw error
        }

        if httpResponse.statusCode >= 400 {
            // Prefer backend machine-readable errors so UI messages stay stable across clients.
            // 优先使用后端机器可读错误, 保持不同客户端的 UI 提示稳定.
            if let parsed = try? JSONDecoder().decode(ServerErrorResponse.self, from: data) {
                logger.warning("Server error: [\(parsed.code ?? 0)] \(parsed.error)")
                throw APIError.serverError(httpResponse.statusCode, parsed.code ?? 1300, parsed.error)
            }
            throw APIError.serverError(httpResponse.statusCode, 1300, String(data: data, encoding: .utf8) ?? "")
        }

        return data
    }

    /// Executes a request and decodes JSON using the app's API date strategy.
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
