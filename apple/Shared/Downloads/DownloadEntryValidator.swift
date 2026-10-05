import Foundation

/// What to do with a finished download task.
///
/// 如何处理一个已完成的下载任务.
enum EntryOutcome: Equatable, Sendable {
    case accept
    case tokenExpired
    case retry(DownloadFailure)
    case reject(DownloadFailure)
}

/// Classifies finished entries. Only the KMTV server's own media-token 401 on a proxy URL means
/// the token expired; upstream 401 and 403 are passed through by the proxy and are failures.
///
/// 对已完成的条目分类. 只有代理 URL 上由 KMTV 服务端返回的媒体 token 401 才表示 token 过期; 上游的
/// 401 与 403 会被代理透传, 按失败处理.
enum DownloadEntryValidator {
    /// Message of the server's media-token error (`server/internal/handler/proxy.go`).
    ///
    /// 服务端媒体 token 错误的消息 (`server/internal/handler/proxy.go`).
    static let mediaTokenMessage = "invalid or expired media token"

    /// Classifies a finished response from its status, content type, first bytes, and size.
    ///
    /// 根据状态码, content type, 开头字节与大小对已完成的响应分类.
    static func classify(url: URL, status: Int, contentType: String?, head: Data, size: Int64,
                         kind: DownloadManifest.Kind) -> EntryOutcome {
        switch status {
        case 200..<300:
            if size <= 0 { return .retry(.invalidContent) }
            if kind == .key { return size == 16 ? .accept : .retry(.invalidContent) }
            if contentType?.lowercased().contains("text/html") == true { return .retry(.invalidContent) }
            if let first = head.first(where: { ![0x20, 0x09, 0x0A, 0x0D].contains($0) }), first == UInt8(ascii: "<") {
                return .retry(.invalidContent)
            }
            return .accept
        case 401 where isProxyURL(url) && String(decoding: head, as: UTF8.self).contains(mediaTokenMessage):
            return .tokenExpired
        case 408, 425, 429, 500..<600:
            return .retry(.sourceStatus(status))
        default:
            return .reject(.sourceStatus(status))
        }
    }

    /// Classifies a transport error; nil for a cancellation, which pause and refresh cause on purpose.
    ///
    /// 对传输错误分类; 取消返回 nil, 因为暂停与刷新会主动取消任务.
    static func classify(transportError: URLError) -> EntryOutcome? {
        transportError.code == .cancelled ? nil : .retry(.network)
    }

    /// Whether a URL is a KMTV media proxy URL.
    ///
    /// URL 是否为 KMTV 媒体代理 URL.
    static func isProxyURL(_ url: URL) -> Bool {
        url.path.contains("/api/v1/proxy/")
    }
}
