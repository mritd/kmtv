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

/// Shows short transient messages to the user. View models take one in their initializer, with
/// `ToastManager.shared` as the default, so tests can assert what the user saw through a fake.
///
/// Presentation rule: transient failures (a feed, search, or background action that failed) go to
/// a toast; errors about input in an open form stay inline in that form, so the typed values and
/// the reason stay together.
///
/// 向用户显示简短的临时提示. 视图模型在初始化时接收一个实例, 默认为 `ToastManager.shared`, 测试因此
/// 可以通过替身断言用户看到的内容.
///
/// 展示规则: 临时性失败 (信息流, 搜索或后台操作失败) 使用提示条; 已打开表单中与输入有关的错误留在该
/// 表单内显示, 让已输入的值与原因保持在一起.
@MainActor
protocol ToastPresenting: AnyObject, Sendable {
    /// Shows `message` with `style`.
    ///
    /// 以 `style` 样式显示 `message`.
    func show(_ message: String, style: ToastStyle)
}

extension ToastPresenting {
    /// Shows `message` as an error.
    ///
    /// 以错误样式显示 `message`.
    func show(_ message: String) {
        show(message, style: .error)
    }

    /// Shows the user-facing message of `error`; cancellations show nothing (see `Error.userMessage`).
    ///
    /// 显示 `error` 面向用户的提示; 取消不显示任何内容 (见 `Error.userMessage`).
    func show(error: Error) {
        guard let message = error.userMessage else { return }
        show(message, style: .error)
    }
}

/// The app's toast presenter; the root view draws its current message.
///
/// App 的提示条展示者; 根视图绘制其当前消息.
@Observable
@MainActor
final class ToastManager: ToastPresenting {
    static let shared = ToastManager()

    var currentMessage: String?
    var isVisible: Bool = false
    var currentStyle: ToastStyle = .error

    private var dismissTask: Task<Void, Never>?
    private let logger = Logger(subsystem: "com.mritd.kmtv", category: "ui")

    private init() {}

    /// Shows `message` with `style`; `show(_:)` keeps the error look.
    ///
    /// 以 `style` 样式显示 `message`; `show(_:)` 保持错误外观.
    func show(_ message: String, style: ToastStyle) {
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
                .foregroundStyle(statusColor)
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
        HStack(spacing: TVSpacing.sm) {
            Image(systemName: style == .success ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
            Text(message)
                .lineLimit(2)
                .accessibilityIdentifier("toastMessage")
        }
        .font(.subheadline.weight(.medium))
        .foregroundStyle(.white)
        .padding(.horizontal, TVSpacing.md)
        .padding(.vertical, TVSpacing.shelf)
        .background(
            RoundedRectangle(cornerRadius: TVRadius.button)
                .fill(statusColor.opacity(0.9))
        )
        #endif
    }

    /// The style's status color: success or danger.
    ///
    /// 该样式对应的状态色: 成功或危险.
    private var statusColor: Color {
        style == .success ? StatusColor.success : StatusColor.danger
    }
}
