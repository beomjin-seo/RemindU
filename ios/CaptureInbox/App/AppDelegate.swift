import SwiftUI
import UserNotifications

/// Cross-tab navigation intents (e.g. a push tap that should open one card).
final class AppRouter: ObservableObject {
    enum Tab: Hashable {
        case inbox
        case map
        case settings
    }

    @Published var tab: Tab = .inbox
    @Published var pendingCardId: String?
}

/// Push plumbing: authorization, APNs token registration, and routing a tapped
/// notification (`card_id` in the payload, see docs/api.md) to its card.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    let router = AppRouter()

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in
            // Register regardless of the answer so the backend already holds
            // the token if the user enables alerts later in Settings.
            DispatchQueue.main.async { application.registerForRemoteNotifications() }
        }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { try? await APIClient.shared.registerDevice(token: token) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // Expected on simulators without push support; nothing to retry.
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        if let cardId = userInfo["card_id"] as? String, !cardId.isEmpty {
            DispatchQueue.main.async {
                self.router.tab = .inbox
                self.router.pendingCardId = cardId
            }
        }
        completionHandler()
    }
}
