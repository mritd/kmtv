import SwiftUI

struct ConnectingView: View {
    let serverAddress: String

    var body: some View {
        ZStack {
            // Gradient background.
            // 连接页背景渐变.
            LinearGradient(
                colors: [
                    Color(red: 10/255, green: 10/255, blue: 10/255),
                    Color(red: 17/255, green: 17/255, blue: 40/255)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()

                // App icon with glow (shape fallback - no image asset available).
                // 带光晕的应用图标, 当前没有图片资源时使用形状兜底.
                RoundedRectangle(cornerRadius: iconSize * 0.22)
                    .fill(
                        LinearGradient(
                            colors: [
                                Color(red: 74/255, green: 62/255, blue: 127/255),
                                Color(red: 26/255, green: 15/255, blue: 63/255)
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: iconSize, height: iconSize)
                    .overlay(
                        Text("K")
                            .font(.system(size: iconSize * 0.4, weight: .bold))
                            .foregroundStyle(.white)
                    )
                    .shadow(color: Color(red: 74/255, green: 62/255, blue: 127/255).opacity(0.4), radius: 12, y: 4)
                    .padding(.bottom, 20)

                // App name.
                // 应用名称.
                Text("KMTV")
                    .font(.system(size: titleSize, weight: .bold))
                    .foregroundStyle(Color(red: 232/255, green: 232/255, blue: 240/255))
                    .kerning(3)
                    .padding(.bottom, 32)

                // Spinner + status text.
                // 加载指示器和连接状态文本.
                HStack(spacing: 10) {
                    ProgressView()
                        .tint(Color(red: 108/255, green: 159/255, blue: 255/255))
                    Text("Connecting to server...", comment: "Bootstrap connecting status")
                        .foregroundStyle(.white.opacity(0.6))
                        .font(.system(size: 14))
                }
                .padding(.bottom, 10)

                // Server address.
                // 正在连接的服务器地址.
                Text(serverAddress)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.3))

                Spacer()
            }
        }
    }

    private var iconSize: CGFloat {
        #if os(tvOS)
        80
        #else
        64
        #endif
    }

    private var titleSize: CGFloat {
        #if os(tvOS)
        40
        #else
        32
        #endif
    }
}
