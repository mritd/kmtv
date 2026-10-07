#if os(iOS)
import SwiftUI

/// "Watch Downloads Offline": opens every downloaded episode on the device without a network or a
/// sign-in. Hidden when nothing is downloaded.
///
/// "离线观看已下载内容": 无需网络或登录即可打开本机上的全部已下载剧集. 没有任何下载时隐藏.
struct OfflineEntryButton: View {
    /// How long to wait before showing it, so a fast server never flashes the button.
    ///
    /// 显示前等待的时长, 服务器很快响应时按钮不会一闪而过.
    var delay: Duration = .zero
    /// Runs before offline mode opens, for example to cancel a connection attempt.
    ///
    /// 在打开离线模式之前执行, 例如取消正在进行的连接.
    var willOpen: () -> Void = {}
    @Environment(AppViewModel.self) private var appVM
    @State private var visible = false

    var body: some View {
        if appVM.hasOfflineDownloads {
            Button {
                willOpen()
                appVM.openDownloadsOffline()
            } label: {
                Label("Watch Downloads Offline", systemImage: "arrow.down.circle")
            }
            .buttonStyle(.pill(selected: true))
            .opacity(visible ? 1 : 0)
            .disabled(!visible)
            .accessibilityIdentifier("offlineButton")
            .task {
                if delay > .zero { try? await Task.sleep(for: delay) }
                withAnimation(.easeOut(duration: 0.25)) { visible = true }
            }
        }
    }
}
#endif
