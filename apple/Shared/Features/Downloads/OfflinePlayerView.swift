#if os(iOS)
import AVKit
import SwiftUI

/// Fullscreen player for a downloaded episode, using the system controls (AirPlay is off for
/// local items), with a close button and a next-episode button.
///
/// 已下载剧集的全屏播放器, 使用系统控件 (本地内容关闭 AirPlay), 并提供关闭与下一集按钮.
struct OfflinePlayerView: View {
    @State private var viewModel: OfflinePlayerViewModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase

    init(viewModel: OfflinePlayerViewModel) {
        _viewModel = State(initialValue: viewModel)
    }

    var body: some View {
        ZStack(alignment: .top) {
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
            topBar
        }
        .task { await viewModel.start() }
        .onDisappear { viewModel.close() }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background: viewModel.suspend()
            case .active: Task { await viewModel.resume() }
            default: break
            }
        }
    }

    private var topBar: some View {
        HStack(spacing: 12) {
            Button {
                viewModel.close()
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.headline)
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(.black.opacity(0.55), in: Circle())
            }
            .accessibilityLabel(Text("Close"))
            VStack(alignment: .leading, spacing: 2) {
                Text(viewModel.show.title).font(.headline)
                Text(viewModel.episode.episodeName).font(.caption)
            }
            .foregroundStyle(.white)
            .shadow(radius: 2)
            Spacer()
            if viewModel.nextEpisode != nil {
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
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }
}
#endif
