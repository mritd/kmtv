import Foundation
import SwiftData

/// Stored state of a downloaded episode. "Preparing" and "waiting for network" are display states
/// derived at runtime, so a relaunch never finds an episode stuck in them.
///
/// 已下载剧集的持久化状态. "准备中" 与 "等待网络" 是运行时推导出的展示状态, 因此重启后不会有剧集卡在
/// 这两种状态.
enum DownloadState: String, Codable, Sendable {
    case queued
    case downloading
    case paused
    case completed
    case failed
}

/// Why an episode is paused.
///
/// 剧集被暂停的原因.
enum DownloadPauseReason: String, Codable, Sendable {
    case user
    case signedOut
    case noSpace
}

/// Why an episode failed; stored as a code plus an HTTP status.
///
/// 剧集失败的原因; 以代码加 HTTP 状态码的形式存储.
enum DownloadFailure: Equatable, Sendable {
    case unsupportedFormat
    case separateAudio
    case sourceStatus(Int)
    case sourceRejects
    case invalidContent
    case network
    case damaged

    /// Stable storage code.
    ///
    /// 稳定的存储代码.
    var code: String {
        switch self {
        case .unsupportedFormat: "unsupportedFormat"
        case .separateAudio: "separateAudio"
        case .sourceStatus: "sourceStatus"
        case .sourceRejects: "sourceRejects"
        case .invalidContent: "invalidContent"
        case .network: "network"
        case .damaged: "damaged"
        }
    }

    /// HTTP status for `sourceStatus`, otherwise 0.
    ///
    /// `sourceStatus` 的 HTTP 状态码, 其他情况为 0.
    var status: Int {
        if case .sourceStatus(let status) = self { return status }
        return 0
    }

    /// Rebuilds a failure from its stored code; nil for an empty or unknown code.
    ///
    /// 由存储的代码还原失败原因; 代码为空或未知时返回 nil.
    init?(code: String, status: Int) {
        switch code {
        case "unsupportedFormat": self = .unsupportedFormat
        case "separateAudio": self = .separateAudio
        case "sourceStatus": self = .sourceStatus(status)
        case "sourceRejects": self = .sourceRejects
        case "invalidContent": self = .invalidContent
        case "network": self = .network
        case "damaged": self = .damaged
        default: return nil
        }
    }
}

/// One downloaded show of a scope, grouped by the normalized detail title that watch records use.
///
/// 某个作用域下的一部已下载剧集, 按观看记录使用的规范化详情标题分组.
@Model
final class DownloadShow {
    #Unique<DownloadShow>([\.scopeKey, \.showKey])

    var scopeKey: String
    var scopeHash: String
    var showKey: String
    var showDir: String
    var title: String
    var cover: String
    var coverFile: String = ""
    /// Resolved absolute cover URL; `cover` itself can be relative.
    ///
    /// 已解析的绝对封面 URL; `cover` 本身可能是相对地址.
    var coverURLString: String = ""
    var type: String = ""
    var year: String = ""
    var createdAt: Date

    init(scopeKey: String, title: String, cover: String, type: String, year: String, createdAt: Date) {
        let showKey = normalizeSyncKey(title)
        self.scopeKey = scopeKey
        self.scopeHash = DownloadPaths.scopeHash(scopeKey)
        self.showKey = showKey
        self.showDir = DownloadPaths.showDir(showKey: showKey)
        self.title = title
        self.cover = cover
        self.type = type
        self.year = year
        self.createdAt = createdAt
    }
}

/// One downloaded episode, identified by source, video, and episode index (lines are mirrors).
///
/// 一集已下载的剧集, 以来源, 视频与剧集序号标识 (线路只是镜像).
@Model
final class DownloadEpisode {
    #Unique<DownloadEpisode>([\.scopeKey, \.sourceKey, \.videoId, \.episodeIndex])

    var scopeKey: String
    var scopeHash: String
    var showKey: String
    var showDir: String
    var episodeDir: String
    var sourceKey: String
    var sourceName: String
    var videoId: String
    var episodeIndex: Int
    var episodeName: String
    var lineIndex: Int
    var episodeCount: Int
    var episodeURL: String
    var stateRaw: String = DownloadState.queued.rawValue
    var pauseReasonRaw: String = ""
    var failureCode: String = ""
    var failureStatus: Int = 0
    var refreshCount: Int = 0
    var totalEntries: Int = 0
    var doneEntries: Int = 0
    var bytes: Int64 = 0
    var durationSec: Double = 0
    var positionSec: Double = 0
    var finished: Bool = false
    var queueOrder: Int
    var createdAt: Date
    var completedAt: Date?

    init(show: DownloadShow, sourceKey: String, sourceName: String, videoId: String, episodeIndex: Int,
         episodeName: String, lineIndex: Int, episodeCount: Int, episodeURL: String, queueOrder: Int,
         createdAt: Date) {
        self.scopeKey = show.scopeKey
        self.scopeHash = show.scopeHash
        self.showKey = show.showKey
        self.showDir = show.showDir
        self.episodeDir = DownloadPaths.episodeDir(sourceKey: sourceKey, videoId: videoId, episodeIndex: episodeIndex)
        self.sourceKey = sourceKey
        self.sourceName = sourceName
        self.videoId = videoId
        self.episodeIndex = episodeIndex
        self.episodeName = episodeName
        self.lineIndex = lineIndex
        self.episodeCount = episodeCount
        self.episodeURL = episodeURL
        self.queueOrder = queueOrder
        self.createdAt = createdAt
    }

    /// Stored state.
    ///
    /// 持久化的状态.
    var state: DownloadState {
        get { DownloadState(rawValue: stateRaw) ?? .queued }
        set { stateRaw = newValue.rawValue }
    }

    /// Pause reason while paused.
    ///
    /// 暂停时的原因.
    var pauseReason: DownloadPauseReason? {
        get { DownloadPauseReason(rawValue: pauseReasonRaw) }
        set { pauseReasonRaw = newValue?.rawValue ?? "" }
    }

    /// Failure reason while failed.
    ///
    /// 失败时的原因.
    var failure: DownloadFailure? {
        get { DownloadFailure(code: failureCode, status: failureStatus) }
        set {
            failureCode = newValue?.code ?? ""
            failureStatus = newValue?.status ?? 0
        }
    }

    /// Key shared with task IDs: `<scopeHash>/<showDir>/<episodeDir>`.
    ///
    /// 与任务 ID 共用的键: `<scopeHash>/<showDir>/<episodeDir>`.
    var episodeKey: String { "\(scopeHash)/\(showDir)/\(episodeDir)" }
}
