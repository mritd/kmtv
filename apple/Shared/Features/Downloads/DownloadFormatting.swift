#if os(iOS)
import Foundation

/// User-facing text for downloads.
///
/// 下载功能面向用户的文本.
enum DownloadFormatting {
    /// The status of an unfinished episode this device cannot act on: offline, the account's own
    /// failed episode says so and the rest wait for the network; another account's episode can be
    /// continued only after signing in to that account.
    ///
    /// 本机无法操作的未完成剧集的状态: 离线时, 本账号失败的剧集如实显示, 其余等待网络; 其他账号的剧集
    /// 只能在登录该账号后继续.
    static func waitingText(for ep: DownloadEpisode, state: DownloadDisplayState, activeScopeKey: String?) -> String {
        guard ep.scopeKey == activeScopeKey else { return String(localized: "Sign in to its account to continue") }
        if case .failed = state { return text(for: state) }
        return String(localized: "Will continue when online")
    }

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
#endif
