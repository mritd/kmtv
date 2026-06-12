import Foundation

/// Episode resume intent carried across fresh search navigation.
/// 跨重新搜索导航传递的分集恢复意图.
struct EpisodeResumeIntent: Hashable, Sendable {
    let episodeIndex: Int
    let episodeName: String
}

/// Navigation value for triggering a search from home page card taps.
/// 首页卡片点击后用于触发搜索导航的值.
struct SearchQuery: Hashable, Identifiable {
    var id: String { "\(query)-\(coverHint)-\(resumeIntent?.episodeIndex ?? -1)-\(resumeIntent?.episodeName ?? "")" }
    let query: String
    let coverHint: String
    let resumeIntent: EpisodeResumeIntent?

    init(query: String, coverHint: String = "", resumeIntent: EpisodeResumeIntent? = nil) {
        self.query = query
        self.coverHint = coverHint
        self.resumeIntent = resumeIntent
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(query)
        hasher.combine(coverHint)
        hasher.combine(resumeIntent)
    }

    static func == (lhs: SearchQuery, rhs: SearchQuery) -> Bool {
        lhs.query == rhs.query && lhs.coverHint == rhs.coverHint && lhs.resumeIntent == rhs.resumeIntent
    }
}

/// Navigation destination for play page.
/// 播放详情页使用的导航目标.
struct PlayDestination: Hashable, Identifiable {
    var id: String { "\(title)-\(sourceKey)-\(videoId)-\(coverHint)-\(resumeIntent?.episodeIndex ?? -1)-\(resumeIntent?.episodeName ?? "")" }
    let title: String
    let sources: [SourceResult]
    let sourceKey: String
    let videoId: String
    let coverHint: String
    let resumeIntent: EpisodeResumeIntent?

    init(title: String, sources: [SourceResult], sourceKey: String, videoId: String,
         coverHint: String = "", resumeIntent: EpisodeResumeIntent? = nil) {
        self.title = title
        self.sources = sources
        self.sourceKey = sourceKey
        self.videoId = videoId
        self.coverHint = coverHint
        self.resumeIntent = resumeIntent
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(title)
        hasher.combine(sourceKey)
        hasher.combine(videoId)
        hasher.combine(coverHint)
        hasher.combine(resumeIntent)
    }

    static func == (lhs: PlayDestination, rhs: PlayDestination) -> Bool {
        lhs.title == rhs.title
            && lhs.sourceKey == rhs.sourceKey
            && lhs.videoId == rhs.videoId
            && lhs.coverHint == rhs.coverHint
            && lhs.resumeIntent == rhs.resumeIntent
    }
}
