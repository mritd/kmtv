import SwiftUI

#if os(iOS)
/// Scales the label to 0.96 while pressed and plays a selection haptic on press.
/// Reduce Motion keeps the haptic and drops the scale.
///
/// 按下时将内容缩放到 0.96 并触发选择触感. 开启减弱动态效果时保留触感, 取消缩放.
struct PressableButtonStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .contentShape(Rectangle())
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.96 : 1)
            .animation(.easeOut(duration: 0.16), value: configuration.isPressed)
            .sensoryFeedback(.selection, trigger: configuration.isPressed) { _, pressed in pressed }
    }
}

/// A 36 pt capsule button. `prominent` fills it with the accent; otherwise it uses a neutral fill
/// and `selected` tints the label with the accent. `compact` makes it 30 pt with footnote text,
/// for buttons inside list rows, where a full-size pill outweighs the row's title.
///
/// 36 pt 胶囊按钮. `prominent` 时用强调色填充; 否则使用中性填充, `selected` 时文字使用强调色.
/// `compact` 时高度为 30 pt, 文字为脚注字号, 用于列表行内的按钮, 因为完整尺寸的胶囊会压过行标题.
struct PillButtonStyle: ButtonStyle {
    var prominent = false
    var selected = false
    var compact = false
    @Environment(\.appTheme) private var theme
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .labelStyle(PillLabelStyle())
            .font(compact ? AppFont.caption : AppFont.control)
            .lineLimit(1)
            .padding(.horizontal, compact ? 12 : 14)
            .frame(minHeight: compact ? 30 : 36)
            .foregroundStyle(foreground)
            .background(background, in: Capsule())
            .opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.45)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.96 : 1)
            .animation(.easeOut(duration: 0.16), value: configuration.isPressed)
            .contentShape(Capsule())
    }

    private var foreground: Color {
        if prominent { return theme.onAccent }
        return selected ? theme.accent : .primary
    }

    private var background: Color {
        if prominent { return theme.accent }
        return selected ? theme.accentTint : Surface.fill
    }
}

/// Icon and title side by side with a tight gap, sized for a pill. It also keeps the title inside
/// a List row, where the automatic style shows the icon alone.
///
/// 图标与标题并排且间距紧凑, 适配胶囊按钮. 也能在 List 行中保留标题, 那里的自动样式只显示图标.
private struct PillLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: Spacing.xs + 2) {
            configuration.icon
            configuration.title
        }
    }
}

/// A selectable chip for episodes and filters. Selected chips use the accent fill.
/// `onRaised` picks the fill for chips drawn on a raised surface instead of the canvas.
///
/// 用于选集与筛选的可选 chip. 选中时使用强调色填充.
/// `onRaised` 表示 chip 绘制在卡片表面上而非页面背景上, 以选择对应的填充色.
struct ChipButtonStyle: ButtonStyle {
    var isSelected: Bool
    var minHeight: CGFloat = 40
    var capsule = false
    var onRaised = false
    @Environment(\.appTheme) private var theme
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        let shape = RoundedRectangle(cornerRadius: capsule ? minHeight / 2 : Radius.sm, style: .continuous)
        return configuration.label
            .font(isSelected ? AppFont.control.weight(.semibold) : AppFont.secondary)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .padding(.horizontal, capsule ? 14 : 6)
            .frame(minHeight: minHeight)
            .foregroundStyle(isSelected ? theme.onAccent : Color.primary)
            .background(isSelected ? theme.accent : (onRaised ? Surface.raisedFill : Surface.raised), in: shape)
            .opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.4)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.96 : 1)
            .animation(.easeOut(duration: 0.16), value: configuration.isPressed)
            .contentShape(shape)
            .sensoryFeedback(.selection, trigger: configuration.isPressed) { _, pressed in pressed }
    }
}

extension ButtonStyle where Self == PressableButtonStyle {
    static var pressable: PressableButtonStyle { PressableButtonStyle() }
}

extension ButtonStyle where Self == PillButtonStyle {
    static var pill: PillButtonStyle { PillButtonStyle() }
    static func pill(prominent: Bool = false, selected: Bool = false, compact: Bool = false) -> PillButtonStyle {
        PillButtonStyle(prominent: prominent, selected: selected, compact: compact)
    }
}

extension ButtonStyle where Self == ChipButtonStyle {
    static func chip(selected: Bool, minHeight: CGFloat = 40, capsule: Bool = false,
                     onRaised: Bool = false) -> ChipButtonStyle {
        ChipButtonStyle(isSelected: selected, minHeight: minHeight, capsule: capsule, onRaised: onRaised)
    }
}
#endif
