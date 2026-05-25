import SwiftUI

#if os(iOS)
struct SearchTextField: UIViewRepresentable {
    @Binding var text: String
    var placeholder: String
    var onSubmit: () -> Void

    /// Uses UIKit text field to keep iPad hit testing stable after navigation bar transitions.
    /// 使用 UIKit 文本框, 避免 iPad 导航栏切换后命中测试不稳定.
    func makeUIView(context: Context) -> UITextField {
        let textField = UITextField()
        textField.placeholder = placeholder
        textField.autocapitalizationType = .none
        textField.autocorrectionType = .no
        textField.returnKeyType = .search
        textField.font = .preferredFont(forTextStyle: .body)
        textField.textColor = UIColor(Theme.textPrimary)
        textField.attributedPlaceholder = NSAttributedString(
            string: placeholder,
            attributes: [.foregroundColor: UIColor(Theme.textSecondary)]
        )
        textField.delegate = context.coordinator
        textField.setContentHuggingPriority(.defaultLow, for: .horizontal)
        textField.setContentHuggingPriority(.required, for: .vertical)
        textField.setContentCompressionResistancePriority(.required, for: .vertical)
        textField.backgroundColor = .clear
        return textField
    }

    func updateUIView(_ uiView: UITextField, context: Context) {
        if uiView.text != text {
            uiView.text = text
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    final class Coordinator: NSObject, UITextFieldDelegate {
        let parent: SearchTextField

        init(_ parent: SearchTextField) {
            self.parent = parent
        }

        func textFieldDidChangeSelection(_ textField: UITextField) {
            parent.text = textField.text ?? ""
        }

        func textFieldShouldReturn(_ textField: UITextField) -> Bool {
            parent.onSubmit()
            textField.resignFirstResponder()
            return true
        }
    }
}
#else
struct SearchTextField: View {
    @Binding var text: String
    var placeholder: String
    var onSubmit: () -> Void

    var body: some View {
        TextField(placeholder, text: $text)
            .autocorrectionDisabled()
            .onSubmit { onSubmit() }
    }
}
#endif
