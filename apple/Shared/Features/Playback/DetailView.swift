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
    @Environment(\.dismiss) private var dismiss
    @State private var viewModel: PlayerViewModel?
    @State private var showPlayer = false

    var body: some View {
        Group {
            if let viewModel, viewModel.detail != nil {
                content(viewModel)
            } else {
                ProgressView()
            }
        }
        #if os(tvOS)
        .background(Color.black)
        #endif
        .task {
            // Create the player model lazily so navigation only loads detail once per view instance.
            // 懒加载播放器模型, 确保同一个详情页实例只请求一次详情.
            if viewModel == nil, let client = appVM.apiClient {
                let vm = PlayerViewModel(
                    apiClient: client, modelContext: modelContext, serverURL: appVM.serverURL,
                    sources: sources, sourceKey: sourceKey, videoId: videoId, title: title,
                    coverHint: coverHint,
                    initialEpisodeIndex: resumeIntent?.episodeIndex
                )
                viewModel = vm
                let ok = await vm.loadDetail(sourceKey: sourceKey, videoId: videoId)
                guard !Task.isCancelled else {
                    vm.cleanup()
                    return
                }
                if !ok {
                    await vm.handlePlaybackError()
                    guard !Task.isCancelled else {
                        vm.cleanup()
                        return
                    }
                }
            }
        }
        .onAppear {
            viewModel?.resume()
        }
        .onDisappear {
            if showPlayer {
                viewModel?.pause()
            } else {
                viewModel?.cleanup()
            }
        }
        #if os(tvOS)
        .onExitCommand { dismiss() }
        .fullScreenCover(isPresented: $showPlayer) {
            if let player = viewModel?.player {
                FullScreenPlayerRepresentable(player: player)
                    .ignoresSafeArea()
                    .onDisappear {
                        viewModel?.pause()
                    }
            } else {
                ProgressView()
            }
        }
        #endif
    }

    @ViewBuilder
    private func content(_ vm: PlayerViewModel) -> some View {
        ScrollView {
            VStack(spacing: 24) {
                heroSection(vm)
                sourcesSection(vm)
                episodesSection(vm)
                if let error = vm.error {
                    Text(error).foregroundStyle(.red).padding()
                }
            }
            #if os(tvOS)
            .padding(.top, 80)
            .padding(.bottom, 32)
            #else
            .padding(.vertical, 32)
            #endif
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
                    #if os(tvOS)
                    .ignoresSafeArea()
                    #endif
            }
        }
    }

    @ViewBuilder
    private func heroSection(_ vm: PlayerViewModel) -> some View {
        HStack(alignment: .top, spacing: 32) {
            posterImage(vm)
            infoColumn(vm)
        }
        .padding(.horizontal, 48)
    }

    @ViewBuilder
    private func posterImage(_ vm: PlayerViewModel) -> some View {
        KFImage(coverURL(vm.detail?.cover))
            .placeholder {
                RoundedRectangle(cornerRadius: 12).fill(Color(white: 0.2)).aspectRatio(2/3, contentMode: .fit)
            }
            .fade(duration: 0.25)
            .resizable()
            .aspectRatio(2/3, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            #if os(tvOS)
            .frame(width: 350)
            #else
            .frame(width: 250)
            #endif
    }

    @ViewBuilder
    private func infoColumn(_ vm: PlayerViewModel) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(vm.detail?.title ?? title).font(.title.bold()).foregroundStyle(.primary)
            Text("\(vm.detail?.type ?? "") | \(vm.detail?.year ?? "") | \(vm.detail?.area ?? "")")
                .foregroundStyle(.secondary)
            if let director = vm.detail?.director, !director.isEmpty {
                #if os(tvOS)
                (Text("Director: ").bold() + Text(director))
                    .font(.callout).foregroundStyle(.secondary)
                #else
                (Text("Director: ") + Text(director))
                    .font(.callout).foregroundStyle(.secondary)
                #endif
            }
            if let actor = vm.detail?.actor, !actor.isEmpty {
                #if os(tvOS)
                (Text("Cast: ").bold() + Text(actor))
                    .font(.callout).foregroundStyle(.secondary).lineLimit(2)
                #else
                (Text("Cast: ") + Text(actor))
                    .font(.callout).foregroundStyle(.secondary).lineLimit(2)
                #endif
            }
            if let desc = vm.detail?.desc, !desc.isEmpty {
                let cleaned = Self.cleanDescription(desc)
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
                #if os(tvOS)
                DetailActionButtonLabel(
                    text: "Play",
                    systemImage: "play.fill",
                    isPrimary: true
                )
                #else
                Label("Play", systemImage: "play.fill")
                #endif
            }
            #if os(tvOS)
            .buttonStyle(.tvPlain)
            #else
            .buttonStyle(.borderedProminent)
            #endif

            Button { vm.toggleFavorite() } label: {
                #if os(tvOS)
                DetailActionButtonLabel(
                    text: vm.isFavorited ? "Favorited" : "Favorite",
                    systemImage: vm.isFavorited ? "star.fill" : "star",
                    isPrimary: false,
                    isActive: vm.isFavorited
                )
                #else
                Label(vm.isFavorited ? "Favorited" : "Favorite",
                      systemImage: vm.isFavorited ? "star.fill" : "star")
                #endif
            }
            #if os(tvOS)
            .buttonStyle(.tvPlain)
            #endif
        }
    }

    @ViewBuilder
    private func sourcesSection(_ vm: PlayerViewModel) -> some View {
        if vm.sources.count > 1 {
            VStack(alignment: .leading, spacing: 8) {
                Text("Sources").font(.headline).padding(.horizontal, 48)
                    .foregroundStyle(.primary)
                sourceButtons(vm)
            }
        }
    }

    @ViewBuilder
    private func sourceButtons(_ vm: PlayerViewModel) -> some View {
        #if os(tvOS)
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 8), spacing: 6) {
            ForEach(vm.sources) { source in
                SourceButton(source: source, isSelected: source.sourceKey == vm.currentSourceKey) {
                    Task { await vm.switchSource(source.sourceKey) }
                }
            }
        }
        .padding(.horizontal, 48)
        #else
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(vm.sources) { source in
                    SourceButton(source: source, isSelected: source.sourceKey == vm.currentSourceKey, showsLatency: false) {
                        Task {
                            await vm.switchSource(source.sourceKey)
                            vm.startPlayback()
                        }
                    }
                }
            }
            .padding(.horizontal, 48)
        }
        #endif
    }

    @ViewBuilder
    private func episodesSection(_ vm: PlayerViewModel) -> some View {
        if vm.episodes.count > 1 {
            VStack(alignment: .leading, spacing: 8) {
                Text("Episodes").font(.headline).padding(.horizontal, 48)
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
        .padding(.horizontal, 48)
    }

    /// Clean description: collapse whitespace and remove repeated content.
    /// Many sources return the same paragraph duplicated (e.g. "ABCABC").
    /// 清洗简介: 合并空白并移除重复内容, 兼容部分源返回整段重复文本的情况.
    private static func cleanDescription(_ desc: String) -> String {
        let trimmed = desc.components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }.joined(separator: " ")
        guard !trimmed.isEmpty else { return trimmed }
        // Check if the string is a repeated substring.
        // 检查文本是否由同一段子串重复拼接而成.
        let len = trimmed.count
        for half in [len / 2, len / 2 + 1, len / 2 - 1] where half > 0 && half < len {
            let prefix = String(trimmed.prefix(half))
            if trimmed.hasPrefix(prefix) && trimmed.dropFirst(half).hasPrefix(prefix) {
                return prefix.trimmingCharacters(in: .whitespaces)
            }
        }
        return trimmed
    }

    private func coverURL(_ cover: String?) -> URL? {
        guard let cover, !cover.isEmpty else { return nil }
        if cover.hasPrefix("/"), let client = appVM.apiClient {
            return URL(string: client.baseURL + cover)
        }
        return URL(string: cover)
    }
}

