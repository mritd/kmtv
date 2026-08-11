import Foundation

/// Resolves the current line, episode, and provider-specific video identity.
/// `sourceKey` selects one provider entry whose `videoId` must travel with it.
///
/// 解析当前线路, 分集和视频源内视频 identity. `sourceKey` 选择一个视频源条目,
/// 其 `videoId` 必须与该条目一起传递.
struct EpisodeSelection {
    var detail: VideoDetail?
    var sources: [SourceResult]
    var currentSourceKey: String
    var currentLineIndex: Int
    var currentEpisodeIndex: Int

    var allLines: [[Episode]] {
        detail?.episodes ?? []
    }

    /// Returns the selected detail line or falls back to search result episodes.
    ///
    /// 返回当前选中的详情线路, 如果详情缺失则回退到搜索结果中的剧集.
    var episodes: [Episode] {
        guard !allLines.isEmpty else {
            return sources.first(where: { $0.sourceKey == currentSourceKey })?.episodes ?? []
        }
        return allLines[safe: currentLineIndex] ?? allLines[safe: 0] ?? []
    }

    var currentEpisode: Episode? {
        episodes[safe: currentEpisodeIndex]
    }

    /// Returns the provider-specific video ID paired with `currentSourceKey`.
    ///
    /// 返回与 `currentSourceKey` 配对的视频源内 video ID.
    func sourceVideoID() -> String {
        sources.first(where: { $0.sourceKey == currentSourceKey })?.videoId ?? ""
    }

    func sourceName() -> String {
        let raw = sources.first(where: { $0.sourceKey == currentSourceKey })?.sourceName ?? currentSourceKey
        return DisplayFormatters.cleanSourceName(raw)
    }
}
