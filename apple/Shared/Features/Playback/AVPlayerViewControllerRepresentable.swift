import AVFoundation
import AVKit
import os
import SwiftUI

// MARK: - Inline Player (AVPlayerLayer, no system controls)

/// Bare video layer for inline playback. No system controls, no fullscreen button.
/// Custom controls are provided by PlayerView's overlay.
/// 内嵌播放只暴露视频图层, 系统控制由 PlayerView 自定义遮罩提供.
struct InlinePlayerView: UIViewRepresentable {
    let player: AVPlayer?
    private let logger = Logger(subsystem: "com.mritd.kmtv", category: "playback")

    func makeUIView(context: Context) -> PlayerLayerView {
        let view = PlayerLayerView()
        logger.info("inlinePlayer.makeUIView hasPlayer=\(self.player != nil, privacy: .public)")
        view.player = player
        return view
    }

    func updateUIView(_ view: PlayerLayerView, context: Context) {
        logger.info(
            "inlinePlayer.updateUIView viewHasPlayer=\(view.player != nil, privacy: .public) incomingHasPlayer=\(self.player != nil, privacy: .public) willReplace=\(view.player !== self.player, privacy: .public)"
        )
        if view.player !== player {
            view.player = player
        }
    }

    static func dismantleUIView(_ view: PlayerLayerView, coordinator: ()) {
        Logger(subsystem: "com.mritd.kmtv", category: "playback")
            .info("inlinePlayer.dismantleUIView viewHasPlayer=\(view.player != nil, privacy: .public)")
        view.player = nil
    }
}

/// UIView backed by AVPlayerLayer for video rendering.
/// 使用 AVPlayerLayer 渲染视频的 UIView.
class PlayerLayerView: UIView {
    override class var layerClass: AnyClass { AVPlayerLayer.self }

    var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }

    var player: AVPlayer? {
        get { playerLayer.player }
        set {
            Logger(subsystem: "com.mritd.kmtv", category: "playback")
                .info("playerLayer.setPlayer hasPlayer=\(newValue != nil, privacy: .public)")
            playerLayer.player = newValue
        }
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        playerLayer.videoGravity = .resizeAspect
        backgroundColor = .black
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
}

// MARK: - Fullscreen Player (AVPlayerViewController, full system controls)

/// Fullscreen player presented via SwiftUI .fullScreenCover.
/// Receives the shared AVPlayer instance — no new player created.
/// 全屏播放器接收同一个 AVPlayer 实例, 不创建新的播放器.
struct FullScreenPlayerRepresentable: UIViewControllerRepresentable {
    let player: AVPlayer?

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let vc = AVPlayerViewController()
        vc.player = player
        #if os(iOS)
        vc.allowsVideoFrameAnalysis = false
        #endif
        vc.speeds = [
            AVPlaybackSpeed(rate: 1.0, localizedName: "1x"),
            AVPlaybackSpeed(rate: 1.5, localizedName: "1.5x"),
            AVPlaybackSpeed(rate: 2.0, localizedName: "2x"),
        ]
        return vc
    }

    func updateUIViewController(_ vc: AVPlayerViewController, context: Context) {
        if vc.player !== player {
            vc.player = player
        }
    }

    static func dismantleUIViewController(_ vc: AVPlayerViewController, coordinator: ()) {
        vc.player = nil
    }
}

#if os(tvOS)
/// Presents AVPlayerViewController via UIKit from the window's root VC.
/// Avoids SwiftUI fullScreenCover bug (tab bar disappears) and avoids
/// Menu press propagating to NavigationStack.
/// 通过 UIKit 从根 VC 展示播放器, 避免 tvOS 上 SwiftUI fullScreenCover 导致 tab bar 丢失.
@MainActor
enum TVPlayerPresentation {
    private static var coordinator: Coordinator?

    @MainActor
    static func present(player: AVPlayer, onDismiss: @escaping () -> Void) {
        guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let rootVC = scene.windows.first?.rootViewController else { return }

        // Find the topmost presented VC.
        // 找到当前最上层已经展示的 VC.
        var topVC = rootVC
        while let presented = topVC.presentedViewController {
            topVC = presented
        }

        let playerVC = AVPlayerViewController()
        playerVC.player = player
        playerVC.speeds = [
            AVPlaybackSpeed(rate: 1.0, localizedName: "1x"),
            AVPlaybackSpeed(rate: 1.5, localizedName: "1.5x"),
            AVPlaybackSpeed(rate: 2.0, localizedName: "2x"),
        ]
        let coord = Coordinator(onDismiss: onDismiss)
        coordinator = coord
        playerVC.delegate = coord
        topVC.present(playerVC, animated: true)
    }

    @MainActor
    class Coordinator: NSObject, AVPlayerViewControllerDelegate {
        let onDismiss: () -> Void
        init(onDismiss: @escaping () -> Void) { self.onDismiss = onDismiss }

        nonisolated func playerViewControllerShouldDismiss(_ playerViewController: AVPlayerViewController) -> Bool {
            true
        }

        nonisolated func playerViewControllerDidEndDismissalTransition(_ playerViewController: AVPlayerViewController) {
            MainActor.assumeIsolated {
                playerViewController.player = nil
                onDismiss()
                TVPlayerPresentation.coordinator = nil
            }
        }
    }
}
#endif