private struct DetailEpisodeButton: View {
    let name: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            #if os(tvOS)
            DetailEpisodeButtonLabel(name: name, isSelected: isSelected)
            #else
            Text(name)
            #endif
        }
        #if os(tvOS)
        .buttonStyle(.tvPlain)
        #else
        .applyIf(isSelected) { $0.buttonStyle(.borderedProminent) }
        .applyIf(!isSelected) { $0.buttonStyle(.bordered) }
        #endif
    }
}

#if os(tvOS)
private struct DetailActionButtonLabel: View {
    let text: LocalizedStringKey
    let systemImage: String
    var isPrimary: Bool = false
    var isActive: Bool = false
    @Environment(\.isFocused) private var isFocused

    var body: some View {
        Label(text, systemImage: systemImage)
            .font(.callout.weight(.semibold))
            .foregroundStyle(foregroundColor)
            .padding(.horizontal, 24)
            .padding(.vertical, 12)
            .background(backgroundColor)
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(borderColor, lineWidth: isFocused ? 2 : 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .scaleEffect(isFocused ? 1.05 : 1.0)
            .animation(.easeInOut(duration: 0.15), value: isFocused)
    }

    private var foregroundColor: Color {
        if isFocused { return .white }
        if isPrimary || isActive { return Theme.accent }
        return Color(white: 0.8)
    }

    private var backgroundColor: Color {
        if isPrimary && isFocused { return Theme.accent.opacity(0.4) }
        if isFocused { return Color.white.opacity(0.15) }
        if isPrimary { return Theme.accent.opacity(0.2) }
        if isActive { return Theme.accent.opacity(0.1) }
        return Color(white: 0.15)
    }

    private var borderColor: Color {
        if isPrimary || isActive { return Theme.accent.opacity(isFocused ? 0.8 : 0.5) }
        if isFocused { return Color.white.opacity(0.4) }
        return Color(white: 0.25)
    }
}
#endif

#if os(tvOS)
private struct DetailEpisodeButtonLabel: View {
    let name: String
    let isSelected: Bool
    @Environment(\.isFocused) private var isFocused

    var body: some View {
        Text(name)
            .font(.caption)
            .foregroundStyle(foregroundColor)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(backgroundColor)
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .stroke(borderColor, lineWidth: isFocused ? 2 : 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .scaleEffect(isFocused ? 1.05 : 1.0)
            .animation(.easeInOut(duration: 0.15), value: isFocused)
    }

    private var foregroundColor: Color {
        if isSelected { return .white }
        if isFocused { return .white }
        return Color(white: 0.7)
    }

    private var backgroundColor: Color {
        if isSelected { return Theme.accent.opacity(0.3) }
        if isFocused { return Color.white.opacity(0.15) }
        return Color(white: 0.15)
    }

    private var borderColor: Color {
        if isSelected { return Theme.accent }
        if isFocused { return Color.white.opacity(0.4) }
        return Color(white: 0.25)
    }
}
#endif
