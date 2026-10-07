#if os(iOS)
import SwiftUI

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
            .onChange(of: Self.band(secondsAhead)) { _, _ in showBriefly() }
            .onDisappear { hideTask?.cancel() }
    }

    /// Which 30-second band the forward buffer currently sits in.
    ///
    /// 当前前向缓冲所处的 30 秒区间.
    ///
    /// The fullscreen readout appears when this changes rather than on every sample: the
    /// buffer moves each second while filling, and a readout that re-appeared that often
    /// would never be off the screen. Crossing a band is the moment worth a glance, in
    /// either direction — filling up, or collapsing back on a stall.
    ///
    /// 全屏文字提示在该值变化时出现, 而非每次采样都出现:
    /// 缓冲填充期间每秒都在变, 每次都重新出现的提示将永远不会从画面上消失.
    /// 跨越一个区间才是值得看一眼的时刻, 两个方向都是 — 填满, 或卡顿时回落.
    static func band(_ secondsAhead: TimeInterval) -> Int {
        guard secondsAhead.isFinite, secondsAhead > 0 else { return 0 }
        return Int(secondsAhead / 30)
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

/// The fullscreen buffer badge, reading the buffer itself so the cover content does not.
///
/// 全屏时的缓冲角标; 由它自己读取缓冲量, 全屏内容因此无需读取.
struct PlayerBufferBadge: View {
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
#endif
