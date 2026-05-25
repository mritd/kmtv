import os
import SwiftUI

@Observable
@MainActor
final class ToastManager {
    static let shared = ToastManager()

    var currentMessage: String?
    var isVisible: Bool = false

    private var dismissTask: Task<Void, Never>?
    private let logger = Logger(subsystem: "com.mritd.kmtv", category: "ui")

    private init() {}

    func show(_ message: String) {
        logger.warning("Toast: \(message)")
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

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
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
                .fill(Color.red.opacity(0.9))
        )
    }
}

