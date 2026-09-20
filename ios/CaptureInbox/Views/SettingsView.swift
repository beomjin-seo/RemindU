import SwiftUI
import UserNotifications

struct SettingsView: View {
    // Stored in the App Group so the share extension uploads to the same server.
    @AppStorage(AppGroup.serverURLKey, store: AppGroup.defaults)
    private var serverURL: String = AppGroup.defaultServerURL

    @State private var pushStatus: UNAuthorizationStatus = .notDetermined
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            Color.inkSurface.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text("설정")
                        .font(.system(size: 35, weight: .bold))
                        .tracking(-1.2)
                        .foregroundStyle(Color.inkText)
                        .padding(.top, 12)

                    sectionTitle("알림")
                    card {
                        row("가격·마감 알림", value: pushStatusLabel)
                        if pushStatus == .notDetermined {
                            divider
                            Button {
                                AppDelegate.requestPushPermissionIfNeeded()
                            } label: {
                                Text("알림 켜기")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(Color.inkAccent)
                                    .frame(maxWidth: .infinity, minHeight: 44)
                            }
                        } else if pushStatus == .denied {
                            divider
                            Button {
                                if let url = URL(string: UIApplication.openSettingsURLString) {
                                    UIApplication.shared.open(url)
                                }
                            } label: {
                                Text("iOS 설정에서 켜기")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(Color.inkAccent)
                                    .frame(maxWidth: .infinity, minHeight: 44)
                            }
                        }
                    }
                    footnote("세일·마감 D-1에만 알려요. 확실하지 않으면 보내지 않아요.")

                    sectionTitle("서버 주소")
                    card {
                        TextField("http://localhost:8000", text: $serverURL)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .font(.system(size: 15, design: .monospaced))
                            .foregroundStyle(Color.inkText)
                            .frame(minHeight: 44)
                    }
                    footnote("앱과 공유 확장이 함께 쓰는 백엔드 주소예요. 로컬 개발 기본값은 http://localhost:8000.")

                    sectionTitle("정보")
                    card {
                        row("앱", value: "Capture Inbox")
                        divider
                        row("버전", value: "0.1.0")
                        divider
                        row("설치 ID", value: String(InstallIdentity.id.prefix(8)))
                    }
                    footnote("스크린샷을 2번 탭으로 공유하면, 무엇인지 읽고 필요한 순간에 다시 알려줘요. 글자는 기기 안에서 읽고, 서버에는 텍스트와 사진만 보내요.")
                }
                .padding(.horizontal, 22)
                .padding(.bottom, 45)
            }
        }
        .task { await refreshPushStatus() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await refreshPushStatus() } }
        }
    }

    // MARK: pieces

    private func sectionTitle(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(Color(hex: 0xB2B2BA))
            .padding(.top, 28)
            .padding(.bottom, 8)
    }

    private func card<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 0, content: content)
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.inkElevated))
    }

    private func row(_ label: String, value: String) -> some View {
        HStack {
            Text(label)
                .font(.system(size: 15))
                .foregroundStyle(Color.inkText)
            Spacer()
            Text(value)
                .font(.system(size: 15))
                .foregroundStyle(Color.inkMuted)
        }
        .frame(minHeight: 44)
    }

    private var divider: some View {
        Rectangle().fill(Color.white.opacity(0.07)).frame(height: 1)
    }

    private func footnote(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 12))
            .lineSpacing(2)
            .foregroundStyle(Color.inkMuted)
            .padding(.top, 8)
            .padding(.horizontal, 4)
    }

    private var pushStatusLabel: String {
        switch pushStatus {
        case .authorized, .provisional, .ephemeral: return "켜짐"
        case .denied: return "꺼짐"
        default: return "아직 안 물어봤어요"
        }
    }

    @MainActor
    private func refreshPushStatus() async {
        pushStatus = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }
}
