import UIKit

/// Per-install identity sent as `X-Install-Id` on every request (docs/api.md).
/// identifierForVendor is shared by the app and its extensions, so captures
/// from the share sheet land in the same inbox without an App Group.
enum InstallIdentity {
    static let header = "X-Install-Id"
    static let defaultsKey = "install_id"

    static var id: String {
        let value = UIDevice.current.identifierForVendor?.uuidString ?? "unknown-install"
        // Mirrored into defaults so the value is inspectable (support, dev tooling).
        if AppGroup.defaults.string(forKey: defaultsKey) != value {
            AppGroup.defaults.set(value, forKey: defaultsKey)
        }
        return value
    }

    static func apply(to request: inout URLRequest) {
        request.setValue(id, forHTTPHeaderField: header)
    }
}
