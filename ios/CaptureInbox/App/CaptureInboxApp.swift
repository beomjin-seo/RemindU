import SwiftUI

@main
struct CaptureInboxApp: App {
    var body: some Scene {
        WindowGroup {
            TabView {
                InboxView()
                    .tabItem { Label("모아보기", systemImage: "square.stack") }
                MapTabView()
                    .tabItem { Label("지도", systemImage: "map") }
                SettingsView()
                    .tabItem { Label("설정", systemImage: "gearshape") }
            }
            .tint(.inkText)
            .preferredColorScheme(.dark)
        }
    }
}
