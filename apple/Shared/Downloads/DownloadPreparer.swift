import Foundation

/// Turns an episode into a download manifest with freshly signed URLs.
///
/// 将一集转换为带有新签名 URL 的下载 manifest.
protocol DownloadPreparing: Sendable {
    /// Resolves the episode, follows a master playlist to its best variant, and builds the manifest.
    ///
    /// 解析该集, 若为 master playlist 则跟随到最佳变体, 并构建 manifest.
    func prepare(episodeURL: String, sourceKey: String, generation: Int) async throws -> DownloadManifest
}

/// Why preparation failed.
///
/// 准备失败的原因.
enum DownloadPrepareError: Error, Equatable, Sendable {
    case format(HLSParseError)
    case status(Int)
    case signedOut
    case network
}

/// Prepares episodes through `/playback/url` (proxy or direct) and the playlist URLs it returns.
/// The API client given here must be built with `notifiesAuthExpired: false`.
///
/// 通过 `/playback/url` (代理或直连) 以及它返回的 playlist URL 准备剧集. 传入的 API 客户端必须以
/// `notifiesAuthExpired: false` 创建.
struct DownloadPreparer: DownloadPreparing {
    let api: any PlaybackAPIProtocol
    let fetch: @Sendable (URL) async throws -> (Int, Data)

    init(api: any PlaybackAPIProtocol,
         fetch: @escaping @Sendable (URL) async throws -> (Int, Data) = DownloadPreparer.fetch) {
        self.api = api
        self.fetch = fetch
    }

    /// Cookie-less session for playlist requests; proxied playlist URLs carry their own media token.
    ///
    /// 用于 playlist 请求的无 cookie 会话; 代理的 playlist URL 自带媒体 token.
    static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieAcceptPolicy = .never
        config.httpShouldSetCookies = false
        config.timeoutIntervalForRequest = 20
        return URLSession(configuration: config)
    }()

    /// Fetches a URL and returns its status and body.
    ///
    /// 获取 URL 并返回状态码与响应体.
    @Sendable static func fetch(_ url: URL) async throws -> (Int, Data) {
        let (data, response) = try await session.data(from: url)
        return ((response as? HTTPURLResponse)?.statusCode ?? 0, data)
    }

    func prepare(episodeURL: String, sourceKey: String, generation: Int) async throws -> DownloadManifest {
        let response: PlaybackURLResponse
        do {
            response = try await api.playbackURL(url: episodeURL, source: sourceKey)
        } catch APIError.serverError(let status, _, _) {
            throw status == 401 ? DownloadPrepareError.signedOut : DownloadPrepareError.status(status)
        } catch {
            throw DownloadPrepareError.network
        }
        guard let url = URL(string: response.url) else { throw DownloadPrepareError.format(.notHLS) }
        var playlist = try await load(url)
        if case .master(let master) = playlist {
            do {
                playlist = try await load(try HLSParser.bestVariant(master).uri)
            } catch let error as HLSParseError {
                throw DownloadPrepareError.format(error)
            }
        }
        guard case .media(let media) = playlist else { throw DownloadPrepareError.format(.notHLS) }
        return DownloadManifest.build(from: media, generation: generation)
    }

    private func load(_ url: URL) async throws -> HLSPlaylist {
        let status: Int
        let data: Data
        do {
            (status, data) = try await fetch(url)
        } catch {
            throw DownloadPrepareError.network
        }
        guard (200..<300).contains(status) else { throw DownloadPrepareError.status(status) }
        let text = String(data: data, encoding: .utf8) ?? String(decoding: data, as: UTF8.self)
        do {
            return try HLSParser.parse(text, baseURL: url)
        } catch let error as HLSParseError {
            throw DownloadPrepareError.format(error)
        }
    }
}
