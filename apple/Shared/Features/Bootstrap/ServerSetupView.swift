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

            Text("KMTV")
                #if os(tvOS)
                .font(.system(size: 72, weight: .bold))
                #else
                .font(.title.bold())
                #endif
                .foregroundStyle(.primary)
            Text("Add your server to get started")
                #if os(tvOS)
                .font(.title3)
                #else
                .font(.headline)
                #endif
                .foregroundStyle(.secondary)

            VStack(spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Server", systemImage: "server.rack")
                        .font(.subheadline.bold())
                        .foregroundStyle(.secondary)

                    TextField("Server URL", text: $url, prompt: Text(verbatim: "https://kmtv.example.com").foregroundColor(.gray))
                        .accessibilityIdentifier("serverURLField")
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .textFieldStyle(.roundedBorder)
                        #endif
                        .autocorrectionDisabled()
                        .overlay(
                            RoundedRectangle(cornerRadius: 6)
                                .stroke(Color.red, lineWidth: isURLInvalid ? 1.5 : 0)
                        )

                    if isURLInvalid {
                        Text(String(localized: "Invalid URL format, must start with http:// or https://"))
                            .font(.caption2)
                            .foregroundStyle(.red)
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    Label("Account", systemImage: "person.circle")
                        .font(.subheadline.bold())
                        .foregroundStyle(.secondary)

                    TextField("Username", text: $username, prompt: Text("Username (Optional)"))
                        .accessibilityIdentifier("usernameField")
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .textFieldStyle(.roundedBorder)
                        #endif
                        .autocorrectionDisabled()

                    SecureField("Password", text: $password, prompt: Text("Password (Optional)"))
                        .accessibilityIdentifier("passwordField")
                        #if os(iOS)
                        .textFieldStyle(.roundedBorder)
                        #endif

                    Text("Leave empty for anonymous access")
                        .font(.caption2)
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
                    .font(.caption)
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
            .tint(Theme.accent)
            .accessibilityIdentifier("connectButton")
            .disabled(url.trimmingCharacters(in: .whitespaces).isEmpty || isURLInvalid || isConnecting)
            .padding(.horizontal, 32)

            Spacer()
        }
        #if os(tvOS)
        .frame(maxWidth: 700)
        .frame(maxWidth: .infinity)
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

    private func connect() async {
        let trimmedURL = url.trimmingCharacters(in: .whitespaces)
        guard !trimmedURL.isEmpty else { return }

        let startTime = ContinuousClock.now

        do {
            let innerTask = Task {
                try await self.appVM.connectServer(
                    url: trimmedURL,
                    username: self.username.trimmingCharacters(in: .whitespaces),
                    password: self.password
                )
            }
            let timeoutTask = Task {
                try await Task.sleep(for: .seconds(10))
                innerTask.cancel()
            }
            do {
                try await innerTask.value
                timeoutTask.cancel()
            } catch is CancellationError {
                timeoutTask.cancel()
                try Task.checkCancellation()
                throw URLError(.timedOut)
            }
            // Ensure loading is visible for at least 0.5s.
            // 至少展示 0.5 秒加载状态, 避免快速成功时按钮闪烁.
            let elapsed = ContinuousClock.now - startTime
            if elapsed < .milliseconds(500) {
                try? await Task.sleep(for: .milliseconds(500) - elapsed)
            }
        } catch let error as APIError {
            if case .unauthorized = error {
                errorMessage = String(localized: "Login Required")
            } else {
                errorMessage = error.localizedDescription
            }
        } catch is CancellationError {
            // Task cancelled, ignore.
            // 视图消失或用户离开时取消任务, 不需要向用户展示错误.
        } catch let error as URLError where error.code == .timedOut {
            errorMessage = String(localized: "Connection timed out")
        } catch {
            errorMessage = error.localizedDescription
        }

        isConnecting = false
    }
}
