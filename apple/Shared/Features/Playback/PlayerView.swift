#if os(iOS)
import SwiftUI
import AVKit

struct PlayerView: View {
    let destination: PlayDestination

    @Environment(AppViewModel.self) private var appVM
    @Environment(\.modelContext) private var modelContext
    @State private var viewModel: PlayerViewModel?
    @State private var isDescExpanded = false
    @State private var showControls = false
    @State private var hideControlsTask: Task<Void, Never>?
    @State private var isFullScreen = false

    var body: some View {
        Group {
            if let viewModel {
                content(viewModel)
            } else {
                ProgressView()
            }
        }
        .background(Theme.bgPrimary)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.bgPrimary, for: .navigationBar)
        #endif
        .navigationTitle("")
        .task {
            // Load detail before playback so source fallback can run before AVPlayer starts.
            // 播放前先加载详情, 让视频源 fallback 在 AVPlayer 启动前完成.
            if viewModel == nil, let client = appVM.apiClient {
                let vm = PlayerViewModel(
                    apiClient: client, modelContext: modelContext, serverURL: appVM.serverURL,
                    sources: destination.sources, sourceKey: destination.sourceKey,
                    videoId: destination.videoId, title: destination.title,
                    coverHint: destination.coverHint,
                    initialEpisodeIndex: destination.resumeIntent?.episodeIndex
                )
                viewModel = vm
                let ok = await vm.loadDetail(sourceKey: destination.sourceKey, videoId: destination.videoId)
                guard !Task.isCancelled else { return }
                if !ok {
                    await vm.handlePlaybackError()
                }
                guard !Task.isCancelled else { return }
                vm.startPlayback()
            }
        }
        .onAppear {
            viewModel?.resume()
        }
        .onDisappear {
            hideControlsTask?.cancel()
            viewModel?.pause()
        }
        #if os(iOS)
        .fullScreenCover(isPresented: $isFullScreen) {
            if let player = viewModel?.player {
                FullScreenPlayerRepresentable(player: player)
                    .ignoresSafeArea()
                    .background(.black)
            }
        }
        #endif
    }

    // MARK: - Content

    @ViewBuilder
    private func content(_ vm: PlayerViewModel) -> some View {
        VStack(spacing: 0) {
            playerSection(vm)

            ScrollView {
                ZStack(alignment: .topLeading) {
                    LinearGradient(
                        colors: [Theme.bgSecondary, Theme.bgPrimary],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .frame(height: 300)

                    VStack(alignment: .leading, spacing: 16) {
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("\(vm.detail?.title ?? destination.title) \(vm.currentEpisodeName)")
                                    .font(.headline)
                                    .foregroundStyle(Theme.textPrimary)
                                Text("\(vm.currentSourceName) | \(vm.detail?.type ?? "") \(vm.detail?.year ?? "")")
                                    .font(.caption)
                                    .foregroundStyle(Theme.textSecondary)
                            }
                            Spacer()
                            Button { vm.toggleFavorite() } label: {
                                Image(systemName: vm.isFavorited ? "star.fill" : "star")
                                    .foregroundStyle(vm.isFavorited ? .yellow : Theme.textSecondary)
                            }
                            .accessibilityIdentifier("favoriteButton")
                        }

                        if let desc = vm.detail?.desc, !desc.isEmpty {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(desc)
                                    .font(.caption)
                                    .foregroundStyle(Theme.textSecondary)
                                    .lineLimit(isDescExpanded ? nil : 2)

                                Button {
                                    withAnimation { isDescExpanded.toggle() }
                                } label: {
                                    Text(isDescExpanded ? "Collapse" : "Expand")
                                        .font(.caption2)
                                        .foregroundStyle(Theme.accent)
                                }
                                .buttonStyle(.plain)
                            }
                        }

                        if vm.sources.count > 1 {
                            sectionTitle("Sources")
                            SourceSwitcher(sources: vm.sources, currentKey: vm.currentSourceKey) { key in
                                Task {
                                    await vm.switchSource(key)
                                    vm.startPlayback()
                                }
                            }
                        }

                        if vm.allLines.count > 1 {
                            sectionTitle("CDN Lines")
                            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 5), spacing: 6) {
                                ForEach(0..<vm.allLines.count, id: \.self) { i in
                                    let isDead = vm.allLines[i].isEmpty
                                    Button {
                                        if !isDead { vm.switchLine(i) }
                                    } label: {
                                        Group {
                                            if isDead {
                                                Text("Line \(i + 1) ✕")
                                                    .strikethrough()
                                            } else {
                                                Text("Line \(i + 1)")
                                            }
                                        }
                                        .font(.caption2)
                                        .frame(maxWidth: .infinity)
                                        .padding(.vertical, 8)
                                        .background(i == vm.currentLineIndex ? Theme.accent : Theme.bgCard)
                                        .foregroundStyle(i == vm.currentLineIndex ? .white : isDead ? Theme.textSecondary.opacity(0.5) : Theme.textPrimary)
                                        .clipShape(RoundedRectangle(cornerRadius: 6))
                                    }
                                    .buttonStyle(.plain)
                                    .disabled(isDead)
                                }
                            }
                        }

                        // Skip intro/outro settings.
                        // 跳过片头片尾设置.
                        skipSettingsSection(vm)

                        if vm.episodes.count > 1 {
                            sectionTitle("Episodes")
                            EpisodeGrid(episodes: vm.episodes, currentIndex: vm.currentEpisodeIndex) { index in
                                vm.switchEpisode(index)
                            }
                        }

                        if let error = vm.error {
                            Text(error)
                                .foregroundStyle(.red)
                                .font(.caption)
                        }
                    }
                    .padding()
                }
                .padding(.bottom, 40)
            }
        }
    }

    // MARK: - Player Section

    @ViewBuilder
    private func playerSection(_ vm: PlayerViewModel) -> some View {
        ZStack {
            Color.black

            if vm.player != nil {
                InlinePlayerView(player: vm.player)

                // Buffering/seeking indicator.
                // 缓冲或拖动进度时的状态提示.
                if vm.isBuffering {
                    ProgressView()
                        .tint(.white)
                        .allowsHitTesting(false)
                }

                playerOverlay(vm)
            } else if vm.isLoadingDetail {
                ProgressView()
            }
        }
        .aspectRatio(16.0 / 9.0, contentMode: .fit)
        .clipped()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("playerSection")
    }

    // MARK: - Custom Controls Overlay

    @ViewBuilder
    private func playerOverlay(_ vm: PlayerViewModel) -> some View {
        ZStack {
            if showControls {
                // Background tap dismisses controls without intercepting button taps.
                // 点击背景隐藏控制层, 不拦截按钮点击.
                Color.black.opacity(0.4)
                    .contentShape(Rectangle())
                    .onTapGesture { toggleControls() }

                // Center playback controls in the full overlay.
                // 在完整遮罩层中居中放置播放控制.
                HStack(spacing: 32) {
                    playerButton(systemName: "gobackward.10", iconSize: 28) {
                        vm.skip(by: -10)
                    }
                    .accessibilityIdentifier("skipBackward")

                    playerButton(systemName: vm.isPlaying ? "pause.fill" : "play.fill", iconSize: 36) {
                        vm.togglePlayPause()
                    }
                    .accessibilityIdentifier("playPause")

                    playerButton(systemName: "goforward.10", iconSize: 28) {
                        vm.skip(by: 10)
                    }
                    .accessibilityIdentifier("skipForward")
                }

                // Bottom bar pinned to bottom.
                // 底部控制栏固定在遮罩底部.
                VStack {
                    Spacer()
                    bottomBar(vm)
                }
            } else {
                Color.clear
                    .contentShape(Rectangle())
                    .onTapGesture { toggleControls() }
            }
        }
        .animation(.easeInOut(duration: 0.2), value: showControls)
    }

    // MARK: - Player Button

    /// All player buttons use a uniform 48x48 touch target with centered icon.
    /// 所有播放按钮都使用统一的 48x48 点击区域并居中图标.
    private func playerButton(systemName: String, iconSize: CGFloat, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: iconSize, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 48, height: 48)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isButton)
    }

    // MARK: - Bottom Bar

    @ViewBuilder
    private func bottomBar(_ vm: PlayerViewModel) -> some View {
        HStack(spacing: 8) {
            // Time display.
            // 播放时间显示.
            Text("\(formatTime(vm.currentTime)) / \(formatTime(vm.duration))")
                .font(.caption2.monospacedDigit())
                .foregroundStyle(.white.opacity(0.8))
                .fixedSize()

            // Progress bar (custom thin slider).
            // 自定义细进度条.
            CustomSlider(
                value: Binding(
                    get: { vm.duration > 0 ? vm.currentTime / vm.duration : 0 },
                    set: { vm.currentTime = $0 * max(vm.duration, 1) }
                ),
                onDragStart: { vm.isSeeking = true },
                onDragEnd: { ratio in
                    vm.seek(to: ratio * max(vm.duration, 1))
                }
            )
            .frame(height: 32)
            .accessibilityIdentifier("progressSlider")

            // Rate menu.
            // 倍速菜单.
            Menu {
                ForEach([1.0, 1.5, 2.0], id: \.self) { rate in
                    Button {
                        vm.setRate(Float(rate))
                    } label: {
                        Text(rate == 1.0 ? "1x" : "\(rate, specifier: "%.2g")x")
                    }
                }
            } label: {
                Text("\(vm.playbackRate, specifier: "%.2g")x")
                    .font(.caption2.bold())
                    .foregroundStyle(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.white.opacity(0.2))
                    .clipShape(RoundedRectangle(cornerRadius: 4))
            }
            .accessibilityIdentifier("rateMenu")

            #if os(iOS)
            playerButton(systemName: "arrow.up.left.and.arrow.down.right", iconSize: 16) {
                isFullScreen = true
            }
            .accessibilityIdentifier("fullscreenButton")
            #endif
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
    }

    // MARK: - Skip Settings

    @ViewBuilder
    private func skipSettingsSection(_ vm: PlayerViewModel) -> some View {
        HStack(spacing: 12) {
            skipChip(label: String(localized: "Skip Intro"), seconds: vm.skipIntroSeconds) { delta in
                vm.updateSkipIntro(max(0, min(300, vm.skipIntroSeconds + delta)))
            }
            skipChip(label: String(localized: "Skip Outro"), seconds: vm.skipOutroSeconds) { delta in
                vm.updateSkipOutro(max(0, min(300, vm.skipOutroSeconds + delta)))
            }
            Spacer()
        }
    }

    private func skipChip(label: String, seconds: Int, onChange: @escaping (Int) -> Void) -> some View {
        HStack(spacing: 0) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(Theme.textSecondary)
                .padding(.leading, 8)

            Text("\(seconds)s")
                .font(.caption2.monospacedDigit())
                .foregroundStyle(Theme.textSecondary)
                .frame(width: 36, alignment: .trailing)

            Button { onChange(-5) } label: {
                Image(systemName: "minus")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(seconds > 0 ? Theme.textPrimary : Theme.textSecondary.opacity(0.3))
                    .frame(width: 36, height: 36)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(seconds <= 0)

            Button { onChange(5) } label: {
                Image(systemName: "plus")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
                    .frame(width: 36, height: 36)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .background(Theme.bgCard)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    // MARK: - Helpers

    private func toggleControls() {
        showControls.toggle()
        hideControlsTask?.cancel()
        if showControls {
            hideControlsTask = Task {
                try? await Task.sleep(for: .seconds(5))
                guard !Task.isCancelled else { return }
                withAnimation { showControls = false }
            }
        }
    }

    private func formatTime(_ seconds: TimeInterval) -> String {
        guard seconds.isFinite && seconds >= 0 else { return "0:00" }
        let m = Int(seconds) / 60
        let s = Int(seconds) % 60
        return String(format: "%d:%02d", m, s)
    }

    private func sectionTitle(_ title: LocalizedStringKey) -> some View {
        Text(title)
            .font(.subheadline.bold())
            .foregroundStyle(Theme.textSecondary)
    }
}

// MARK: - Custom Thin Slider

/// A thin progress slider with small round thumb, matching typical video player style.
/// Drag updates the visual position immediately; actual seek happens on drag end.
/// 带小圆形滑块的细进度条, 拖动时立即更新视觉位置, 松手后执行真实 seek.
private struct CustomSlider: View {
    @Binding var value: Double // 0...1
    var onDragStart: () -> Void = {}
    var onDragEnd: (Double) -> Void = { _ in }

    @State private var isDragging = false
    @State private var dragValue: Double = 0

    private var displayValue: Double {
        isDragging ? dragValue : value
    }

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            let clamped = max(0, min(1, displayValue))
            let thumbX = width * CGFloat(clamped)

            ZStack(alignment: .leading) {
                // Track background.
                // 轨道背景.
                Capsule()
                    .fill(Color.white.opacity(0.3))
                    .frame(height: 3)

                // Track fill.
                // 已播放进度.
                Capsule()
                    .fill(Color.white)
                    .frame(width: max(0, thumbX), height: 3)

                // Thumb.
                // 拖动滑块.
                Circle()
                    .fill(Color.white)
                    .frame(width: isDragging ? 14 : 8, height: isDragging ? 14 : 8)
                    .offset(x: max(0, thumbX - (isDragging ? 7 : 4)))
            }
            .frame(height: geo.size.height)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { drag in
                        if !isDragging {
                            isDragging = true
                            onDragStart()
                        }
                        let ratio = Double(drag.location.x / width)
                        dragValue = max(0, min(1, ratio))
                        // Update binding for live time display.
                        // 拖动时同步更新时间显示.
                        value = dragValue
                    }
                    .onEnded { _ in
                        isDragging = false
                        onDragEnd(dragValue)
                    }
            )
        }
    }
}
#endif
