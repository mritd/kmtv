#if os(iOS)
import SwiftUI
import AVKit

struct PlayerView: View {
    let destination: PlayDestination

    @Environment(AppViewModel.self) private var appVM
    @Environment(\.modelContext) private var modelContext
    @Environment(\.scenePhase) private var scenePhase
    @State private var viewModel: PlayerViewModel?
    @State private var isDescExpanded = false
    @State private var showControls = false
    @State private var hideControlsTask: Task<Void, Never>?
    @State private var isFullScreen = false
    @State private var showPicker = false
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var contentWidth: CGFloat = 0

    var body: some View {
        Group {
            if let viewModel {
                content(viewModel)
            } else {
                ProgressView()
            }
        }
        .background(Surface.canvas)
        .navigationBarTitleDisplayMode(.inline)
        // The bar sits above the video, so it stays black like the player and the back button
        // reads as part of the picture.
        //
        // 导航栏位于视频上方, 因此与播放器一样保持黑色, 返回按钮看起来属于画面的一部分.
        .toolbarBackground(.black, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .navigationTitle("")
        .task {
            // Load detail before playback so source fallback can run before AVPlayer starts.
            //
            // 播放前先加载详情, 让视频源 fallback 在 AVPlayer 启动前完成.
            if viewModel == nil, let client = appVM.apiClient {
                let vm = PlayerViewModel(
					apiClient: client, modelContext: modelContext, serverURL: appVM.serverURL,
					syncStore: appVM.sync?.store, syncEngine: appVM.sync?.engine,
                    sources: destination.sources, sourceKey: destination.sourceKey,
                    videoId: destination.videoId, title: destination.title,
                    coverHint: destination.coverHint,
                    initialEpisodeIndex: destination.resumeIntent?.episodeIndex,
                    localEpisodes: appVM.downloadManager
				)
				viewModel = vm
				await vm.prepareResume()
				let resumeVideoID = vm.currentVideoID.isEmpty ? destination.videoId : vm.currentVideoID
				let ok = await vm.loadDetail(sourceKey: vm.currentSourceKey, videoId: resumeVideoID)
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
        .onChange(of: scenePhase) { _, phase in
            // Checkpoint before the app is suspended; the session flush may run before this one. A
            // local copy's load watchdog pauses in the background and re-arms on return.
            //
            // 应用挂起前保存进度; 会话级补写可能先于这里执行. 本地副本的加载看门狗在后台暂停,
            // 返回前台时重新启用.
            if phase == .background {
                viewModel?.checkpoint()
                viewModel?.suspendLoadWatchdog()
            } else if phase == .active {
                viewModel?.resumeLoadWatchdog()
            }
        }
        .onDisappear {
            hideControlsTask?.cancel()
            viewModel?.pause()
        }
        #if os(iOS)
        .fullScreenCover(isPresented: $isFullScreen) {
            if let vm = viewModel, let player = vm.player {
                ZStack(alignment: .top) {
                    FullScreenPlayerRepresentable(player: player)
                        .ignoresSafeArea()
                        .background(.black)
                    // Layered over AVPlayerViewController rather than inside it: its own
                    // transport bar has no loaded indicator, and its view hierarchy is not
                    // ours to add one to.
                    //
                    // 叠加在 AVPlayerViewController 之上而非置入其中:
                    // 它自带的控制条没有已加载指示, 而其视图层级也不由我们添加.
                    PlayerBufferBadge(vm: vm)
                        .padding(.top, 28)
                }
            }
        }
        #endif
        .sheet(isPresented: $showPicker) {
            if let vm = viewModel, let downloads = appVM.downloadManager, downloads.activeScopeKey != nil,
               let detail = vm.detail {
                DownloadBadgesReader(downloads: downloads, title: detail.title, sourceKey: vm.currentSourceKey,
                                     videoId: vm.currentVideoID) { snapshot in
                    EpisodePickerSheet(
                        title: detail.title, sourceName: vm.currentSourceName, episodes: vm.episodes,
                        badges: snapshot.badges,
                        hints: EpisodePickerModel.otherSourceHints(episodes: vm.episodes, downloads: snapshot.episodes,
                                                                   sourceKey: vm.currentSourceKey),
                        freeSpace: downloads.freeBytes, allowsCellular: downloads.allowsCellular
                    ) { indexes in download(vm, indexes: indexes) }
                }
                // A half-height sheet on a phone; on iPad a full form sheet, since a medium detent
                // there cuts the grid off in a floating card.
                //
                // 手机上为半高面板; iPad 上为完整的表单面板, 因为半高档位在那里会把网格截断在一张浮动卡片里.
                .presentationDetents(sizeClass == .regular ? [.large] : [.medium, .large])
            }
        }
    }

    // MARK: - Content

    /// Width from which a regular-width screen (landscape iPad) puts episodes and settings in a
    /// sidebar beside the video instead of below it.
    ///
    /// regular 宽度屏幕 (横屏 iPad) 达到该宽度时, 剧集与设置放在视频右侧的侧栏, 而非视频下方.
    private static let sidebarMinWidth: CGFloat = 1000

    @ViewBuilder
    private func content(_ vm: PlayerViewModel) -> some View {
        Group {
            if sizeClass == .regular && contentWidth >= Self.sidebarMinWidth {
                wideContent(vm)
            } else {
                stackedContent(vm)
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { contentWidth = $0 }
    }

    /// Phones and portrait iPad: the video on top, everything else scrolling below it.
    ///
    /// 手机与竖屏 iPad: 视频在上, 其余内容在下方滚动.
    private func stackedContent(_ vm: PlayerViewModel) -> some View {
        VStack(spacing: 0) {
            playerSection(vm)

            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.section) {
                    header(vm)
                    episodesSection(vm)
                    playbackSettings(vm)
                    errorLabel(vm)
                }
                .padding(.horizontal, Spacing.page)
                .padding(.top, Spacing.lg + 2)
                .padding(.bottom, Spacing.xxl)
                .background(alignment: .top) { backdrop(vm) }
            }
        }
    }

    /// Landscape iPad: the video and its details on the left, episodes and playback settings in a
    /// sidebar that scrolls on its own, so switching episodes never scrolls the video away.
    ///
    /// 横屏 iPad: 左侧为视频及其详情, 剧集与播放设置位于独立滚动的侧栏中, 切换剧集时视频不会被滚走.
    private func wideContent(_ vm: PlayerViewModel) -> some View {
        HStack(spacing: 0) {
            VStack(spacing: 0) {
                playerSection(vm)
                ScrollView {
                    VStack(alignment: .leading, spacing: Spacing.lg) {
                        header(vm)
                        errorLabel(vm)
                    }
                    .padding(.horizontal, Spacing.xl)
                    .padding(.top, Spacing.lg + 2)
                    .padding(.bottom, Spacing.xxl)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(alignment: .top) { backdrop(vm) }
                }
            }
            .frame(maxWidth: .infinity)

            Divider().ignoresSafeArea(edges: .bottom)

            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.section) {
                    episodesSection(vm)
                    playbackSettings(vm)
                }
                .padding(.horizontal, Spacing.lg)
                .padding(.top, Spacing.lg + 2)
                .padding(.bottom, Spacing.xxl)
            }
            .frame(width: max(340, contentWidth / 3))
        }
    }

    @ViewBuilder
    private func episodesSection(_ vm: PlayerViewModel) -> some View {
        if vm.episodes.count > 1 {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader(Text("Episodes")) {
                    Text("\(vm.episodes.count) episodes")
                        .foregroundStyle(.secondary)
                }
                episodeGrid(vm)
            }
        }
    }

