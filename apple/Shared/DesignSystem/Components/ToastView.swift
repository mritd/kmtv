import os
import SwiftUI

/// Visual and logging style of a toast.
///
/// 提示条的外观与日志级别.
enum ToastStyle: Sendable {
    /// A failure or warning: red background, warning icon, logged at warning level.
    ///
    /// 失败或警告: 红色背景, 警告图标, 以 warning 级别记录日志.
    case error
    /// A confirmation: green background, checkmark icon, logged at info level.
    ///
    /// 确认信息: 绿色背景, 对勾图标, 以 info 级别记录日志.
    case success
}

@Observable
@MainActor
final class ToastManager {
    static let shared = ToastManager()

    var currentMessage: String?
    var isVisible: Bool = false
    var currentStyle: ToastStyle = .error

    private var dismissTask: Task<Void, Never>?
    private let logger = Logger(subsystem: "com.mritd.kmtv", category: "ui")

    private init() {}

    /// Shows `message` with `style`; the default keeps the error look.
    ///
    /// 以 `style` 样式显示 `message`; 默认保持错误外观.
    func show(_ message: String, style: ToastStyle = .error) {
        switch style {
        case .error: logger.warning("Toast: \(message)")
        case .success: logger.info("Toast: \(message)")
        }
        currentStyle = style
        dismissTask?.cancel()
        currentMessage = message
        isVisible = true
        dismissTask = Task {
            try? await Task.sleep(for: .seconds(5))
            guard !Task.isCancelled else { return }
            isVisible = false
            try? await Task.sleep(for: .seconds(0.5))
            guard !Task.isCancelled else { return }
            currentMessage = nil
        }
    }
}

struct ToastView: View {
    let message: String
    var style: ToastStyle = .error

    var body: some View {
        #if os(iOS)
        HStack(spacing: Spacing.sm) {
            Image(systemName: style == .success ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                .foregroundStyle(style == .success ? Color.green : Color.red)
            Text(message)
                .foregroundStyle(.primary)
                .lineLimit(2)
                .accessibilityIdentifier("toastMessage")
        }
        .font(AppFont.control)
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.md)
        .background(.regularMaterial, in: Capsule())
        .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
        #else
        HStack(spacing: 8) {
            Image(systemName: style == .success ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
            Text(message)
                .lineLimit(2)
                .accessibilityIdentifier("toastMessage")
        }
        .font(.subheadline.weight(.medium))
        .foregroundStyle(.white)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill((style == .success ? Color.green : Color.red).opacity(0.9))
        )
        #endif
    }
}
