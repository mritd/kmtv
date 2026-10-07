#if os(iOS)
import SwiftUI

/// The player page's episode list, shown when the line has more than one episode. Its own view, so
/// the controls and the playback ticks never re-render the grid; with downloads, its badges come
/// from a `DownloadBadgesReader`, so download progress re-renders the grid at most about twice a
/// second and never the whole page.
///
/// 播放页的剧集列表, 当前线路多于一集时显示. 作为独立视图, 控制层与播放进度更新不会让网格重新渲染;
/// 启用下载时, 角标来自 `DownloadBadgesReader`, 因此下载进度每秒至多让网格重新渲染约两次, 且不会重新
/// 渲染整个页面.
struct PlayerEpisodesSection: View {
    let vm: PlayerViewModel
    /// The download manager, when downloads are available on this device.
    ///
    /// 下载管理器; 仅当本设备可用下载时存在.
    let downloads: DownloadManager?

    var body: some View {
        if vm.episodes.count > 1 {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader(Text("Episodes")) {
                    Text("\(vm.episodes.count) episodes")
                        .foregroundStyle(.secondary)
                }
                grid
            }
        }
    }

    @ViewBuilder
    private var grid: some View {
        if let downloads, let detail = vm.detail {
            DownloadBadgesReader(downloads: downloads, title: detail.title, sourceKey: vm.currentSourceKey,
                                 videoId: vm.currentVideoID) { snapshot in
                EpisodeGrid(episodes: vm.episodes, currentIndex: vm.currentEpisodeIndex, badges: snapshot.badges) { index in
                    vm.switchEpisode(index)
                }
            }
        } else {
            EpisodeGrid(episodes: vm.episodes, currentIndex: vm.currentEpisodeIndex) { index in
                vm.switchEpisode(index)
            }
        }
    }
}
#endif
