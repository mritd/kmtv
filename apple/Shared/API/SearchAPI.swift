import Foundation

/// Actor-owned state for one SSE search request.
/// 单次 SSE 搜索请求使用的 actor 隔离状态.
private actor SearchStreamState {
    private var result: SearchResponse?
    private var streamError: Error?

    /// Stores the final result event from the SSE stream.
    /// 保存 SSE 流中的最终 result 事件.
    func setResult(_ result: SearchResponse) {
        self.result = result
    }

    /// Stores the first stream error that should fail the request.
    /// 保存应导致请求失败的首个流错误.
    func setError(_ error: Error) {
        streamError = error
    }

    /// Returns the completed search response or throws the captured stream error.
    /// 返回完成后的搜索响应, 或抛出已捕获的流错误.
    func finish() throws -> SearchResponse {
        if let streamError {
            throw streamError
        }
        guard let result else {
            throw APIError.serverError(0, 1300, "SSE stream ended without result")
        }
        return result
    }
}

extension APIClient {

    /// Performs a synchronous search request.
    /// 执行同步搜索请求.
    func search(query: String, page: Int = 1) async throws -> SearchResponse {
        try await get("/api/v1/search", query: ["q": query, "page": String(page)])
    }

    /// Fetches detail for one source-video pair.
    /// 获取单个 source-video 对应的详情.
    func detail(sourceKey: String, videoId: String) async throws -> VideoDetail {
        try await get("/api/v1/detail", query: ["source": sourceKey, "id": videoId])
    }

    /// SSE progress event from search stream.
    /// 搜索流返回的 SSE 进度事件.
    struct SearchProgress: Decodable, Sendable {
        let phase: String
        let completed: Int
        let total: Int
    }

    /// Performs search via SSE stream with progress callbacks.
    /// The onProgress callback is awaited for each event, ensuring MainActor
    /// updates complete before the next SSE event is processed.
    /// 通过 SSE 执行搜索并上报进度, 每个进度回调都会 await, 确保 UI 更新顺序稳定.
    func searchStream(
        query: String,
        page: Int = 1,
        onProgress: @escaping @Sendable (SearchProgress) async -> Void
    ) async throws -> SearchResponse {
        let state = SearchStreamState()

        try await sseStream(
            path: "/api/v1/search/stream",
            query: ["q": query, "page": String(page)]
        ) { event, data in
            switch event {
            case "progress":
                // Progress events are best-effort UI hints; malformed progress is ignored.
                // progress 事件只是尽力 UI 提示, 格式异常时直接忽略.
                if let progress = try? JSONDecoder().decode(SearchProgress.self, from: data) {
                    await onProgress(progress)
                }
            case "result":
                // Result is the terminal payload returned after the SSE stream closes.
                // result 是 SSE 流关闭后返回给调用方的最终 payload.
                do {
                    let result = try JSONDecoder().decode(SearchResponse.self, from: data)
                    await state.setResult(result)
                } catch {
                    await state.setError(APIError.decodingError(error))
                }
            case "error":
                // Backend stream errors are normalized to APIError for the shared UI path.
                // 后端流错误归一化为 APIError, 复用统一 UI 错误处理路径.
                /// Backend SSE error event payload.
                /// 后端 SSE error 事件载荷.
                struct SSEError: Decodable { let message: String }
                let msg = (try? JSONDecoder().decode(SSEError.self, from: data))?.message ?? "Unknown error"
                await state.setError(APIError.serverError(0, 1300, msg))
            default:
                break
            }
        }

        return try await state.finish()
    }
}
