import SwiftUI
import Kingfisher

struct VideoCard: View {
    let title: String
    let cover: String
    let subtitle: String?
    let rating: String?
    let apiClient: APIClient?
    /// Watch progress from 0 to 1, drawn along the bottom edge on iOS.
    ///
    /// 0 到 1 的观看进度, 在 iOS 上绘制于底边.
    let progress: Double?

    init(title: String, cover: String, subtitle: String? = nil, rating: String? = nil, apiClient: APIClient? = nil,
         progress: Double? = nil) {
        self.title = title
        self.cover = cover
        self.subtitle = subtitle
        self.rating = rating
        self.apiClient = apiClient
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
                    .clipShape(RoundedRectangle(cornerRadius: 12))

                LinearGradient(
                    colors: [.clear, .clear, .black.opacity(0.75)],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .allowsHitTesting(false)

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                    if let subtitle {
                        Text(subtitle)
                            .font(.caption2)
                            .foregroundStyle(Color(white: 0.7))
                            .lineLimit(1)
                    }
                }
                .padding(10)
            }

            Text(rating != nil && !rating!.isEmpty && rating != "0" ? rating! : String(localized: "N/A"))
                .font(.system(size: ratingFontSize, weight: .bold).monospacedDigit())
                .foregroundStyle(Theme.accent)
                .fixedSize()
                .padding(.horizontal, ratingPadH)
                .padding(.vertical, ratingPadV)
                .background(Theme.ratingBadgeBg)
                .clipShape(RoundedRectangle(cornerRadius: 4))
                .padding(ratingInset)
        }
        .aspectRatio(2/3, contentMode: .fit)
    }
    #endif

    #if os(tvOS)
    private let ratingFontSize: CGFloat = 16
    private let ratingPadH: CGFloat = 8
    private let ratingPadV: CGFloat = 4
    private let ratingInset: CGFloat = 8
    #endif

    private var imageURL: URL? {
        guard !cover.isEmpty else { return nil }
        if cover.hasPrefix("/"), let client = apiClient {
            return URL(string: client.baseURL + cover)
        }
        return URL(string: cover)
    }

    #if os(tvOS)
    private var placeholder: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(Theme.bgCard)
            .aspectRatio(2/3, contentMode: .fit)
            .overlay {
                Image(systemName: "film")
                    .foregroundStyle(.secondary)
            }
    }
    #endif
}
