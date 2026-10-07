#if os(iOS)
import SwiftUI

/// Root of offline mode: the downloads list in its own stack. A network that comes back (an
/// unsatisfied path turning satisfied) reconnects once; while an offline player is open the
/// reconnect waits until it closes. Closing a player without such a change does nothing, so a
/// server that is down but reachable by path does not cause a reconnect loop.
///
/// 离线模式的根视图: 独立导航栈中的下载列表. 网络恢复 (路径由不可用变为可用) 时自动重连一次; 若离线
/// 播放器正在播放, 则等它关闭后再重连. 没有发生这种变化时关闭播放器不会触发任何操作, 因此服务端宕机但
/// 网络可达时不会反复重连.
struct OfflineRootView: View {
    @Environment(AppViewModel.self) private var appVM
    @Environment(DownloadManager.self) private var downloads
    @State private var pendingReconnect = false

    var body: some View {
        NavigationStack {
            DownloadsView(mode: .offline)
        }
        .onChange(of: downloads.network?.isSatisfied ?? false) { wasSatisfied, satisfied in
            // Opened from server setup there is no server to reconnect to.
            //
            // 从服务器设置页打开时没有可重连的服务器.
            guard !wasSatisfied, satisfied, !appVM.serverURL.isEmpty else { return }
            if downloads.offlinePlaybackActive {
                pendingReconnect = true
            } else {
                Task { await appVM.reconnect() }
            }
        }
        .onChange(of: downloads.offlinePlaybackActive) { _, active in
            guard !active, pendingReconnect else { return }
            pendingReconnect = false
            if downloads.network?.isSatisfied == true { Task { await appVM.reconnect() } }
        }
    }
}
#endif
