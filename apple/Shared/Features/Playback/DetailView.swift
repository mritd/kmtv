#if os(tvOS)
import SwiftUI
import Kingfisher
import AVKit

struct DetailView: View {
    let title: String
    let sources: [SourceResult]
    let sourceKey: String
    let videoId: String
    var coverHint: String = ""
    var resumeIntent: EpisodeResumeIntent?

    @Environment(AppViewModel.self) private var appVM
    @Environment(\.modelContext) private var modelContext
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dismiss) private var dismiss
    @State private var viewModel: PlayerViewModel?
    @State private var showPlayer = false

    var body: some View {
        Group {
            switch viewModel?.loadState {
            case .loaded:
                if let viewModel { content(viewModel) }
            case .failed(let message):
                failure(message)
            case .loading, nil:
                ProgressView()
            }
        }
        .background(Color.black)
        .task {
            // Create the player model lazily so navigation only loads detail once per view instance.
            // The detail page never autoplays; playback starts from the Play and episode buttons.
            //
            // 懒加载播放器模型, 确保同一个详情页实例只请求一次详情. 详情页不会自动播放;
            // 播放由播放按钮与剧集按钮开始.
            if viewModel == nil, let client = appVM.apiClient {
                viewModel = PlayerViewModel(
                    apiClient: client, modelContext: modelContext, serverURL: appVM.serverURL,
                    syncStore: appVM.sync?.store, syncEngine: appVM.sync?.engine,
                    sources: sources, sourceKey: sourceKey, videoId: videoId, title: title,
                    coverHint: coverHint,
                    initialEpisodeIndex: resumeIntent?.episodeIndex
                )
            }
            await viewModel?.open(autoplay: false)
        }
        // No resume on appear: the detail page shows again when the player cover is dismissed, and
        // playback must stay paused behind it. Only the Play and episode buttons start playback.
        //
        // 出现时不恢复播放: 关闭播放器全屏层后详情页会再次出现, 此时播放必须在其后保持暂停.
        // 只有播放按钮与剧集按钮会开始播放.
        .onChange(of: scenePhase) { _, phase in
            // Checkpoint before the app is suspended; the session flush may run before this one.
            //
            // 应用挂起前保存进度; 会话级补写可能先于这里执行.
            if phase == .background { viewModel?.checkpoint() }
        }
        .onDisappear {
            if showPlayer {
                viewModel?.pause()
            } else {
                viewModel?.close()
            }
        }
        .onExitCommand { dismiss() }
        .fullScreenCover(isPresented: $showPlayer) {
            if let player = viewModel?.player {
                FullScreenPlayerRepresentable(player: player)
                    .ignoresSafeArea()
                    .onDisappear {
                        // Keep a rate picked in the system controls for the next episode.
                        //
                        // 保留在系统控件中选择的倍速, 供下一集使用.
                        viewModel?.syncRateFromPlayer()
                        viewModel?.pause()
                    }
            } else {
                ProgressView()
            }
        }
    }

    /// Shown when every source failed, so the page does not spin forever.
    ///
    /// 所有视频源均失败时显示, 避免页面一直转圈.
    private func failure(_ message: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.largeTitle)
                .foregroundStyle(StatusColor.danger)
            Text(title).font(.title2.bold()).foregroundStyle(.primary)
            Text(message).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private func content(_ vm: PlayerViewModel) -> some View {
        ScrollView {
            VStack(spacing: 24) {
                heroSection(vm)
                sourcesSection(vm)
                episodesSection(vm)
                if let error = vm.error {
                    Text(error).foregroundStyle(StatusColor.danger).padding()
                }
            }
            .padding(.top, 80)
            .padding(.bottom, 32)
        }
        .background {
            if let cover = vm.detail?.cover {
                KFImage(coverURL(cover))
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .blur(radius: 40)
                    .overlay(
                        LinearGradient(
                            colors: [Color.black.opacity(0.3), Color.black.opacity(0.85)],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .ignoresSafeArea()
            }
        }
    }

    @ViewBuilder
    private func heroSection(_ vm: PlayerViewModel) -> some View {
        HStack(alignment: .top, spacing: 32) {
            posterImage(vm)
            infoColumn(vm)
        }
        .padding(.horizontal, TVSpacing.page)
    }

    @ViewBuilder
    private func posterImage(_ vm: PlayerViewModel) -> some View {
        KFImage(coverURL(vm.detail?.cover))
            .placeholder {
                RoundedRectangle(cornerRadius: TVRadius.card).fill(TVSurface.posterPlaceholder).aspectRatio(2/3, contentMode: .fit)
            }
            .fade(duration: 0.25)
            .resizable()
            .aspectRatio(2/3, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: TVRadius.card))
            .frame(width: 350)
    }

    @ViewBuilder
    private func infoColumn(_ vm: PlayerViewModel) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(verbatim: vm.detail?.title ?? title).font(.title.bold()).foregroundStyle(.primary)
            Text(DisplayFormatters.metaLine([vm.detail?.type, vm.detail?.year, vm.detail?.area]))
                .foregroundStyle(.secondary)
            if let director = vm.detail?.director, !director.isEmpty {
                (Text("Director: ").bold() + Text(director))
                    .font(.callout).foregroundStyle(.secondary)
            }
            if let actor = vm.detail?.actor, !actor.isEmpty {
                (Text("Cast: ").bold() + Text(actor))
                    .font(.callout).foregroundStyle(.secondary).lineLimit(2)
            }
            if let desc = vm.detail?.desc, !desc.isEmpty {
                let cleaned = DisplayFormatters.cleanDescription(desc)
                Text(cleaned).font(.callout).foregroundStyle(.secondary.opacity(0.7)).lineLimit(4)
            }
            actionButtons(vm)
        }
    }

    @ViewBuilder
    private func actionButtons(_ vm: PlayerViewModel) -> some View {
        HStack(spacing: 16) {
            Button {
                vm.startPlayback()
                showPlayer = true
            } label: {
                DetailActionButtonLabel(
                    text: "Play",
                    systemImage: "play.fill",
                    isPrimary: true
                )
            }
            .buttonStyle(.tvPlain)

            Button { vm.toggleFavorite() } label: {
                DetailActionButtonLabel(
                    text: vm.isFavorited ? "Favorited" : "Favorite",
                    systemImage: vm.isFavorited ? "star.fill" : "star",
                    isPrimary: false,
                    isActive: vm.isFavorited
                )
            }
            .buttonStyle(.tvPlain)
        }
    }

    @ViewBuilder
    private func sourcesSection(_ vm: PlayerViewModel) -> some View {
        if vm.sources.count > 1 {
            VStack(alignment: .leading, spacing: 8) {
                Text("Sources").font(.headline).padding(.horizontal, TVSpacing.page)
                    .foregroundStyle(.primary)
                sourceButtons(vm)
            }
        }
    }

    @ViewBuilder
    private func sourceButtons(_ vm: PlayerViewModel) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 8), spacing: 6) {
            ForEach(vm.sources) { source in
                SourceButton(source: source, isSelected: source.sourceKey == vm.currentSourceKey) {
                    guard source.sourceKey != vm.currentSourceKey else { return }
                    vm.selectSource(source.sourceKey, autoplay: false)
                }
            }
        }
        .padding(.horizontal, TVSpacing.page)
    }

    @ViewBuilder
    private func episodesSection(_ vm: PlayerViewModel) -> some View {
        if vm.episodes.count > 1 {
            VStack(alignment: .leading, spacing: 8) {
                Text("Episodes").font(.headline).padding(.horizontal, TVSpacing.page)
                    .foregroundStyle(.primary)
                episodeButtons(vm)
            }
        }
    }

    @ViewBuilder
    private func episodeButtons(_ vm: PlayerViewModel) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 8), spacing: 12) {
            ForEach(Array(vm.episodes.enumerated()), id: \.offset) { index, ep in
                DetailEpisodeButton(name: ep.name, isSelected: index == vm.currentEpisodeIndex) {
                    vm.switchEpisode(index)
                    showPlayer = true
                }
            }
        }
        .padding(.horizontal, TVSpacing.page)
    }

    private func coverURL(_ cover: String?) -> URL? {
        resolveAssetURL(cover, baseURL: appVM.apiClient?.baseURL)
    }
}

private struct DetailEpisodeButton: View {
    let name: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            DetailEpisodeButtonLabel(name: name, isSelected: isSelected)
        }
        .buttonStyle(.tvPlain)
    }
}

private struct DetailActionButtonLabel: View {
    let text: LocalizedStringKey
    let systemImage: String
    var isPrimary: Bool = false
    var isActive: Bool = false

    var body: some View {
        Label(text, systemImage: systemImage)
            .font(.callout.weight(.semibold))
            .padding(.horizontal, 24)
            .padding(.vertical, 12)
            .tvFocusableLabel(primary: isPrimary, active: isActive)
    }
}

private struct DetailEpisodeButtonLabel: View {
    let name: String
    let isSelected: Bool

    var body: some View {
        Text(name)
            .font(.caption)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .tvFocusableLabel(selected: isSelected)
    }
}
#endif
