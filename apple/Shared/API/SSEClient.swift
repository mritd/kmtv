import Foundation
import os

/// Minimal Server-Sent Events client used by streaming search.
///
/// streaming search 使用的最小 SSE 客户端.
struct SSEClient: Sendable {
    let session: URLSession
    let executor: APIRequestExecutor
    let logger: Logger

    /// Reads an SSE stream and emits each parsed event in order.
    ///
    /// 读取 SSE 流并按顺序输出解析后的事件.
    func stream(
        request input: URLRequest,
        onEvent: @escaping @Sendable (String, Data) async -> Void
    ) async throws {
        var request = input
        executor.authorize(&request)

        let (bytes, response) = try await session.bytes(for: request)
        // Read the error body so the executor maps the server's code like any other request.
        //
        // 读取错误响应体, 使执行器像处理其他请求一样映射服务端错误码.
        let failed = ((response as? HTTPURLResponse)?.statusCode ?? 0) >= 400
        let body = failed ? await Self.errorBody(of: bytes) : Data()
        try await executor.validate(response, body: body, for: request)

        var currentEvent = ""
        var currentData: String?

        // AsyncLineSequence skips empty delimiter lines, so flush on the next event.
        //
        // AsyncLineSequence 会跳过空分隔行, 因此在下一个 event 到来时刷新上一条事件.
        for try await line in bytes.lines {
            guard let (field, value) = Self.field(of: line) else { continue }
            switch field {
            case "event":
                // A new event header means the previous event is complete.
                //
                // 新 event header 出现时, 说明上一条事件已经完整.
                if !currentEvent.isEmpty, let data = (currentData ?? "").data(using: .utf8) {
                    await onEvent(currentEvent, data)
                }
                currentEvent = value
                currentData = nil
            case "data":
                // Several data lines form one value joined by newlines.
                //
                // 多个 data 行按换行拼接为同一个值.
                currentData = currentData.map { $0 + "\n" + value } ?? value
            default:
                break
            }
        }

        if !currentEvent.isEmpty, let data = (currentData ?? "").data(using: .utf8) {
            // Flush the final event because many servers close without a trailing blank line.
            //
            // 刷新最后一条事件, 因为很多服务端关闭连接前不会再发送空行.
            await onEvent(currentEvent, data)
        }
    }

    /// Splits an SSE line into field and value. The space after the colon is optional; a line
    /// starting with a colon is a comment and yields nil.
    ///
    /// 将 SSE 行拆分为字段与值. 冒号后的空格可有可无; 以冒号开头的行是注释, 返回 nil.
    static func field(of line: String) -> (String, String)? {
        guard !line.hasPrefix(":") else { return nil }
        guard let colon = line.firstIndex(of: ":") else { return (line, "") }
        var value = line[line.index(after: colon)...]
        if value.hasPrefix(" ") { value = value.dropFirst() }
        return (String(line[..<colon]), String(value))
    }

    /// Reads at most 64 KB of an error response; a read failure keeps what arrived so far.
    ///
    /// 最多读取 64 KB 错误响应; 读取失败时保留已收到的部分.
    private static func errorBody(of bytes: URLSession.AsyncBytes) async -> Data {
        var body = Data()
        do {
            for try await byte in bytes {
                body.append(byte)
                if body.count >= 64 * 1024 { break }
            }
        } catch {}
        return body
    }
}
