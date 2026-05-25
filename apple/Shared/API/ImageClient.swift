import Foundation
import Kingfisher

/// Image-specific helper for URL construction and Kingfisher configuration.
/// 负责图片 URL 构造和 Kingfisher 配置的 helper.
struct ImageClient: Sendable {
    let baseURL: String
    let sessionConfiguration: URLSessionConfiguration

    /// Builds the backend image proxy URL used for untrusted remote covers.
    /// 构建用于不可信远程封面的后端图片代理地址.
    func buildImageProxyURL(imageURL: String) -> URL {
        guard var components = URLComponents(string: baseURL + "/api/v1/proxy/image") else {
            return URL(string: "about:blank")!
        }
        components.queryItems = [URLQueryItem(name: "url", value: imageURL)]
        return components.url ?? URL(string: "about:blank")!
    }

    /// Applies shared image cache and downloader limits.
    /// 应用共享图片缓存与下载器限制.
    func configureKingfisher() {
        let downloader = ImageDownloader.default
        downloader.sessionConfiguration = sessionConfiguration
        let cache = ImageCache.default
        cache.memoryStorage.config.totalCostLimit = 50 * 1024 * 1024
        cache.diskStorage.config.sizeLimit = 200 * 1024 * 1024
    }
}
