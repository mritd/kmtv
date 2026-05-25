import Foundation
import os

/// Minimal Server-Sent Events client used by streaming search.
/// streaming search 使用的最小 SSE 客户端.
struct SSEClient: Sendable {
    let session: URLSession
    let executor: APIRequestExecutor
    let logger: Logger

    /// Reads an SSE stream and emits each parsed event in order.
    /// 读取 SSE 流并按顺序输出解析后的事件.
    func stream(
        request input: URLRequest,
        onEvent: @escaping @Sendable (String, Data) async -> Void
    ) async throws {
        var request = input
        executor.authorize(&request)
        let shouldNotifyAuthExpired = request.value(forHTTPHeaderField: "Authorization") != nil

        let (bytes, response) = try await session.bytes(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError(0, 1300, "Not an HTTP response")
        }

        logger.info("SSE \(request.url?.path ?? "?") -> \(httpResponse.statusCode)")

        if httpResponse.statusCode == 401 {
            // SSE search shares auth-expiration handling with normal HTTP requests.
            // SSE 搜索与普通 HTTP 请求共用认证过期处理.
            let error = APIError.serverError(401, 1002, "not logged in")
            if shouldNotifyAuthExpired {
                await MainActor.run {
                    NotificationCenter.default.post(name: .authExpired, object: error)
                }
            }
            throw error
        }

        if httpResponse.statusCode >= 400 {
            throw APIError.serverError(httpResponse.statusCode, 1300, "SSE connection failed")
        }

        var currentEvent = ""
        var currentData = ""

        // AsyncLineSequence skips empty delimiter lines, so flush on the next event.
        // AsyncLineSequence 会跳过空分隔行, 因此在下一个 event 到来时刷新上一条事件.
        for try await line in bytes.lines {
            if line.hasPrefix("event: ") {
                // A new event header means the previous event is complete.
                // 新 event header 出现时, 说明上一条事件已经完整.
                if !currentEvent.isEmpty, let data = currentData.data(using: .utf8) {
                    await onEvent(currentEvent, data)
                }
                currentEvent = String(line.dropFirst(7))
                currentData = ""
            } else if line.hasPrefix("data: ") {
                currentData = String(line.dropFirst(6))
            }
        }

        if !currentEvent.isEmpty, let data = currentData.data(using: .utf8) {
            // Flush the final event because many servers close without a trailing blank line.
            // 刷新最后一条事件, 因为很多服务端关闭连接前不会再发送空行.
            await onEvent(currentEvent, data)
        }
    }
}
