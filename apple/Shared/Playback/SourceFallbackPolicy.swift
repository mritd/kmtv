import Foundation

/// The order the online player recovers from a failure in: a downloaded copy falls back to
/// streaming the same selection; otherwise the last episode past the finished threshold counts as
/// ended, then the next line, then the next source, then nothing is left. It returns the next step
/// and leaves the selection to the caller.
///
/// 在线播放器从失败中恢复的顺序: 下载副本失败时回退为在线播放同一选择; 否则最后一集越过看完阈值
/// 视为播放结束, 然后是下一条线路, 再然后是下一个视频源, 最后再无可用. 它返回下一步, 选择由调用方修改.
enum SourceFallbackPolicy {
    /// One recovery step.
    ///
    /// 一个恢复步骤.
    enum Step: Equatable {
        /// The local copy failed: stream the same selection without it.
        ///
        /// 本地副本失败: 不使用它, 改为在线播放同一选择.
        case streamSameSelection
        /// The last episode failed at or past the finished threshold: treat it as its end, so the
        /// finished record is not overwritten by a restart.
        ///
        /// 最后一集在已看完阈值之后失败: 视为播放结束, 避免重新播放覆盖已看完的记录.
        case finish
        /// Play the line at this index.
        ///
        /// 播放该索引对应的线路.
        case nextLine(Int)
        /// Drop the failing source and switch to this one.
        ///
        /// 移除失败的视频源并切换到该视频源.
        case nextSource(String)
        /// Drop the failing source; no other source is left.
        ///
        /// 移除失败的视频源; 已没有其他视频源.
        case allSourcesFailed
    }

    /// The step after the attached item failed. `playingLocalCopy` is whether that item played a
    /// downloaded copy.
    ///
    /// 已挂载 item 失败后的步骤. `playingLocalCopy` 表示该 item 是否在播放下载的副本.
    static func afterItemFailure(playingLocalCopy: Bool, selection: EpisodeSelection, current: TimeInterval,
                                 duration: TimeInterval) -> Step {
        playingLocalCopy
            ? .streamSameSelection
            : afterFailure(selection: selection, current: current, duration: duration)
    }

    /// The step after the selection failed to load or play, given the last reported position.
    ///
    /// 当前选择加载或播放失败后的步骤, 依据最近一次上报的位置.
    static func afterFailure(selection: EpisodeSelection, current: TimeInterval, duration: TimeInterval) -> Step {
        if selection.currentEpisodeIndex == selection.episodes.count - 1,
           PlaybackProgressPolicy.isCompleted(current: current, duration: duration) {
            return .finish
        }
        let nextLine = selection.currentLineIndex + 1
        if nextLine < selection.allLines.count { return .nextLine(nextLine) }
        if let next = selection.sources.first(where: { $0.sourceKey != selection.currentSourceKey }) {
            return .nextSource(next.sourceKey)
        }
        return .allSourcesFailed
    }

    /// Whether a source's detail can be played: it has a first line with at least one episode.
    ///
    /// 视频源详情是否可播放: 存在第一条线路且其中至少有一集.
    static func isPlayable(_ detail: VideoDetail) -> Bool {
        !detail.episodes.isEmpty && !(detail.episodes.first?.isEmpty ?? true)
    }
}
