#if os(iOS)
import SwiftUI

/// Download rows of one show and the badges of one source and video, captured when the manager's
/// display revision changes rather than read while rendering.
///
/// 某部剧的下载数据行, 以及某个来源与视频的角标; 在管理器的展示版本变化时捕获, 而不是在渲染时读取.
struct DownloadBadgeSnapshot: Equatable {
    var badges: [Int: EpisodeDownloadBadge] = [:]
    var episodes: [DownloadEpisode] = []
}

/// Hands its content a `DownloadBadgeSnapshot` that refreshes on structural changes and on
/// progress ticks that moved this show. The snapshot is computed in `onChange`, outside body
/// evaluation, so this view does not observe the rows' per-entry progress; a tick that only moved
/// other shows fetches nothing, and the content re-renders only when a badge (in 5% steps) changes.
///
/// 向内容提供一个 `DownloadBadgeSnapshot`, 它只在结构变化以及影响本剧的进度通知时刷新. 快照在
/// `onChange` 中计算, 不在 body 求值期间, 因此本视图不会观察数据行逐条目的进度; 只影响其他剧的通知
/// 不会读取任何数据, 内容也只在角标 (以 5% 为步长) 变化时重新渲染.
struct DownloadBadgesReader<Content: View>: View {
    let downloads: DownloadManager
    let title: String
    let sourceKey: String
    let videoId: String
    @ViewBuilder let content: (DownloadBadgeSnapshot) -> Content
    @State private var snapshot = DownloadBadgeSnapshot()
    // The inputs of the last capture; a later change of only the progress tick skips the fetch
    // unless this show moved since.
    //
    // 上一次捕获时的输入; 之后若只有进度序号变化, 除非本剧期间有进度, 否则跳过读取.
    @State private var captured: Inputs?

    /// Everything the snapshot depends on.
    ///
    /// 快照所依赖的全部输入.
    private struct Inputs: Equatable {
        let revision: DownloadDisplayRevision
        let title: String
        let sourceKey: String
        let videoId: String

        /// These inputs with the progress tick cleared, to tell a progress-only change.
        ///
        /// 清除进度序号后的输入, 用来识别只有进度变化的情况.
        var ignoringProgress: Inputs {
            var revision = revision
            revision.progress = 0
            return Inputs(revision: revision, title: title, sourceKey: sourceKey, videoId: videoId)
        }
    }

    var body: some View {
        content(snapshot)
            .onChange(of: Inputs(revision: downloads.displayRevision, title: title, sourceKey: sourceKey, videoId: videoId),
                      initial: true) { _, inputs in
                if let captured, captured.ignoringProgress == inputs.ignoringProgress {
                    let showDir = DownloadPaths.showDir(showKey: normalizeSyncKey(title))
                    guard (downloads.showProgressTicks[showDir] ?? .min) > captured.revision.progress else { return }
                }
                captured = inputs
                let next = capture()
                if next != snapshot { snapshot = next }
            }
    }

    /// Completed downloads from any account, since they play locally whoever is signed in, plus the
    /// active scope's unfinished ones, the only unfinished ones this device can act on.
    ///
    /// 任一账号的已完成下载 (无论谁登录都会本地播放), 以及当前作用域中未完成的下载 (本机只能操作这些).
    private func capture() -> DownloadBadgeSnapshot {
        guard !title.isEmpty else { return DownloadBadgeSnapshot() }
        let scope = downloads.activeScopeKey
        let all = downloads.libraryEpisodes(showKey: normalizeSyncKey(title))
            .filter { $0.state == .completed || $0.scopeKey == scope }
        return DownloadBadgeSnapshot(
            badges: EpisodePickerModel.badges(episodes: all, sourceKey: sourceKey, videoId: videoId,
                                              state: downloads.displayState(of:)),
            episodes: all)
    }
}
#endif
