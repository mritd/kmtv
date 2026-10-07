import Foundation

/// Why the online player could not start or keep playing.
///
/// 在线播放器无法开始或继续播放的原因.
enum PlayerError: LocalizedError {
    case missingEpisode
    case invalidPlaybackURL(String)
    case allSourcesFailed

    var errorDescription: String? {
        switch self {
        case .missingEpisode:
            return String(localized: "No playable episode")
        case .invalidPlaybackURL:
            return String(localized: "Invalid playback URL")
        case .allSourcesFailed:
            return String(localized: "All sources failed")
        }
    }
}
