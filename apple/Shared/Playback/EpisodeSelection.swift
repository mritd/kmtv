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

    /// The line and episode indices clamped to what the detail offers: the line to the detail's
    /// lines (0 without any), then the episode to that line's episodes (0 without any).
    ///
    /// 钳制到详情实际提供范围内的线路与分集索引: 线路钳制到详情的线路数 (没有线路时为 0),
    /// 然后分集钳制到该线路的剧集数 (没有剧集时为 0).
    func clampedIndices() -> (line: Int, episode: Int) {
        let lineCount = detail?.episodes.count ?? 0
        var clamped = self
        clamped.currentLineIndex = lineCount > 0 ? min(max(0, currentLineIndex), lineCount - 1) : 0
        let episodeCount = clamped.episodes.count
        let episode = episodeCount > 0 ? min(max(0, currentEpisodeIndex), episodeCount - 1) : 0
        return (clamped.currentLineIndex, episode)
    }

    /// The index of the first episode in the current line whose first number equals the first
    /// number in `name`; nil when `name` has no number or no episode matches.
    ///
    /// 当前线路中第一个与 `name` 首个数字相同的剧集索引; `name` 中没有数字或没有匹配剧集时为 nil.
    func episodeIndex(matchingNumberIn name: String) -> Int? {
        guard let number = name.firstMatch(of: /\d+/)?.output else { return nil }
        return episodes.firstIndex { ($0.name.firstMatch(of: /\d+/)?.output).map(String.init) == String(number) }
    }

    func sourceName() -> String {
        let raw = sources.first(where: { $0.sourceKey == currentSourceKey })?.sourceName ?? currentSourceKey
        return DisplayFormatters.cleanSourceName(raw)
    }
}
