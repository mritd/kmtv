#if os(iOS)
import SwiftUI

/// The player page's title block: title, meta line, the downloaded mark, the favorite and download
/// actions, and the expandable description. Its own view, so the controls and the playback ticks
/// never re-render it, and expanding the description re-renders nothing else.
///
/// 播放页的标题区: 标题, 元信息行, 已下载标记, 收藏与下载操作, 以及可展开的简介. 作为独立视图, 控制层与
/// 播放进度更新不会让它重新渲染, 展开简介也不会重新渲染其他部分.
struct PlayerHeader: View {
    let vm: PlayerViewModel
    /// The title shown before the detail loads.
    ///
    /// 详情加载前显示的标题.
    let fallbackTitle: String
    /// The download manager, when downloads are available on this device.
    ///
    /// 下载管理器; 仅当本设备可用下载时存在.
    let downloads: DownloadManager?
    /// Called when the download button is tapped.
    ///
    /// 点按下载按钮时调用.
    let onDownload: () -> Void

    @State private var isDescExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(verbatim: vm.detail?.title ?? fallbackTitle)
                    .font(AppFont.title)
                    .foregroundStyle(.primary)
                Text(DisplayFormatters.metaLine([
                    vm.episodes.count > 1 ? vm.currentEpisodeName : nil,
                    vm.currentSourceName,
                    vm.detail?.type,
                    vm.detail?.year,
                ], separator: " · "))
                    .font(AppFont.secondary)
                    .foregroundStyle(.secondary)
                if vm.isPlayingLocalCopy {
                    Label("Downloaded", systemImage: "arrow.down.circle.fill")
                        .font(AppFont.footnote)
                        .foregroundStyle(StatusColor.success)
                }
            }

            // Side by side, or stacked when large text does not fit on one line.
            //
            // 并排显示; 大字号下一行放不下时上下排列.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: Spacing.sm) { actions }
                VStack(alignment: .leading, spacing: Spacing.sm) { actions }
            }

            if let desc = vm.detail.map({ DisplayFormatters.cleanDescription($0.desc) }), !desc.isEmpty {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(desc)
                        .font(AppFont.secondary)
                        .foregroundStyle(.secondary)
                        .lineSpacing(3)
                        .lineLimit(isDescExpanded ? nil : 2)
                    Button(isDescExpanded ? "Collapse" : "Expand") {
                        withAnimation(.easeOut(duration: 0.2)) { isDescExpanded.toggle() }
                    }
                    .font(AppFont.secondary)
                    .buttonStyle(.plain)
                    .foregroundStyle(.tint)
                }
            }
        }
    }

    @ViewBuilder
    private var actions: some View {
        Button { vm.toggleFavorite() } label: {
            Label(vm.isFavorited ? "Favorited" : "Favorite",
                  systemImage: vm.isFavorited ? "star.fill" : "star")
        }
        .buttonStyle(.pill(selected: vm.isFavorited))
        .sensoryFeedback(.success, trigger: vm.isFavorited) { _, now in now }
        .accessibilityIdentifier("favoriteButton")

        if let downloads, vm.detail != nil {
            PlayerDownloadButton(downloads: downloads, multiple: vm.episodes.count > 1, action: onDownload)
        }
    }
}

/// The player page's download button. Its own view, so the manager state it reads re-renders only
/// this button.
///
/// 播放页的下载按钮. 作为独立视图, 它读取的管理器状态只会重新渲染这个按钮.
private struct PlayerDownloadButton: View {
    let downloads: DownloadManager
    let multiple: Bool
    let action: () -> Void

    var body: some View {
        if downloads.canDownload {
            Button(action: action) {
                Label(multiple ? "Download Episodes" : "Download", systemImage: "arrow.down.circle")
            }
            .buttonStyle(.pill)
            .accessibilityIdentifier("downloadButton")
        }
    }
}
#endif
