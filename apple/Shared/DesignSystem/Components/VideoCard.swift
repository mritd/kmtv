import SwiftUI
import Kingfisher

struct VideoCard: View {
    let title: String
    let cover: String
    let subtitle: String?
    let rating: String?
    let apiClient: APIClient?

    init(title: String, cover: String, subtitle: String? = nil, rating: String? = nil, apiClient: APIClient? = nil) {
        self.title = title
        self.cover = cover
        self.subtitle = subtitle
        self.rating = rating
        self.apiClient = apiClient
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
        VStack(alignment: .leading, spacing: 4) {
            ZStack(alignment: .topTrailing) {
                KFImage(imageURL)
                    .placeholder { placeholder }
                    .fade(duration: 0.25)
                    .resizable()
                    .aspectRatio(2/3, contentMode: .fill)
                    .clipShape(RoundedRectangle(cornerRadius: 8))

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

            Text(title)
                .font(.caption)
                .foregroundStyle(.primary)
                .lineLimit(1)
            if let subtitle {
                Text(subtitle)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
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

    private var ratingFontSize: CGFloat {
        #if os(tvOS)
        16
        #else
        10
        #endif
    }

    private var ratingPadH: CGFloat {
        #if os(tvOS)
        8
        #else
        4
        #endif
    }

    private var ratingPadV: CGFloat {
        #if os(tvOS)
        4
        #else
        2
        #endif
    }

    private var ratingInset: CGFloat {
        #if os(tvOS)
        8
        #else
        4
        #endif
    }

    private var imageURL: URL? {
        guard !cover.isEmpty else { return nil }
        if cover.hasPrefix("/"), let client = apiClient {
            return URL(string: client.baseURL + cover)
        }
        return URL(string: cover)
    }

    private var placeholder: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(Theme.bgCard)
            .aspectRatio(2/3, contentMode: .fit)
            .overlay {
                Image(systemName: "film")
                    .foregroundStyle(.secondary)
            }
    }
}
