#if os(iOS)
import Foundation
import Observation

/// Hosts the loopback server that plays completed downloads (ADR-017): one server rooted at the
/// downloads directory serves every scope, so playing the next episode from another account's
/// download never restarts it under the item that is still playing. It releases the socket in the
/// background and rebinds on return, and it tracks whether an offline player is on screen.
///
/// 承载播放已完成下载的 loopback 服务 (ADR-017): 一个以下载目录为根的服务覆盖所有作用域, 因此播放
/// 另一个账号下载的下一集时, 不会在仍在播放的 item 下重启服务. 它在后台释放 socket, 返回前台时重新
/// 绑定, 并记录离线播放器是否正在显示.
@Observable
@MainActor
final class LocalPlaybackHost {
    /// Whether an offline player is on screen; an automatic reconnect waits until it closes.
    ///
    /// 离线播放器是否正在显示; 自动重连会等到它关闭之后.
    var offlinePlaybackActive = false
    @ObservationIgnored private let root: URL
    @ObservationIgnored private var server: LocalMediaServer?

    init(root: URL) {
        self.root = root
    }

    /// Loopback URL of a completed episode's playlist, starting the server on first use.
    ///
    /// 已完成剧集 playlist 的 loopback URL; 首次使用时启动服务.
    func playbackURL(for key: EpisodeKey) async throws -> URL {
        let server = self.server ?? LocalMediaServer(root: root)
        self.server = server
        _ = try await server.start()
        guard let url = server.url(forRelativePath: "\(key.relativePath)/index.m3u8") else {
            throw LocalMediaServerError.notReady
        }
        return url
    }

    /// Rebinds the server, if one was started, on the return to the foreground.
    ///
    /// 返回前台时重新绑定服务 (如果曾启动过).
    func enterForeground() async {
        if let server { _ = try? await server.start() }
    }

    /// Releases the socket in the background. The app has no background audio, so playback stops
    /// there; the same port is rebound on return.
    ///
    /// 在后台释放 socket. App 没有后台音频, 播放会在此停止; 返回前台时重新绑定同一端口.
    func enterBackground() {
        server?.stop()
    }
}
#endif
