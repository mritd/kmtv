import SwiftUI

#if os(tvOS)
// MARK: - Card focus style (for video cards, hero cards)

struct TVScaleButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        TVScaleButtonContent(configuration: configuration)
    }
}

private struct TVScaleButtonContent: View {
    let configuration: ButtonStyleConfiguration
    @Environment(\.isFocused) var isFocused

    var body: some View {
        configuration.label
            .scaleEffect(isFocused ? 1.08 : 1.0)
            .shadow(color: .black.opacity(isFocused ? 0.6 : 0), radius: isFocused ? 30 : 0, y: isFocused ? 10 : 0)
            .brightness(isFocused ? 0.1 : 0)
            .zIndex(isFocused ? 1 : 0)
            .animation(.easeInOut(duration: 0.2), value: isFocused)
            .focusEffectDisabled()
    }
}

extension ButtonStyle where Self == TVScaleButtonStyle {
    static var tvScale: TVScaleButtonStyle { TVScaleButtonStyle() }
}

// MARK: - Hero card focus style (subtle scale for large cards)

struct TVHeroButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        TVHeroButtonContent(configuration: configuration)
    }
}

private struct TVHeroButtonContent: View {
    let configuration: ButtonStyleConfiguration
    @Environment(\.isFocused) var isFocused

    var body: some View {
        configuration.label
            .scaleEffect(isFocused ? 1.02 : 1.0)
            .shadow(color: .black.opacity(isFocused ? 0.5 : 0), radius: isFocused ? 20 : 0, y: isFocused ? 8 : 0)
            .brightness(isFocused ? 0.08 : 0)
            .animation(.easeInOut(duration: 0.2), value: isFocused)
            .focusEffectDisabled()
    }
}

extension ButtonStyle where Self == TVHeroButtonStyle {
    static var tvHeroScale: TVHeroButtonStyle { TVHeroButtonStyle() }
}

// MARK: - Plain focus style (suppresses system chrome, passes through label)

struct TVPlainButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .focusEffectDisabled()
    }
}

extension ButtonStyle where Self == TVPlainButtonStyle {
    static var tvPlain: TVPlainButtonStyle { TVPlainButtonStyle() }
}

// MARK: - Category tab label (underline style)

struct TVCategoryTabLabel: View {
    let text: LocalizedStringKey
    let isSelected: Bool
    @Environment(\.isFocused) private var isFocused

    var body: some View {
        VStack(spacing: 6) {
            Text(text)
                .font(.headline.weight(isSelected ? .bold : .regular))
                .foregroundStyle(foregroundColor)
                .padding(.horizontal, 20)
                .padding(.vertical, 8)

            Rectangle()
                .fill(isSelected ? Theme.accent : .clear)
                .frame(height: 2)
        }
        .scaleEffect(isFocused ? 1.05 : 1.0)
        .animation(.easeInOut(duration: 0.15), value: isFocused)
    }

    private var foregroundColor: Color {
        if isSelected { return Theme.accent }
        if isFocused { return Theme.accent.opacity(0.8) }
        return Color(white: 0.5)
    }
}

// MARK: - Chip label (capsule style for sub-categories and regions)

struct TVChipLabel: View {
    let text: LocalizedStringKey
    let isSelected: Bool
    var isSmall: Bool = false
    @Environment(\.isFocused) private var isFocused

    var body: some View {
        Text(text)
            .font(isSmall ? .callout : .callout.weight(isSelected ? .semibold : .regular))
            .foregroundStyle(foregroundColor)
            .padding(.horizontal, isSmall ? 14 : 18)
            .padding(.vertical, isSmall ? 6 : 8)
            .background(backgroundColor)
            .overlay(
                Capsule()
                    .strokeBorder(borderColor, lineWidth: isFocused ? 2 : 1)
            )
            .clipShape(Capsule())
            .animation(.easeInOut(duration: 0.15), value: isFocused)
    }

    private var foregroundColor: Color {
        if isSelected { return Theme.accent }
        if isFocused { return .white }
        return Color(white: 0.6)
    }

    private var backgroundColor: Color {
        if isSelected { return Theme.accent.opacity(0.4) }
        if isFocused { return Color.white.opacity(0.15) }
        return .clear
    }

    private var borderColor: Color {
        if isSelected { return Theme.accent }
        if isFocused { return Color.white.opacity(0.4) }
        return Color(white: 0.25)
    }
}
#endif
