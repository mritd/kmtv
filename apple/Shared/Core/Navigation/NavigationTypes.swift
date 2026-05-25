import Foundation

/// Navigation value for triggering a search from home page card taps.
/// 首页卡片点击后用于触发搜索导航的值.
struct SearchQuery: Hashable, Identifiable {
    let id = UUID()
    let query: String

    func hash(into hasher: inout Hasher) {
        hasher.combine(query)
    }

    static func == (lhs: SearchQuery, rhs: SearchQuery) -> Bool {
        lhs.query == rhs.query
    }
}

/// Navigation destination for play page.
/// 播放详情页使用的导航目标.
struct PlayDestination: Hashable, Identifiable {
    var id: String { "\(title)-\(sourceKey)-\(videoId)" }
    let title: String
    let sources: [SourceResult]
    let sourceKey: String
    let videoId: String

    func hash(into hasher: inout Hasher) {
        hasher.combine(title)
        hasher.combine(sourceKey)
        hasher.combine(videoId)
    }

    static func == (lhs: PlayDestination, rhs: PlayDestination) -> Bool {
        lhs.title == rhs.title && lhs.sourceKey == rhs.sourceKey && lhs.videoId == rhs.videoId
    }
}
