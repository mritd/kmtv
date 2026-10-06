#if os(iOS)
import AVKit
import SwiftUI

/// Fullscreen player for a downloaded episode, using the system controls (AirPlay is off for
/// local items). The system close button dismisses it and the system title shows the show and
/// episode; while there is no player (loading, an error, a rebuild) the system controls are gone,
/// so an own close button takes their place. A next-episode button appears only while paused or
/// near the end, below the system top bar.
///
/// 已下载剧集的全屏播放器, 使用系统控件 (本地内容关闭 AirPlay). 由系统关闭按钮退出, 系统标题显示剧名
/// 与集名; 没有播放器时 (加载中, 出错, 重建中) 系统控件不存在, 由自带的关闭按钮代替. 下一集按钮只在
/// 暂停或接近结尾时出现, 位于系统顶部栏下方.
struct OfflinePlayerView: View {
    let viewModel: OfflinePlayerViewModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            if let player = viewModel.player {
                FullScreenPlayerRepresentable(player: player)
                    .ignoresSafeArea()
            } else if let error = viewModel.error {
                Text(error)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView()
                    .tint(.white)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            if viewModel.player != nil, viewModel.showsUpNext {
                nextButton
            }
        }
        .animation(.easeInOut(duration: 0.2), value: viewModel.showsUpNext)
        .overlay(alignment: .topLeading) {
            // Only without a player: AVPlayerViewController shows its own close button otherwise.
            //
            // 仅在没有播放器时显示: 否则 AVPlayerViewController 会显示自己的关闭按钮.
            if viewModel.player == nil { closeButton }
        }
        .task { await viewModel.start() }
        // Runs however the cover goes away, including the system close button.
        //
        // 无论封面以何种方式关闭 (包括系统关闭按钮) 都会执行.
        .onDisappear { viewModel.close() }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background: viewModel.suspend()
            case .active: Task { await viewModel.resume() }
            default: break
            }
        }
    }

    private var closeButton: some View {
        Button {
            dismiss()
        } label: {
            Image(systemName: "xmark")
                .font(.headline)
                .foregroundStyle(.white)
                .frame(width: 44, height: 44)
                .background(.black.opacity(0.55), in: Circle())
        }
        .accessibilityLabel(Text("Close"))
        .padding(.top, 8)
        .padding(.leading, 16)
    }

    private var nextButton: some View {
        Button {
            viewModel.playNext()
        } label: {
            Label("Next Episode", systemImage: "forward.end.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .frame(height: 44)
                .background(.black.opacity(0.55), in: Capsule())
        }
        // Clear of the system top bar (close, picture in picture, volume).
        //
        // 避开系统顶部栏 (关闭, 画中画, 音量).
        .padding(.top, 64)
        .padding(.trailing, 16)
        .transition(.opacity)
    }
}
#endif
