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
    /// A fetch may stall 20 s between bytes and take 60 s in all, so a slow trickle cannot hold the
    /// queue.
    ///
    /// 用于 playlist 请求的无 cookie 会话; 代理的 playlist URL 自带媒体 token. 一次获取在两次收到数据之间
    /// 最多停顿 20 秒, 总计最多 60 秒, 缓慢的涓流因此无法阻塞队列.
    static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieAcceptPolicy = .never
        config.httpShouldSetCookies = false
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 60
        return URLSession(configuration: config)
    }()

    /// Largest playlist body accepted, matching the server's M3U8 fetch limit (`10<<20` in
    /// `server/internal/service/proxy.go`).
    ///
    /// 可接受的最大 playlist 响应体, 与服务端 M3U8 获取上限一致 (`server/internal/service/proxy.go`
    /// 中的 `10<<20`).
    static let maxPlaylistBytes = 10 << 20

    /// Fetches a playlist URL and returns its status and body.
    ///
    /// 获取 playlist URL 并返回状态码与响应体.
    @Sendable static func fetch(_ url: URL) async throws -> (Int, Data) {
        try await fetch(url, session: session)
    }

    /// Streams a playlist body. A non-2xx status returns at once with an empty body. A body that
    /// does not start with `#EXTM3U` (after an optional UTF-8 BOM and blank lines), or that grows
    /// past `limit` bytes, is abandoned with `.format(.notHLS)`, because a direct-mode URL can
    /// point at a multi-gigabyte video file.
    ///
    /// 以流式读取 playlist 响应体. 非 2xx 状态码立即返回空响应体. 若响应体 (跳过可选的 UTF-8 BOM 与
    /// 空行后) 不以 `#EXTM3U` 开头, 或超过 `limit` 字节, 则放弃读取并抛出 `.format(.notHLS)`,
    /// 因为直连模式的 URL 可能指向数 GB 的视频文件.
    static func fetch(_ url: URL, session: URLSession, limit: Int = maxPlaylistBytes) async throws -> (Int, Data) {
        let (bytes, response) = try await session.bytes(from: url)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            bytes.task.cancel()
            return (status, Data())
        }
        var data = Data()
        var headerChecked = false
        for try await byte in bytes {
            data.append(byte)
            if data.count > limit {
                bytes.task.cancel()
                throw DownloadPrepareError.format(.notHLS)
            }
            if !headerChecked, let isPlaylist = playlistHeader(data) {
                guard isPlaylist else {
                    bytes.task.cancel()
                    throw DownloadPrepareError.format(.notHLS)
                }
                headerChecked = true
            }
        }
        return (status, data)
    }

    /// Bytes read without finding the `#EXTM3U` tag before a body counts as not HLS; this also
    /// bounds the rescans of `playlistHeader`.
    ///
    /// 读取这么多字节仍未找到 `#EXTM3U` 标签时, 视为非 HLS 响应体; 同时限制 `playlistHeader` 的重复扫描.
    static let headerScanLimit = 1024

    /// Whether a body's first bytes start an HLS playlist: true or false once the first non-empty
    /// line is known to be or not be `#EXTM3U`, nil while too few bytes have arrived to tell. A head
    /// of `headerScanLimit` bytes or more that is still undecided is not HLS.
    ///
    /// 响应体开头的字节是否为 HLS playlist: 能确定第一个非空行是否为 `#EXTM3U` 时返回 true 或 false,
    /// 已到达的字节不足以判断时返回 nil. 长度达到 `headerScanLimit` 字节仍无法判断时, 视为非 HLS.
    static func playlistHeader(_ head: Data) -> Bool? {
        guard let verdict = headerVerdict(head) else { return head.count >= headerScanLimit ? false : nil }
        return verdict
    }

    /// `playlistHeader` without the scan limit.
    ///
    /// 不带扫描上限的 `playlistHeader`.
    private static func headerVerdict(_ head: Data) -> Bool? {
        let bom: [UInt8] = [0xEF, 0xBB, 0xBF]
        var rest = head[...]
        if rest.starts(with: bom) {
            rest = rest.dropFirst(bom.count)
        } else if bom.starts(with: rest) {
            return nil
        }
        rest = rest.drop { [0x20, 0x09, 0x0A, 0x0D].contains($0) }
        let tag = Array("#EXTM3U".utf8)
        if rest.count < tag.count { return tag.starts(with: rest) ? nil : false }
        return rest.starts(with: tag)
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
        } catch let error as DownloadPrepareError {
            throw error
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
