import Foundation

/// Episode resume intent carried across fresh search navigation.
///
/// 跨重新搜索导航传递的分集恢复意图.
struct EpisodeResumeIntent: Hashable, Sendable {
    let episodeIndex: Int
    let episodeName: String
}

/// Navigation value for opening search from Home, Categories, or Favorites.
/// iOS pushes it on the originating tab's path; tvOS passes it to the Search tab.
///
/// 从首页, 分类或收藏进入搜索时使用的导航值. iOS 将它压入来源 tab 的 path,
/// tvOS 则将它传递给 Search tab.
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

/// Navigation destination for the detail/player flow.
/// `sourceKey` and `videoId` identify the selected provider entry; `sources`
/// retains the other provider choices for source switching.
///
/// 详情与播放流程使用的导航目标. `sourceKey` 和 `videoId` 标识当前选中的视频源条目,
/// `sources` 保留其他视频源选项供切换.
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
