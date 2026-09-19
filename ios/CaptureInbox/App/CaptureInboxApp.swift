import SwiftUI

@main
struct CaptureInboxApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            RootTabs()
                .environmentObject(appDelegate.router)
        }
    }
}

private struct RootTabs: View {
    @EnvironmentObject private var router: AppRouter

    var body: some View {
        TabView(selection: $router.tab) {
            InboxView()
                .tabItem { Label("모아보기", systemImage: "square.stack") }
                .tag(AppRouter.Tab.inbox)
            MapTabView()
                .tabItem { Label("지도", systemImage: "map") }
                .tag(AppRouter.Tab.map)
            SettingsView()
                .tabItem { Label("설정", systemImage: "gearshape") }
                .tag(AppRouter.Tab.settings)
        }
        .tint(.inkText)
        .preferredColorScheme(.dark)
    }
}
