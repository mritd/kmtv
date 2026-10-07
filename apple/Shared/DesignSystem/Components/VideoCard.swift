import SwiftUI
import Kingfisher

/// A poster card: artwork with an optional rating badge, title, and subtitle. On iOS the title sits
/// under the artwork and `progress` draws along its bottom edge; on tvOS the title sits on the
/// artwork under a gradient.
///
/// 海报卡片: 图片, 可选的评分角标, 标题与副标题. iOS 上标题位于图片下方, `progress` 绘制在图片底边;
/// tvOS 上标题叠加在图片的渐变遮罩上.
struct VideoCard: View {
    let title: String
    let cover: String
    let subtitle: String?
    let rating: String?
    /// The server base URL that server-relative covers resolve against.
    ///
    /// 服务端相对封面路径所基于的服务器地址.
    let baseURL: String?
    /// Watch progress from 0 to 1, drawn along the bottom edge on iOS.
    ///
    /// 0 到 1 的观看进度, 在 iOS 上绘制于底边.
    let progress: Double?

    init(title: String, cover: String, subtitle: String? = nil, rating: String? = nil, baseURL: String? = nil,
         progress: Double? = nil) {
        self.title = title
        self.cover = cover
        self.subtitle = subtitle
        self.rating = rating
        self.baseURL = baseURL
        self.progress = progress
    }

    var body: some View {
        #if os(tvOS)
        tvBody
        #else
        iosBody
        #endif
    }

    #if os(iOS)
    private var iosBody: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Color.clear
                .aspectRatio(2/3, contentMode: .fit)
                .overlay { ArtworkImage(url: imageURL, title: title) }
                .overlay(alignment: .topTrailing) {
                    if let badge = RatingBadge.text(for: rating) {
                        RatingBadge(rating: badge).padding(6)
                    }
                }
                .overlay(alignment: .bottom) {
                    if let progress { ArtworkProgressBar(fraction: progress) }
                }
                .artworkFrame()

            Text(title)
                .font(AppFont.caption)
                .foregroundStyle(.primary)
                .lineLimit(1)
                .padding(.top, Spacing.xxs)
            if let subtitle, !subtitle.isEmpty {
                Text(subtitle)
                    .font(AppFont.meta)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
    }
    #endif

    #if os(tvOS)
    private var tvBody: some View {
        ZStack(alignment: .topTrailing) {
            ZStack(alignment: .bottomLeading) {
                KFImage(imageURL)
                    .placeholder { placeholder }
                    .fade(duration: 0.25)
                    .resizable()
                    .aspectRatio(2/3, contentMode: .fill)
                    .clipShape(RoundedRectangle(cornerRadius: TVRadius.card))

                LinearGradient(
                    colors: [.clear, .clear, .black.opacity(0.75)],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .clipShape(RoundedRectangle(cornerRadius: TVRadius.card))
                .allowsHitTesting(false)

                VStack(alignment: .leading, spacing: TVSpacing.hairline) {
                    Text(title)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                    if let subtitle {
                        Text(subtitle)
                            .font(.caption2)
                            .foregroundStyle(Theme.textOnArtwork)
                            .lineLimit(1)
                    }
                }
                .padding(TVSpacing.caption)
            }

            RatingBadge(rating: RatingBadge.text(for: rating) ?? String(localized: "N/A"))
                .padding(TVSpacing.sm)
        }
        .aspectRatio(2/3, contentMode: .fit)
    }
    #endif

    private var imageURL: URL? {
        resolveAssetURL(cover, baseURL: baseURL)
    }

    #if os(tvOS)
    private var placeholder: some View {
        RoundedRectangle(cornerRadius: TVRadius.placeholder)
            .fill(Theme.bgCard)
            .aspectRatio(2/3, contentMode: .fit)
            .overlay {
                Image(systemName: "film")
                    .foregroundStyle(.secondary)
            }
    }
    #endif
}
