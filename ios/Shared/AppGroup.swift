import Foundation

/// Settings shared between the app and the share extension through the App
/// Group container. The extension runs in its own sandbox and cannot read the
/// app's standard defaults, so the server URL chosen in Settings lives here.
enum AppGroup {
    static let identifier = "group.com.captureinbox.app"
    static let serverURLKey = "server_url"
    static let defaultServerURL = "http://localhost:8000"

    static let defaults: UserDefaults = UserDefaults(suiteName: identifier) ?? .standard

    static var serverURL: URL {
        let raw = defaults.string(forKey: serverURLKey) ?? defaultServerURL
        return URL(string: raw) ?? URL(string: defaultServerURL)!
    }
}
