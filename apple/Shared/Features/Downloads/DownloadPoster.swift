#if os(iOS)
import ImageIO
import SwiftUI
import UIKit

/// Poster of a downloaded show from its local cover file, or a tinted placeholder with the
/// title's first character, so it renders offline. The file is decoded once, off the main thread
/// and downsampled to the display size, then served from `DownloadPosterCache`.
///
/// 已下载剧集的海报, 来自本地封面文件; 没有封面时显示带标题首字的着色占位图, 因此离线也能显示. 文件
/// 只在主线程之外解码一次, 并按显示尺寸缩小, 之后由 `DownloadPosterCache` 提供.
struct DownloadPoster: View {
    /// Poster height over width: the app-wide 2:3 poster ratio.
    ///
    /// 海报高度与宽度之比: 全应用统一的 2:3 海报比例.
    static let heightRatio: CGFloat = 3.0 / 2.0

    let show: DownloadShow
    let width: CGFloat
    @Environment(DownloadManager.self) private var downloads
    @Environment(\.displayScale) private var displayScale
    // The image decoded for one key; ignored once the key changes, so a stale poster never shows.
    //
    // 为某个键解码得到的图片; 键变化后即被忽略, 因此不会显示过期的海报.
    @State private var loaded: (key: DownloadPosterCache.Key, image: UIImage)?

    var body: some View {
        let key = downloads.coverFileURL(for: show).map {
            DownloadPosterCache.Key(url: $0, maxPixels: Int((width * Self.heightRatio * displayScale).rounded(.up)),
                                    revision: DownloadPosterCache.revision(of: show))
        }
        Group {
            if let image = key.flatMap(DownloadPosterCache.image(for:))
                ?? loaded.flatMap({ $0.key == key ? $0.image : nil }) {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                // No saved cover file: try the registered cover online, else the placeholder.
                //
                // 没有已保存的封面文件: 在线时尝试已登记的封面, 否则显示占位图.
                ArtworkImage(url: nil, title: show.title, compactPlaceholder: width < 70)
            }
        }
        .frame(width: width, height: width * Self.heightRatio)
        .artworkFrame(radius: Radius.sm)
        .accessibilityHidden(true)
        .task(id: key) {
            guard let key else {
                loaded = nil
                return
            }
            loaded = await DownloadPosterCache.load(key).map { (key, $0) }
        }
    }
}

/// Decoded, downsampled posters by file and pixel size. A miss is not cached, so a cover that
/// arrives later loads on the next appearance.
///
/// 按文件与像素尺寸缓存已解码并缩小的海报. 未命中不会被缓存, 因此稍后到达的封面会在下次出现时加载.
@MainActor
enum DownloadPosterCache {
    /// Cache key: the cover file, the longest side in pixels, and the show's revision. A show
    /// deleted and downloaded again reuses the same `cover.jpg` path, so the path alone is not
    /// enough.
    ///
    /// 缓存键: 封面文件, 最长边像素数以及剧集的版本. 删除后重新下载的剧集会复用同一个 `cover.jpg`
    /// 路径, 因此仅凭路径不够.
    struct Key: Hashable, Sendable {
        let url: URL
        let maxPixels: Int
        let revision: String
    }

    /// The revision of a show's cover: its creation time (new for a re-created show) and the remote
    /// cover URL.
    ///
    /// 剧集封面的版本: 创建时间 (重新创建的剧集会不同) 与远程封面 URL.
    static func revision(of show: DownloadShow) -> String {
        "\(show.createdAt.timeIntervalSinceReferenceDate)|\(show.coverURLString)"
    }

    private static let cache = NSCache<NSString, UIImage>()

    /// The cached image for a key, if decoded already.
    ///
    /// 某个键对应的已缓存图片 (如已解码).
    static func image(for key: Key) -> UIImage? {
        cache.object(forKey: name(key))
    }

    /// Returns the cached image or decodes the file off the main thread and caches it.
    ///
    /// 返回已缓存的图片, 或在主线程之外解码文件并缓存.
    static func load(_ key: Key) async -> UIImage? {
        if let hit = image(for: key) { return hit }
        let decoded = await Task.detached(priority: .userInitiated) { decode(key) }.value
        if let decoded { cache.setObject(decoded, forKey: name(key)) }
        return decoded
    }

    private static func name(_ key: Key) -> NSString {
        "\(key.url.path)#\(key.maxPixels)#\(key.revision)" as NSString
    }

    private nonisolated static func decode(_ key: Key) -> UIImage? {
        guard let source = CGImageSourceCreateWithURL(key.url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary) else {
            return nil
        }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: max(1, key.maxPixels),
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        return UIImage(cgImage: image)
    }
}
#endif
