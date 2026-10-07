import Foundation

/// The one definition of a KMTV media proxy URL (`/api/v1/proxy/...`), shared by download
/// identity (an upstream file named by the proxy's `url` parameter) and media-token expiry checks.
/// A direct upstream URL whose path merely contains `/proxy/` is not one.
///
/// KMTV 媒体代理 URL (`/api/v1/proxy/...`) 的唯一定义, 下载身份 (由代理的 `url` 参数标识上游文件)
/// 与媒体 token 过期判断共用. 路径中只是含有 `/proxy/` 的上游直连 URL 不算.
enum KMTVProxyURL {
    /// Path segment every KMTV media proxy endpoint lives under.
    ///
    /// 所有 KMTV 媒体代理端点所在的路径段.
    static let pathMarker = "/api/v1/proxy/"

    /// Whether a URL is a KMTV media proxy URL.
    ///
    /// URL 是否为 KMTV 媒体代理 URL.
    static func isProxy(_ url: URL) -> Bool {
        url.path.contains(pathMarker)
    }

    /// The upstream URL a KMTV proxy URL fetches (its `url` query parameter); nil for any other URL.
    ///
    /// KMTV 代理 URL 所获取的上游 URL (其 `url` 查询参数); 其他 URL 返回 nil.
    static func upstream(of url: URL) -> String? {
        guard isProxy(url) else { return nil }
        return URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?.first(where: { $0.name == "url" })?.value
    }
}
