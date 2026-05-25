import Foundation

extension APIClient {
    /// Requests a playable URL from the server so media token details stay server-owned.
    /// 向服务端请求可播放 URL, 让媒体 token 细节由服务端统一维护.
    ///
    /// The server may return either a proxied URL or a direct URL depending on playback mode.
    /// 服务端会根据播放模式返回代理地址或直连地址.
    func playbackURL(url: String, source: String) async throws -> PlaybackURLResponse {
        try await post("/api/v1/playback/url", body: PlaybackURLRequest(url: url, source: source))
    }
}
