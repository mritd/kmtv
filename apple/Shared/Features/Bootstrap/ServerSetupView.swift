import SwiftUI

struct ServerSetupView: View {
    @Environment(AppViewModel.self) private var appVM
    @State private var url = ""
    @State private var username = ""
    @State private var password = ""
    @State private var isConnecting = false
    @State private var errorMessage: String?
    @State private var didPrefill = false
    @State private var connectTask: Task<Void, Never>?

    private var isURLInvalid: Bool {
        let trimmed = url.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return false }
        return !isValidHTTPURL(trimmed)
    }

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            #if os(iOS)
            AppMark(size: 64)
            #endif
            Text("KMTV")
                #if os(tvOS)
                .font(.system(size: 72, weight: .bold))
                #else
                .font(AppFont.display)
                #endif
                .foregroundStyle(.primary)
            Text("Add your server to get started")
                #if os(tvOS)
                .font(.title3)
                #else
                .font(AppFont.secondary)
                #endif
                .foregroundStyle(.secondary)

            VStack(spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Server", systemImage: "server.rack")
                        #if os(tvOS)
                        .font(.subheadline.bold())
                        #else
                        .font(AppFont.footnote.weight(.semibold))
                        #endif
                        .foregroundStyle(.secondary)

                    TextField("Server URL", text: $url, prompt: Text(verbatim: "https://kmtv.example.com").foregroundColor(.gray))
                        .accessibilityIdentifier("serverURLField")
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .fieldSurface(invalid: isURLInvalid)
                        #endif
                        .autocorrectionDisabled()
                        #if os(tvOS)
                        .overlay(
                            RoundedRectangle(cornerRadius: 6)
                                .stroke(Color.red, lineWidth: isURLInvalid ? 1.5 : 0)
                        )
                        #endif

                    if isURLInvalid {
                        Text(String(localized: "Invalid URL format, must start with http:// or https://"))
                            #if os(tvOS)
                            .font(.caption2)
                            #else
                            .font(AppFont.footnote)
                            #endif
                            .foregroundStyle(.red)
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    Label("Account", systemImage: "person.circle")
                        #if os(tvOS)
                        .font(.subheadline.bold())
                        #else
                        .font(AppFont.footnote.weight(.semibold))
                        #endif
                        .foregroundStyle(.secondary)

                    TextField("Username", text: $username, prompt: Text("Username (Optional)"))
                        .accessibilityIdentifier("usernameField")
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .fieldSurface()
                        #endif
                        .autocorrectionDisabled()

                    SecureField("Password", text: $password, prompt: Text("Password (Optional)"))
                        .accessibilityIdentifier("passwordField")
                        #if os(iOS)
                        .fieldSurface()
                        #endif

                    Text("Leave empty for anonymous access")
                        #if os(tvOS)
                        .font(.caption2)
                        #else
                        .font(AppFont.footnote)
                        #endif
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 32)

            if let errorMessage {
                Text(errorMessage)
                    .foregroundStyle(.red)
                    #if os(tvOS)
                    .font(.body)
                    #else
                    .font(AppFont.footnote)
                    #endif
                    .padding(.horizontal, 32)
            }

            Button {
                isConnecting = true
                errorMessage = nil
                connectTask = Task { await connect() }
            } label: {
                if isConnecting {
                    HStack(spacing: 8) {
                        ProgressView()
                            .tint(.white)
                        Text("Connecting...", comment: "Button label while connecting to server")
                    }
                    .frame(maxWidth: .infinity)
                } else {
                    Text("Connect")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            #if os(tvOS)
            .tint(Theme.accent)
            #else
            .font(AppFont.bodyEmphasis)
            .controlSize(.large)
            .buttonBorderShape(.capsule)
            #endif
            .accessibilityIdentifier("connectButton")
            .disabled(url.trimmingCharacters(in: .whitespaces).isEmpty || isURLInvalid || isConnecting)
            .padding(.horizontal, 32)

            #if os(iOS)
            // Downloads of the last account still play without a network or a sign-in.
            //
            // 上一个账号的下载无需网络或登录即可播放.
            OfflineEntryButton(willOpen: { connectTask?.cancel() })
            #endif

            Spacer()
        }
        #if os(tvOS)
        .frame(maxWidth: 700)
        .frame(maxWidth: .infinity)
        #else
        .frame(maxWidth: 480)
        .frame(maxWidth: .infinity)
        .background(Surface.canvas)
        #endif
        .onAppear {
            if !didPrefill && !appVM.prefillServerURL.isEmpty {
                url = appVM.prefillServerURL
                appVM.prefillServerURL = ""
                didPrefill = true
            }
        }
        .onDisappear {
            connectTask?.cancel()
        }
    }

    /// Runs the connect as one structured call: cancelling `connectTask` (offline entry, the view
    /// going away) cancels the request itself, and the timeout lives in `connectServer`.
    ///
    /// 以单个结构化调用执行连接: 取消 `connectTask` (进入离线, 视图消失) 会直接取消请求本身, 超时
    /// 由 `connectServer` 负责.
    private func connect() async {
        let trimmedURL = url.trimmingCharacters(in: .whitespaces)
        guard !trimmedURL.isEmpty else { return }

        let startTime = ContinuousClock.now

        do {
            try await appVM.connectServer(
                url: trimmedURL,
                username: username.trimmingCharacters(in: .whitespaces),
                password: password
            )
            // Ensure loading is visible for at least 0.5s.
            //
            // 至少展示 0.5 秒加载状态, 避免快速成功时按钮闪烁.
            let elapsed = ContinuousClock.now - startTime
            if elapsed < .milliseconds(500) {
                try? await Task.sleep(for: .milliseconds(500) - elapsed)
            }
        } catch is CancellationError {
            // Task cancelled, ignore.
            //
            // 视图消失或用户离开时取消任务, 不需要向用户展示错误.
        } catch let error as URLError where error.code == .timedOut {
            errorMessage = String(localized: "Connection timed out")
        } catch let error as APIError {
            errorMessage = error.localizedMessage
        } catch {
            errorMessage = error.localizedDescription
        }

        isConnecting = false
    }
}
