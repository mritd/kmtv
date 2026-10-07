import SwiftUI

/// A rating badge drawn on artwork. On iOS it is white digits on a dark scrim; on tvOS accent
/// digits on a dark plate, the look of the tvOS poster cards.
///
/// 绘制在图片上的评分角标. iOS 上为深色遮罩上的白色数字; tvOS 上为深色底板上的强调色数字, 即 tvOS
/// 海报卡片的样式.
struct RatingBadge: View {
    let rating: String

    var body: some View {
        #if os(tvOS)
        Text(rating)
            .font(.system(size: 16, weight: .bold).monospacedDigit())
            .foregroundStyle(Theme.accent)
            .fixedSize()
            .padding(.horizontal, TVSpacing.sm)
            .padding(.vertical, TVSpacing.xs)
            .background(Theme.ratingBadgeBg)
            .clipShape(RoundedRectangle(cornerRadius: TVRadius.badge))
        #else
        Text(rating)
            .font(AppFont.meta.weight(.semibold).monospacedDigit())
            .foregroundStyle(.white)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Surface.scrim, in: RoundedRectangle(cornerRadius: Radius.xs, style: .continuous))
        #endif
    }

    /// The badge text for a raw rating, or nil when the source has no rating ("", "0", or "0.0").
    ///
    /// 原始评分对应的角标文字; 来源没有评分 ("", "0" 或 "0.0") 时返回 nil.
    nonisolated static func text(for rating: String?) -> String? {
        guard let rating, !rating.isEmpty, rating != "0", rating != "0.0" else { return nil }
        return rating
    }
}
