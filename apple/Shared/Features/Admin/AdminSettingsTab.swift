#if os(iOS)
import SwiftUI

/// The admin settings tab: access toggles, token lifetimes, playback and image proxy modes, and
/// search and probe limits. Each change saves at once and rolls back when the server rejects it.
///
/// 管理页的设置标签页: 访问开关, token 有效期, 播放与图片代理模式, 以及搜索与探测限制. 每项修改
/// 立即保存, 服务端拒绝时回滚.
struct AdminSettingsTab: View {
    let vm: AdminViewModel

    var body: some View {
        List {
            Section {
                Toggle("Anonymous Access", isOn: boolSetting(.anonymousAccess))
                Toggle("NSFW Filter", isOn: boolSetting(.nsfwFilter))
                Toggle("Ad Filter", isOn: boolSetting(.adFilter))
            }
            Section {
                ttlPicker("Access Token TTL", key: .accessTokenTTL, presets: [604_800, 2_592_000, 31_536_000])
                ttlPicker("Media Token TTL", key: .mediaTokenTTL, presets: [1_800, 3_600, 21_600, 43_200, 86_400])
                Picker("Playback Mode", selection: stringSetting(.playbackMode)) {
                    Text("Backend Proxy").tag("proxy")
                    Text("Client Direct").tag("direct")
                }
                Picker("Image Proxy", selection: stringSetting(.imageProxy)) {
                    Text("Backend Proxy").tag("server")
                    Text("Client Direct").tag("direct")
                    Text("Tencent CDN").tag("tencent")
                    Text("Ali CDN").tag("ali")
                }
            }
            Section(header: Text(String(localized: "Performance"))) {
                numericField(.searchConcurrency, String(localized: "Search Concurrency"), range: 1...50)
                numericField(.searchTimeout, String(localized: "Search Timeout"), range: 1...30, suffix: "s")
                numericField(.probeConcurrency, String(localized: "Probe Concurrency"), range: 1...50)
                numericField(.probeTimeout, String(localized: "Probe Timeout"), range: 1...20, suffix: "s")
            }
        }
    }

    private func numericField(_ key: AdminViewModel.SettingKey, _ label: String,
                              range: ClosedRange<Int>, suffix: String? = nil) -> some View {
        NumericSettingField(
            label: label,
            value: vm.settings[key.rawValue] ?? "",
            placeholder: key.defaultValue,
            range: range,
            suffix: suffix
        ) { await vm.updateSetting(key: key.rawValue, value: $0) }
    }

    private func boolSetting(_ key: AdminViewModel.SettingKey) -> Binding<Bool> {
        Binding(
            get: { vm.value(of: key) == "true" },
            set: { newValue in Task { await vm.setValue(newValue ? "true" : "false", for: key) } }
        )
    }

    /// A binding to a string setting; it reads the key's default while the server has no value and
    /// saves only a changed value.
    ///
    /// 字符串设置的绑定; 服务端没有值时读取该键的默认值, 并且只保存发生变化的值.
    private func stringSetting(_ key: AdminViewModel.SettingKey) -> Binding<String> {
        Binding(
            get: { vm.value(of: key) },
            set: { newValue in Task { await vm.setValue(newValue, for: key) } }
        )
    }

    /// A TTL picker over `presets`, in seconds. A stored value outside the presets (the Web admin
    /// accepts any number of seconds) is listed too, so the picker never shows an empty selection.
    ///
    /// 以秒为单位, 在 `presets` 中选择有效期的选择器. 不在预设中的已存值 (Web 管理端允许任意秒数)
    /// 也会列出, 因此选择器不会显示空白.
    private func ttlPicker(_ title: LocalizedStringKey, key: AdminViewModel.SettingKey,
                           presets: [Int]) -> some View {
        let selection = stringSetting(key)
        let current = Int(selection.wrappedValue)
        let options = presets + (current.map { presets.contains($0) || $0 <= 0 ? [] : [$0] } ?? [])
        return Picker(title, selection: selection) {
            ForEach(options.sorted(), id: \.self) { seconds in
                Text(Duration.seconds(seconds).formatted(.units(allowed: [.days, .hours, .minutes], width: .wide)))
                    .tag(String(seconds))
            }
        }
    }
}

/// A numeric text field that only commits on Enter or focus loss.
///
/// 仅在回车或失焦时提交的数字输入框.
private struct NumericSettingField: View {
    let label: String
    let value: String
    let placeholder: String
    let range: ClosedRange<Int>
    var suffix: String? = nil
    let onCommit: (String) async -> Void

    @State private var draft: String = ""
    @FocusState private var isFocused: Bool

    var body: some View {
        HStack {
            Text(label)
            Spacer()
            HStack(spacing: 2) {
                TextField(placeholder, text: $draft)
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.trailing)
                    .focused($isFocused)
                    .onSubmit { commit() }
                    .onChange(of: isFocused) { _, focused in
                        if !focused { commit() }
                    }
                Text(verbatim: suffix ?? " ")
                    .foregroundStyle(.secondary)
            }
            .frame(width: 80, alignment: .trailing)
        }
        .onAppear { draft = value.isEmpty ? placeholder : value }
        .onChange(of: value) { _, newValue in
            if !isFocused { draft = newValue.isEmpty ? placeholder : newValue }
        }
    }

    private func commit() {
        let filtered = draft.filter { $0.isNumber }
        let defaultVal = Int(placeholder) ?? range.lowerBound
        let n = min(max(Int(filtered) ?? defaultVal, range.lowerBound), range.upperBound)
        let clamped = String(n)
        draft = clamped
        let current = value.isEmpty ? placeholder : value
        guard clamped != current else { return }
        Task { await onCommit(clamped) }
    }
}
#endif
