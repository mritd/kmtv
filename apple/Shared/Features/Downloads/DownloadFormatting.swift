#if os(iOS)
import Foundation
import SwiftUI
import UIKit

/// User-facing text for downloads.
///
/// 下载功能面向用户的文本.
enum DownloadFormatting {
    /// File size text, for example "1.2 GB".
    ///
    /// 文件大小文本, 例如 "1.2 GB".
    static func bytes(_ count: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: count, countStyle: .file)
    }

    /// Playback position text: "m:ss" or "h:mm:ss".
    ///
    /// 播放位置文本: "m:ss" 或 "h:mm:ss".
    static func duration(_ seconds: Double) -> String {
        let total = max(0, Int(seconds.rounded(.down)))
        let (hours, minutes, secs) = (total / 3600, total % 3600 / 60, total % 60)
        return hours > 0 ? String(format: "%d:%02d:%02d", hours, minutes, secs) : String(format: "%d:%02d", minutes, secs)
    }

    /// Row text for a display state.
    ///
    /// 展示状态对应的行内文本.
    static func text(for state: DownloadDisplayState) -> String {
        switch state {
        case .queued: String(localized: "Waiting")
        case .preparing: String(localized: "Preparing")
        case .downloading(let progress): String(localized: "Downloading \(Int(progress * 100))%")
        case .waitingNetwork: String(localized: "Waiting for network")
        case .waitingWiFi: String(localized: "Waiting for WiFi")
        case .paused(.signedOut): String(localized: "Sign in to continue")
        case .paused(.noSpace): String(localized: "Not enough storage")
        case .paused(.user): String(localized: "Paused")
        case .completed: String(localized: "Downloaded")
        case .failed(let failure): text(for: failure)
        }
    }

    /// Text for a failure reason.
    ///
    /// 失败原因对应的文本.
    static func text(for failure: DownloadFailure) -> String {
        switch failure {
        case .unsupportedFormat: String(localized: "Unsupported format")
        case .separateAudio: String(localized: "Separate audio tracks are not supported")
        case .sourceStatus(let status): String(localized: "Source returned \(status)")
        case .sourceRejects: String(localized: "Source keeps rejecting the download")
        case .invalidContent: String(localized: "Source returned invalid data")
        case .network: String(localized: "Network error")
        case .damaged: String(localized: "File damaged, download again")
        }
    }
}

/// Poster of a downloaded show from its local cover file, or a tinted placeholder with the
/// title's first character, so it renders offline.
///
/// 已下载剧集的海报, 来自本地封面文件; 没有封面时显示带标题首字的着色占位图, 因此离线也能显示.
struct DownloadPoster: View {
    let show: DownloadShow
    let width: CGFloat
    @Environment(DownloadManager.self) private var downloads

    var body: some View {
        Group {
            if let url = downloads.coverFileURL(for: show), let image = UIImage(contentsOfFile: url.path) {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                ZStack {
                    Theme.bgSecondary
                    Text(String(show.title.prefix(1)))
                        .font(.system(size: width * 0.36, weight: .bold))
                        .foregroundStyle(Theme.textSecondary)
                }
            }
        }
        .frame(width: width, height: width * 1.42)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .accessibilityHidden(true)
    }
}
#endif
