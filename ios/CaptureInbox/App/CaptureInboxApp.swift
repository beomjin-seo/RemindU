import SwiftUI

@main
struct CaptureInboxApp: App {
    var body: some Scene {
        WindowGroup {
            TabView {
                InboxView()
                    .tabItem { Label("Inbox", systemImage: "tray.full") }
                MapTabView()
                    .tabItem { Label("Map", systemImage: "map") }
                SettingsView()
                    .tabItem { Label("Settings", systemImage: "gearshape") }
            }
        }
    }
}