    @ViewBuilder
    private func errorLabel(_ vm: PlayerViewModel) -> some View {
        if let error = vm.error {
            Label(error, systemImage: "exclamationmark.triangle.fill")
                .font(AppFont.footnote)
                .foregroundStyle(.red)
        }
    }

    private func backdrop(_ vm: PlayerViewModel) -> some View {
        PlayerBackdrop(url: coverURL(vm.detail?.cover ?? destination.coverHint),
                       title: vm.detail?.title ?? destination.title)
    }

    private func header(_ vm: PlayerViewModel) -> some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(vm.detail?.title ?? destination.title)
                    .font(AppFont.title)
                    .foregroundStyle(.primary)
                Text(DisplayFormatters.metaLine([
                    vm.episodes.count > 1 ? vm.currentEpisodeName : nil,
                    vm.currentSourceName,
                    vm.detail?.type,
                    vm.detail?.year,
                ], separator: " · "))
                    .font(AppFont.secondary)
                    .foregroundStyle(.secondary)
                if vm.isPlayingLocalCopy {
                    Label("Downloaded", systemImage: "arrow.down.circle.fill")
                        .font(AppFont.footnote)
                        .foregroundStyle(.green)
                }
            }

            // Side by side, or stacked when large text does not fit on one line.
            //
            // 并排显示; 大字号下一行放不下时上下排列.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: Spacing.sm) { headerActions(vm) }
                VStack(alignment: .leading, spacing: Spacing.sm) { headerActions(vm) }
            }

            if let desc = vm.detail?.desc, !desc.isEmpty {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(desc)
                        .font(AppFont.secondary)
                        .foregroundStyle(.secondary)
                        .lineSpacing(3)
                        .lineLimit(isDescExpanded ? nil : 2)
                    Button(isDescExpanded ? "Collapse" : "Expand") {
                        withAnimation(.easeOut(duration: 0.2)) { isDescExpanded.toggle() }
                    }
                    .font(AppFont.secondary)
                    .buttonStyle(.plain)
                    .foregroundStyle(.tint)
                }
            }
        }
    }

    @ViewBuilder
    private func headerActions(_ vm: PlayerViewModel) -> some View {
        Button { vm.toggleFavorite() } label: {
            Label(vm.isFavorited ? "Favorited" : "Favorite",
                  systemImage: vm.isFavorited ? "star.fill" : "star")
        }
        .buttonStyle(.pill(selected: vm.isFavorited))
        .sensoryFeedback(.success, trigger: vm.isFavorited) { _, now in now }
        .accessibilityIdentifier("favoriteButton")

        downloadButton(vm)
    }

    /// Source, line, and skip settings as one group of standard rows.
    ///
    /// 视频源, 线路与跳过设置, 作为一组标准行展示.
    private func playbackSettings(_ vm: PlayerViewModel) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            SectionHeader(Text("Playback"))
            VStack(spacing: 0) {
                sourceRow(vm)
                rowDivider
                if vm.allLines.count > 1 {
                    lineRow(vm)
                    rowDivider
                }
                skipRow(title: "Skip Intro", seconds: vm.skipIntroSeconds) { vm.updateSkipIntro($0) }
                rowDivider
                skipRow(title: "Skip Outro", seconds: vm.skipOutroSeconds) { vm.updateSkipOutro($0) }
            }
            .raisedSurface()
        }
    }

    private var rowDivider: some View {
        Divider().padding(.leading, Spacing.lg)
    }

    @ViewBuilder
    private func sourceRow(_ vm: PlayerViewModel) -> some View {
        let current = vm.sources.first { $0.sourceKey == vm.currentSourceKey }
        let value = HStack(spacing: Spacing.xs + 2) {
            Text(DisplayFormatters.cleanSourceName(vm.currentSourceName))
                .lineLimit(1)
            if let current, current.durationMs > 0 {
                Text(DisplayFormatters.latency(current.durationMs))
                    .font(AppFont.footnote.monospacedDigit())
                    .foregroundStyle(.green)
            }
        }
        if vm.sources.count > 1 {
            Menu {
                ForEach(vm.sources) { source in
                    Button {
                        guard source.sourceKey != vm.currentSourceKey else { return }
                        Task {
                            await vm.switchSource(source.sourceKey)
                            vm.startPlayback()
                        }
                    } label: {
                        if source.sourceKey == vm.currentSourceKey {
                            Label(DisplayFormatters.cleanSourceName(source.sourceName), systemImage: "checkmark")
                        } else {
                            Text(DisplayFormatters.cleanSourceName(source.sourceName))
                        }
                        if source.durationMs > 0 {
                            Text(DisplayFormatters.latency(source.durationMs))
                        }
                    }
                }
            } label: {
                settingRow(title: "Source", chevron: true) { value }
            }
            .tint(.primary)
            .accessibilityIdentifier("sourceMenu")
        } else {
            settingRow(title: "Source", chevron: false) { value }
        }
    }

    private func lineRow(_ vm: PlayerViewModel) -> some View {
        Menu {
            ForEach(0..<vm.allLines.count, id: \.self) { index in
                let isDead = vm.allLines[index].isEmpty
                Button {
                    guard index != vm.currentLineIndex else { return }
                    vm.switchLine(index)
                } label: {
                    if index == vm.currentLineIndex {
                        Label("Line \(index + 1)", systemImage: "checkmark")
                    } else {
                        Text("Line \(index + 1)")
                    }
                    if isDead { Text("Unavailable") }
                }
                .disabled(isDead)
            }
        } label: {
            settingRow(title: "Line", chevron: true) { Text("Line \(vm.currentLineIndex + 1)") }
        }
        .tint(.primary)
        .accessibilityIdentifier("lineMenu")
    }

    private func skipRow(title: LocalizedStringKey, seconds: Int, onChange: @escaping (Int) -> Void) -> some View {
        Stepper(value: Binding(get: { seconds }, set: { onChange(max(0, min(300, $0))) }), in: 0...300, step: 5) {
            HStack {
                Text(title)
                    .foregroundStyle(.primary)
                Spacer()
                Text(seconds == 0 ? String(localized: "Off") : String(localized: "\(seconds) s"))
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
        }
        .font(AppFont.body)
        .padding(.horizontal, Spacing.lg)
        .frame(minHeight: 48)
    }

    /// A standard 17 pt settings row: title on the left, value and an optional menu chevron on the right.
    ///
    /// 标准 17 pt 设置行: 左侧标题, 右侧数值与可选的菜单箭头.
    private func settingRow<Value: View>(title: LocalizedStringKey, chevron: Bool,
                                         @ViewBuilder value: () -> Value) -> some View {
        HStack(spacing: Spacing.sm) {
            Text(title)
                .foregroundStyle(.primary)
            Spacer(minLength: Spacing.md)
            value()
                .foregroundStyle(.secondary)
            if chevron {
                Image(systemName: "chevron.up.chevron.down")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
        }
        .font(AppFont.body)
        .padding(.horizontal, Spacing.lg)
        .frame(minHeight: 48)
        .contentShape(Rectangle())
    }

    // MARK: - Downloads

    private func coverURL(_ cover: String) -> URL? {
        guard !cover.isEmpty else { return nil }
        if cover.hasPrefix("/"), let client = appVM.apiClient { return URL(string: client.baseURL + cover) }
        return URL(string: cover)
    }

    private func download(_ vm: PlayerViewModel, indexes: [Int]) {
        guard let downloads = appVM.downloadManager, let detail = vm.detail else { return }
        let requests = indexes.compactMap { index -> DownloadEpisodeRequest? in
            guard vm.episodes.indices.contains(index) else { return nil }
            return DownloadEpisodeRequest(sourceKey: vm.currentSourceKey, sourceName: vm.currentSourceName,
                                          videoId: vm.currentVideoID, episodeIndex: index,
                                          episodeName: vm.episodes[index].name, lineIndex: vm.currentLineIndex,
                                          episodeCount: vm.episodes.count, episodeURL: vm.episodes[index].url)
        }
        do {
            let added = try downloads.enqueue(show: DownloadShowInfo(title: detail.title, cover: detail.cover,
                                                                     type: detail.type, year: detail.year,
                                                                     coverURL: coverURL(detail.cover)),
                                              episodes: requests)
            ToastManager.shared.show(String(localized: "Added \(added) episodes to downloads"), style: .success)
        } catch DownloadEnqueueError.notEnoughSpace {
            ToastManager.shared.show(String(localized: "Not enough storage"))
        } catch {
            ToastManager.shared.show(String(localized: "Sign in to download"))
        }
    }

    /// The episode grid; with downloads, its badges come from a `DownloadBadgesReader`, so download
    /// progress re-renders the grid at most about twice a second and never this whole page.
    ///
    /// 剧集网格; 启用下载时, 角标来自 `DownloadBadgesReader`, 因此下载进度每秒至多让网格重新渲染约两次,
    /// 且不会重新渲染整个页面.
    @ViewBuilder
    private func episodeGrid(_ vm: PlayerViewModel) -> some View {
        if let downloads = appVM.downloadManager, let detail = vm.detail {
            DownloadBadgesReader(downloads: downloads, title: detail.title, sourceKey: vm.currentSourceKey,
                                 videoId: vm.currentVideoID) { snapshot in
                EpisodeGrid(episodes: vm.episodes, currentIndex: vm.currentEpisodeIndex, badges: snapshot.badges) { index in
                    vm.switchEpisode(index)
                }
            }
        } else {
            EpisodeGrid(episodes: vm.episodes, currentIndex: vm.currentEpisodeIndex) { index in
                vm.switchEpisode(index)
            }
        }
    }

    @ViewBuilder
    private func downloadButton(_ vm: PlayerViewModel) -> some View {
        if let downloads = appVM.downloadManager, vm.detail != nil {
            PlayerDownloadButton(downloads: downloads, multiple: vm.episodes.count > 1) {
                if vm.episodes.count > 1 {
                    downloads.refreshStorage()
                    showPicker = true
                } else {
                    download(vm, indexes: [vm.currentEpisodeIndex])
                }
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

                // Buffering/seeking indicator, its own view so buffering changes skip this body.
                //
                // 缓冲或拖动进度时的状态提示; 作为独立视图, 缓冲状态变化不会让本 body 重新求值.
                PlayerBufferingIndicator(vm: vm)

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
                //
                // 点击背景隐藏控制层, 不拦截按钮点击.
                Color.black.opacity(0.4)
                    .contentShape(Rectangle())
                    .onTapGesture { toggleControls() }

                // Center playback controls in the full overlay.
                //
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
                //
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
    ///
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
            // Time display and progress bar, which change every second; their own view keeps the
            // page body from re-evaluating with them.
            //
            // 每秒变化的播放时间与进度条; 放在独立视图中, 页面 body 不会随之重新求值.
            PlayerTimeBar(vm: vm)

            // Rate menu.
            //
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
                    .font(AppFont.meta.weight(.bold).monospacedDigit())
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
}

/// Time label and progress slider of the inline controls. They read the per-second playback
/// properties here, so only this view re-renders every second, not the whole player page.
///
/// 内嵌控制栏的播放时间与进度条. 每秒变化的播放属性在此读取, 因此每秒只重新渲染本视图, 而不是整个播放页.
private struct PlayerTimeBar: View {
    let vm: PlayerViewModel

    var body: some View {
        // Time display.
        //
        // 播放时间显示.
        Text("\(Self.formatTime(vm.currentTime)) / \(Self.formatTime(vm.duration))")
            .font(AppFont.meta.monospacedDigit())
            .foregroundStyle(.white.opacity(0.8))
            .fixedSize()

        // Progress bar (custom thin slider).
        //
        // 自定义细进度条.
        CustomSlider(
            value: Binding(
                get: { vm.duration > 0 ? vm.currentTime / vm.duration : 0 },
                set: { vm.currentTime = $0 * max(vm.duration, 1) }
            ),
            // A downloaded episode is all on the device, so its track shows fully loaded rather
            // than the player's read-ahead through the loopback server.
            //
            // 已下载的剧集全部在本机, 因此进度条显示为全部已加载, 而不是播放器经由回环服务器的预读进度.
            buffered: vm.isPlayingLocalCopy ? 1 : vm.bufferedFraction,
            onDragStart: { vm.isSeeking = true },
            onDragEnd: { ratio in
                vm.seek(to: ratio * max(vm.duration, 1))
            }
        )
        .frame(height: 32)
        .accessibilityIdentifier("progressSlider")
    }

    private static func formatTime(_ seconds: TimeInterval) -> String {
        guard seconds.isFinite && seconds >= 0 else { return "0:00" }
        let m = Int(seconds) / 60
        let s = Int(seconds) % 60
        return String(format: "%d:%02d", m, s)
    }
}

/// Spinner over the inline player while it buffers or seeks.
///
/// 内嵌播放器缓冲或拖动进度时显示的加载指示.
private struct PlayerBufferingIndicator: View {
    let vm: PlayerViewModel

    var body: some View {
        if vm.isBuffering {
            ProgressView()
                .tint(.white)
                .allowsHitTesting(false)
        }
    }
}

/// The fullscreen buffer badge, reading the buffer itself so the cover content does not.
///
/// 全屏时的缓冲角标; 由它自己读取缓冲量, 全屏内容因此无需读取.
private struct PlayerBufferBadge: View {
    let vm: PlayerViewModel

    var body: some View {
        // Nothing to report for a downloaded episode.
        //
        // 已下载的剧集无需显示缓冲信息.
        if !vm.isPlayingLocalCopy {
            BufferBadge(secondsAhead: vm.bufferedAheadSeconds, isWaiting: vm.isBuffering)
        }
    }
}

/// The player page's download button. Its own view, so the manager state it reads re-renders only
/// this button.
///
/// 播放页的下载按钮. 作为独立视图, 它读取的管理器状态只会重新渲染这个按钮.
private struct PlayerDownloadButton: View {
    let downloads: DownloadManager
    let multiple: Bool
    let action: () -> Void

    var body: some View {
        if downloads.canDownload {
            Button(action: action) {
                Label(multiple ? "Download Episodes" : "Download", systemImage: "arrow.down.circle")
            }
            .buttonStyle(.pill)
            .accessibilityIdentifier("downloadButton")
        }
    }
}

/// The cover, heavily blurred, fading from the top of the page into the canvas; it tints the
/// header with the show's colors.
///
/// 高度模糊的封面, 自页面顶部渐隐到背景色; 用剧集自身的色彩为头部着色.
private struct PlayerBackdrop: View {
    let url: URL?
    let title: String
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        if url != nil || CoverRegistry.cover(for: title) != nil {
            ArtworkImage(url: url, title: title, showsPlaceholder: false)
                .frame(height: 280)
                .frame(maxWidth: .infinity)
                .blur(radius: 50, opaque: true)
                .opacity(colorScheme == .dark ? 0.45 : 0.35)
                .clipped()
                .mask(LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom))
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }
}

// MARK: - Custom Thin Slider

/// A thin progress slider with small round thumb, matching typical video player style.
/// Drag updates the visual position immediately; actual seek happens on drag end.
///
/// 带小圆形滑块的细进度条, 拖动时立即更新视觉位置, 松手后执行真实 seek.
///
/// Fullscreen readout of how many seconds are buffered ahead of the playhead.
///
/// 全屏下显示播放头之前已缓冲秒数的文字提示.
///
/// It stays on screen while the player is waiting for media, which is when a viewer is
/// staring at a stalled picture wanting to know whether anything is arriving. Otherwise it
/// appears briefly as the buffer crosses each band and then gets out of the way — a readout
/// that refreshed on every sample would never leave the screen.
///
/// 播放器正在等待媒体数据时该提示持续显示, 那正是观众盯着卡住的画面
/// 想知道数据是否还在到达的时刻. 其余情况下, 它在缓冲每跨越一个区间时短暂出现随即让开 —
/// 若每次采样都刷新, 这个提示将永远不会从画面上消失.
struct BufferBadge: View {
    let secondsAhead: TimeInterval
    let isWaiting: Bool

    @State private var shown = true
    @State private var hideTask: Task<Void, Never>?

    var body: some View {
        Text(String(localized: "Buffered \(Int(secondsAhead))s"))
            .font(.caption.monospacedDigit())
            .foregroundStyle(.white)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(.black.opacity(0.55), in: Capsule())
            .opacity(isWaiting || shown ? 1 : 0)
            .animation(.easeInOut(duration: 0.3), value: shown)
            .animation(.easeInOut(duration: 0.3), value: isWaiting)
            // The badge must never intercept a tap meant for the controls underneath.
            //
            // 该提示绝不能拦截本应传给下方控件的点击.
            .allowsHitTesting(false)
            .accessibilityIdentifier("bufferBadge")
            .onAppear { showBriefly() }
            .onChange(of: PlayerViewModel.bufferBadgeBand(secondsAhead)) { _, _ in showBriefly() }
            .onDisappear { hideTask?.cancel() }
    }

    private func showBriefly() {
        shown = true
        hideTask?.cancel()
        hideTask = Task {
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled else { return }
            shown = false
        }
    }
}

// Internal rather than private so a test can render it: the buffered track is three
// overlapping capsules, and layer order and width are only observable in pixels.
//
// 使用 internal 而非 private 以便测试渲染它: 已缓冲轨道由三条重叠的胶囊构成,
// 其层叠顺序与宽度只能在像素层面观察到.
struct CustomSlider: View {
    @Binding var value: Double // 0...1
    var buffered: Double = 0 // 0...1
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
                //
                // 轨道背景.
                Capsule()
                    .fill(Color.white.opacity(0.3))
                    .frame(height: 3)

                // Buffered track, between the background and the played fill so the played
                // portion still reads as the brightest thing on the bar.
                //
                // 已缓冲轨道, 位于背景与已播放填充之间,
                // 使已播放部分仍是进度条上最亮的一层.
                Capsule()
                    .fill(Color.white.opacity(0.5))
                    .frame(width: max(0, width * CGFloat(max(0, min(1, buffered)))), height: 3)

                // Track fill.
                //
                // 已播放进度.
                Capsule()
                    .fill(Color.white)
                    .frame(width: max(0, thumbX), height: 3)

                // Thumb.
                //
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
                        //
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
