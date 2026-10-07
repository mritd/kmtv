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
/// progress ticks of this show only (`DownloadManager.progressTick(forTitle:)`). The snapshot is
/// computed in `onChange` from the manager's `librarySnapshot`, outside body evaluation, so this
/// view does not observe the rows' per-entry progress; a tick that moved other shows does not
/// re-evaluate it, and the content re-renders only when a badge (in 5% steps) changes.
///
/// 向内容提供一个 `DownloadBadgeSnapshot`, 它只在结构变化以及本剧的进度通知
/// (`DownloadManager.progressTick(forTitle:)`) 时刷新. 快照在 `onChange` 中依据管理器的
/// `librarySnapshot` 计算, 不在 body 求值期间, 因此本视图不会观察数据行逐条目的进度; 只影响其他剧的
/// 通知不会让它重新求值, 内容也只在角标 (以 5% 为步长) 变化时重新渲染.
struct DownloadBadgesReader<Content: View>: View {
    let downloads: DownloadManager
    let title: String
    let sourceKey: String
    let videoId: String
    @ViewBuilder let content: (DownloadBadgeSnapshot) -> Content
    @State private var snapshot = DownloadBadgeSnapshot()

    /// Everything the snapshot depends on.
    ///
    /// 快照所依赖的全部输入.
    private struct Inputs: Equatable {
        let revision: DownloadDisplayRevision
        let showProgress: Int
        let title: String
        let sourceKey: String
        let videoId: String
    }

    var body: some View {
        content(snapshot)
            .onChange(of: Inputs(revision: downloads.displayRevision, showProgress: downloads.progressTick(forTitle: title),
                                 title: title, sourceKey: sourceKey, videoId: videoId),
                      initial: true) { _, _ in
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
        let all = downloads.librarySnapshot.episodes(showKey: normalizeSyncKey(title))
            .filter { $0.state == .completed || $0.scopeKey == scope }
        return DownloadBadgeSnapshot(
            badges: EpisodePickerModel.badges(episodes: all, sourceKey: sourceKey, videoId: videoId,
                                              state: downloads.displayState(of:)),
            episodes: all)
    }
}
#endif
