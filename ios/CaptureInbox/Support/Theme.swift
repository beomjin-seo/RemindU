import SwiftUI

// Design tokens from the dark concept prototype (ui-prototype/dark.css).
extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }

    static let inkBackground = Color(hex: 0x09090B)
    static let inkSurface = Color(hex: 0x111113)
    static let inkElevated = Color(hex: 0x1A1A1E)
    static let inkRow = Color(hex: 0x1E1E22)
    static let inkControl = Color(hex: 0x242427)
    static let inkText = Color(hex: 0xF5F5F7)
    static let inkMuted = Color(hex: 0x96969F)
    static let inkFaint = Color(hex: 0x85858F)
    static let inkAccent = Color(hex: 0x3478F6)

    static let confidenceHigh = Color(hex: 0x30D158)
    static let confidenceMedium = Color(hex: 0xFFD60A)
    static let confidenceLow = Color(hex: 0xFF9F0A)
}

extension ShoppingPayload {
    /// Three display states for the link, never a percentage: a verified
    /// product page, a search-results page, or "similar" when the screenshot
    /// identified the product weakly. Identification confidence alone must
    /// never read as link confidence — an unverified link is a search link.
    enum LinkAccuracy {
        case verified
        case search
        case similar

        var displayName: String {
            switch self {
            case .verified: return "검증됨"
            case .search: return "검색 결과"
            case .similar: return "비슷한 결과"
            }
        }

        var color: Color {
            switch self {
            case .verified: return .confidenceHigh
            case .search: return .confidenceMedium
            case .similar: return .confidenceLow
            }
        }
    }

    var linkAccuracy: LinkAccuracy {
        if link.verified { return .verified }
        return confidence == .low ? .similar : .search
    }
}
