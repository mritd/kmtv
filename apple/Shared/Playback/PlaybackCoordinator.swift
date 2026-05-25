import AVFoundation
import Foundation
import os

@MainActor
final class PlaybackCoordinator {
    private(set) var player: AVPlayer?
    private let logger = Logger(subsystem: "com.mritd.kmtv", category: "playback")
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?
    private var errorObserver: NSObjectProtocol?
    private var statusObservers: [NSKeyValueObservation] = []

    /// Starts or replaces playback with a resolved URL.
    /// 使用已解析的 URL 开始播放或替换当前播放项.
    func start(
        url: URL,
        startTime: TimeInterval,
        rate: Float,
        onTime: @escaping @MainActor @Sendable (TimeInterval, TimeInterval) -> Void,
        onEnd: @escaping @MainActor @Sendable () -> Void,
        onError: @escaping @MainActor @Sendable (String?) -> Void
    ) {
        removeObservers()
        logger.info("coordinator.start url=\(url.absoluteString, privacy: .public) startTime=\(startTime, privacy: .public) rate=\(rate, privacy: .public)")
        let item = AVPlayerItem(url: url)
        if let player {
            logger.info("coordinator.start replacing current item")
            player.replaceCurrentItem(with: item)
        } else {
            logger.info("coordinator.start creating AVPlayer")
            player = AVPlayer(playerItem: item)
        }
        setupObservers(for: item, onTime: onTime, onEnd: onEnd, onError: onError)
        if startTime > 0 {
            player?.seek(to: CMTime(seconds: startTime, preferredTimescale: 600))
        }
        player?.play()
        if rate != 1.0 {
            player?.rate = rate
        }
        logPlayerState("afterPlay", item: item)
    }

    func pause() {
        player?.pause()
    }

    func resume(rate: Float) {
        player?.play()
        if rate != 1.0 {
            player?.rate = rate
        }
    }

    func cleanup() {
        logger.info("coordinator.cleanup hasPlayer=\(self.player != nil, privacy: .public)")
        pause()
        removeObservers()
        player = nil
    }

    private func setupObservers(
        for item: AVPlayerItem,
        onTime: @escaping @MainActor @Sendable (TimeInterval, TimeInterval) -> Void,
        onEnd: @escaping @MainActor @Sendable () -> Void,
        onError: @escaping @MainActor @Sendable (String?) -> Void
    ) {
        guard let player else { return }
        logPlayerState("setupObservers", item: item)
        let interval = CMTime(seconds: 1, preferredTimescale: 600)
        // The time observer owns resume progress updates, so keep its cadence coarse.
        // 时间观察器负责续播进度更新, 因此保持较低频率避免写入过密.
        timeObserver = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            MainActor.assumeIsolated {
                let current = CMTimeGetSeconds(time)
                let total = CMTimeGetSeconds(self?.player?.currentItem?.duration ?? .zero)
                guard current.isFinite && total.isFinite && total > 0 else { return }
                onTime(current, total)
            }
        }
        setupStatusObservers(for: item, player: player)
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { _ in
            // AVFoundation callbacks arrive outside SwiftUI state flow; hop back to MainActor.
            // AVFoundation 回调不属于 SwiftUI 状态流, 需要回到 MainActor.
            MainActor.assumeIsolated { self.logger.info("coordinator.endNotification") }
            MainActor.assumeIsolated { onEnd() }
        }
        errorObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemFailedToPlayToEndTime,
            object: item,
            queue: .main
        ) { notification in
            let message = (notification.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error)?.localizedDescription
            // Log before surfacing the error so black-screen diagnostics keep AVPlayer state.
            // 上抛错误前先记录状态, 便于保留黑屏问题的 AVPlayer 证据.
            MainActor.assumeIsolated {
                self.logger.error("coordinator.errorNotification message=\(message ?? "unknown", privacy: .public)")
                self.logPlayerState("errorNotification", item: item)
            }
            MainActor.assumeIsolated { onError(message) }
        }
    }

    /// Observes AVFoundation playback state changes that do not surface through SwiftUI.
    /// 观察 SwiftUI 不会自动暴露的 AVFoundation 播放状态变化.
    private func setupStatusObservers(for item: AVPlayerItem, player: AVPlayer) {
        statusObservers = [
            item.observe(\.status, options: [.initial, .new]) { [weak self, weak item] _, _ in
                MainActor.assumeIsolated {
                    guard let self, let item else { return }
                    self.logPlayerState("item.status", item: item)
                }
            },
            item.observe(\.isPlaybackLikelyToKeepUp, options: [.initial, .new]) { [weak self, weak item] _, _ in
                MainActor.assumeIsolated {
                    guard let self, let item else { return }
                    self.logPlayerState("item.keepUp", item: item)
                }
            },
            item.observe(\.isPlaybackBufferEmpty, options: [.initial, .new]) { [weak self, weak item] _, _ in
                MainActor.assumeIsolated {
                    guard let self, let item else { return }
                    self.logPlayerState("item.bufferEmpty", item: item)
                }
            },
            player.observe(\.timeControlStatus, options: [.initial, .new]) { [weak self, weak item] _, _ in
                MainActor.assumeIsolated {
                    guard let self, let item else { return }
                    self.logPlayerState("player.timeControlStatus", item: item)
                }
            },
        ]
    }

    /// Records the compact playback state needed to diagnose black-screen playback.
    /// 记录定位黑屏播放问题所需的精简播放状态.
    private func logPlayerState(_ event: String, item: AVPlayerItem) {
        logger.info(
            "coordinator.state event=\(event, privacy: .public) itemStatus=\(Self.describeItemStatus(item.status), privacy: .public) timeControlStatus=\(Self.describeTimeControlStatus(self.player?.timeControlStatus), privacy: .public) keepUp=\(item.isPlaybackLikelyToKeepUp, privacy: .public) bufferEmpty=\(item.isPlaybackBufferEmpty, privacy: .public) itemError=\(item.error?.localizedDescription ?? "none", privacy: .public) playerError=\(self.player?.error?.localizedDescription ?? "none", privacy: .public)"
        )
    }

    static func describeTimeControlStatus(_ status: AVPlayer.TimeControlStatus?) -> String {
        guard let status else { return "nil" }
        switch status {
        case .paused:
            return "paused"
        case .waitingToPlayAtSpecifiedRate:
            return "waitingToPlayAtSpecifiedRate"
        case .playing:
            return "playing"
        @unknown default:
            return "unknown"
        }
    }

    private static func describeItemStatus(_ status: AVPlayerItem.Status) -> String {
        switch status {
        case .unknown:
            return "unknown"
        case .readyToPlay:
            return "readyToPlay"
        case .failed:
            return "failed"
        @unknown default:
            return "unknown"
        }
    }

    private func removeObservers() {
        if let timeObserver {
            player?.removeTimeObserver(timeObserver)
        }
        timeObserver = nil
        // Dropping NSKeyValueObservation values unregisters the KVO observers.
        // 释放 NSKeyValueObservation 即会注销对应 KVO observer.
        statusObservers.removeAll()
        if let endObserver {
            NotificationCenter.default.removeObserver(endObserver)
        }
        endObserver = nil
        if let errorObserver {
            NotificationCenter.default.removeObserver(errorObserver)
        }
        errorObserver = nil
    }
}
