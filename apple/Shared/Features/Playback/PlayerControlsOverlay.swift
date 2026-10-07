#if os(iOS)
import SwiftUI

/// The inline video area: the video layer, the buffering spinner, and the controls overlay, or a
/// spinner while the detail loads. Its own view, so a new player or a detail load re-renders only
/// this area.
///
/// 内嵌视频区域: 视频图层, 缓冲指示与控制遮罩; 详情加载期间显示加载指示. 作为独立视图, 播放器替换或
/// 详情加载只会重新渲染这一区域.
struct PlayerVideoSection: View {
    let vm: PlayerViewModel
    /// Called when the user asks for the system fullscreen player.
    ///
    /// 用户请求进入系统全屏播放器时调用.
    let onFullScreen: () -> Void

    var body: some View {
        ZStack {
            Color.black

            if vm.player != nil {
                InlinePlayerView(player: vm.player)

                // Buffering/seeking indicator, its own view so buffering changes skip this body.
                //
                // 缓冲或拖动进度时的状态提示; 作为独立视图, 缓冲状态变化不会让本 body 重新求值.
                PlayerBufferingIndicator(vm: vm)

                PlayerControlsOverlay(vm: vm, onFullScreen: onFullScreen)
            } else if vm.isLoadingDetail {
                ProgressView()
            }
        }
        .aspectRatio(16.0 / 9.0, contentMode: .fit)
        .clipped()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("playerSection")
    }
}

/// The custom controls over the inline video: a tap shows or hides them, and they hide on their own
/// 5 seconds after the last interaction. It owns that visibility and its timer, so a tap or a
/// control update re-renders only this overlay, never the rest of the page.
///
/// 内嵌视频上的自定义控制层: 点按显示或隐藏, 最后一次操作 5 秒后自动隐藏. 显隐状态与计时器由它持有,
/// 因此点按或控件更新只会重新渲染本遮罩, 不会波及页面其余部分.
struct PlayerControlsOverlay: View {
    let vm: PlayerViewModel
    /// Called when the user asks for the system fullscreen player.
    ///
    /// 用户请求进入系统全屏播放器时调用.
    let onFullScreen: () -> Void

    @State private var showControls = false
    @State private var hideControlsTask: Task<Void, Never>?

    var body: some View {
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
                    bottomBar
                }
            } else {
                Color.clear
                    .contentShape(Rectangle())
                    .onTapGesture { toggleControls() }
            }
        }
        .animation(.easeInOut(duration: 0.2), value: showControls)
        .onDisappear { hideControlsTask?.cancel() }
    }

    // MARK: - Player Button

    /// All player buttons use a uniform 48x48 touch target with centered icon.
    ///
    /// 所有播放按钮都使用统一的 48x48 点击区域并居中图标.
    private func playerButton(systemName: String, iconSize: CGFloat, action: @escaping () -> Void) -> some View {
        Button {
            action()
            scheduleHideControls()
        } label: {
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

    private var bottomBar: some View {
        HStack(spacing: 8) {
            // Time display and progress bar, which change every second; their own view keeps the
            // overlay body from re-evaluating with them.
            //
            // 每秒变化的播放时间与进度条; 放在独立视图中, 遮罩 body 不会随之重新求值.
            PlayerTimeBar(vm: vm) { scrubbing in
                // A drag holds the controls on screen; removing the slider mid-drag would strand it.
                //
                // 拖动期间控制层保持显示; 拖动中移除进度条会让拖动无法结束.
                if scrubbing {
                    hideControlsTask?.cancel()
                } else {
                    scheduleHideControls()
                }
            }

            rateMenu

            playerButton(systemName: "arrow.up.left.and.arrow.down.right", iconSize: 16) {
                onFullScreen()
            }
            .accessibilityIdentifier("fullscreenButton")
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
    }

    private var rateMenu: some View {
        Menu {
            ForEach(PlaybackRates.all, id: \.self) { rate in
                Button {
                    vm.setRate(rate)
                    scheduleHideControls()
                } label: {
                    Text(PlaybackRates.label(rate))
                }
            }
        } label: {
            // Transparent padding keeps the tap target as tall as before the shared badge.
            //
            // 透明内边距使点按区域保持与改用共享角标前一样高.
            AppBadge(verbatim: PlaybackRates.label(vm.playbackRate), tone: .overlay)
                .padding(.vertical, Spacing.xxs)
                .contentShape(Rectangle())
        }
        .accessibilityIdentifier("rateMenu")
    }

    // MARK: - Visibility

    private func toggleControls() {
        showControls.toggle()
        if showControls {
            scheduleHideControls()
        } else {
            hideControlsTask?.cancel()
        }
    }

    /// Hides the controls 5 seconds from now, restarting the countdown; any control interaction
    /// calls it, so the controls stay while they are being used.
    ///
    /// 从现在起 5 秒后隐藏控制层, 并重新开始倒计时; 每次操作控件都会调用它, 因此使用期间控制层保持显示.
    private func scheduleHideControls() {
        hideControlsTask?.cancel()
        guard showControls else { return }
        hideControlsTask = Task {
            try? await Task.sleep(for: .seconds(5))
            guard !Task.isCancelled else { return }
            withAnimation { showControls = false }
        }
    }
}

/// Time label and progress slider of the inline controls. They read the per-second playback
/// properties here, so only this view re-renders every second, not the overlay or the page.
///
/// 内嵌控制栏的播放时间与进度条. 每秒变化的播放属性在此读取, 因此每秒只重新渲染本视图, 而不是遮罩或整个
/// 播放页.
struct PlayerTimeBar: View {
    let vm: PlayerViewModel
    /// Called with true when a drag on the progress bar starts and false when it ends or is cancelled.
    ///
    /// 进度条拖动开始时以 true 调用, 结束或取消时以 false 调用.
    var onScrubbingChanged: (Bool) -> Void = { _ in }

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
                set: { vm.updateScrub(toFraction: $0) }
            ),
            // A downloaded episode is all on the device, so its track shows fully loaded rather
            // than the player's read-ahead through the loopback server.
            //
            // 已下载的剧集全部在本机, 因此进度条显示为全部已加载, 而不是播放器经由回环服务器的预读进度.
            buffered: vm.isPlayingLocalCopy ? 1 : vm.bufferedFraction,
            onDragStart: {
                vm.beginScrub()
                onScrubbingChanged(true)
            },
            onDragEnd: { ratio in
                vm.endScrub(atFraction: ratio)
                onScrubbingChanged(false)
            },
            onDragCancel: {
                vm.cancelScrub()
                onScrubbingChanged(false)
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
struct PlayerBufferingIndicator: View {
    let vm: PlayerViewModel

    var body: some View {
        if vm.isBuffering {
            ProgressView()
                .tint(.white)
                .allowsHitTesting(false)
        }
    }
}
#endif
