import Foundation

/// Client-side API error normalized from URLSession, HTTP status, and JSON decoding failures.
/// 从 URLSession、HTTP 状态码和 JSON 解码失败归一化得到的客户端 API 错误.
enum APIError: Error, LocalizedError {
    case invalidURL
    case unauthorized
    case serverError(Int, Int, String)
    case networkError(Error)
    case decodingError(Error)

    /// LocalizedError bridge used by SwiftUI alerts and generic Error rendering.
    /// 供 SwiftUI alert 与通用 Error 展示使用的 LocalizedError 桥接.
    var errorDescription: String? {
        localizedMessage
    }

    /// User-friendly localized message for UI surfaces.
    /// 面向 UI 展示的人类可读错误信息.
    var localizedMessage: String {
        switch self {
        case .networkError(let err):
            let urlError = err as? URLError
            switch urlError?.code {
            case .notConnectedToInternet:
                return String(localized: "No internet connection")
            case .timedOut:
                return String(localized: "Connection timed out")
            case .cannotConnectToHost, .cannotFindHost:
                return String(localized: "Cannot connect to server")
            default:
                return String(localized: "Network error, please try again")
            }
        case .unauthorized:
            return String(localized: "Login Required")
        case .serverError(_, let code, let message):
            if let localized = Self.localizedError(for: code) {
                return localized
            }
            return String(localized: "Unknown error") + " [\(code)] \(message)"
        case .invalidURL:
            return String(localized: "Invalid URL")
        case .decodingError:
            return String(localized: "Failed to parse server response")
        }
    }

    /// Maps backend error codes to stable localized client messages.
    /// 将后端错误码映射为稳定的客户端本地化提示.
    private static func localizedError(for code: Int) -> String? {
        switch code {
        case 1000: return String(localized: "Invalid request")
        case 1001: return String(localized: "Invalid username or password")
        case 1002: return String(localized: "Anonymous access is disabled, please sign in")
        case 1003: return String(localized: "User not found")
        case 1004: return String(localized: "Username already taken")
        case 1005: return String(localized: "Current password is incorrect")
        case 1100: return String(localized: "No image selected")
        case 1101: return String(localized: "Image too large, max 256KB")
        case 1102: return String(localized: "Unsupported image format, use JPEG/PNG/GIF/WebP")
        case 1201: return String(localized: "Please fill in all required fields")
        case 1202: return String(localized: "Invalid URL format")
        case 1203: return String(localized: "Invalid role")
        case 1204: return String(localized: "Resource not found")
        case 1300: return String(localized: "Server error, please try again later")
        case 1302: return String(localized: "Request blocked")
        case 1303: return String(localized: "External service unavailable")
        default: return nil
        }
    }
}

/// Backend structured error response.
/// 后端结构化错误响应.
struct ServerErrorResponse: Decodable {
    let error: String
    let code: Int?
}
