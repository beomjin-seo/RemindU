import Foundation

enum CardType: String, Codable {
    case shopping
    case place
    case generic
}

enum CardStatus: String, Codable {
    case resolved
    case failed
}

struct Card: Codable, Identifiable {
    let id: String
    let captureId: String
    let type: CardType
    let status: CardStatus
    let title: String
    let createdAt: Date
    let shopping: ShoppingPayload?
    let place: PlacePayload?
    let generic: GenericPayload?
}

struct ShoppingPayload: Codable {
    enum Confidence: String, Codable {
        case high
        case medium
        case low
    }

    let productName: String
    let brand: String?
    let price: Int?
    let currency: String
    let deadlineText: String?
    let deadlineAt: Date?
    let confidence: Confidence
    /// Best link: first verified candidate, else a search-results fallback.
    let link: ShoppingLink
    /// Ranked search candidates verification was attempted on (max 3).
    let candidates: [ShoppingCandidate]

    private enum CodingKeys: String, CodingKey {
        case productName, brand, price, currency, deadlineText, deadlineAt, confidence, link, candidates
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        productName = try container.decode(String.self, forKey: .productName)
        brand = try container.decodeIfPresent(String.self, forKey: .brand)
        price = try container.decodeIfPresent(Int.self, forKey: .price)
        currency = try container.decode(String.self, forKey: .currency)
        deadlineText = try container.decodeIfPresent(String.self, forKey: .deadlineText)
        deadlineAt = try container.decodeIfPresent(Date.self, forKey: .deadlineAt)
        confidence = try container.decode(Confidence.self, forKey: .confidence)
        link = try container.decode(ShoppingLink.self, forKey: .link)
        // Older servers omit the key entirely.
        candidates = try container.decodeIfPresent([ShoppingCandidate].self, forKey: .candidates) ?? []
    }
}

struct ShoppingLink: Codable {
    enum Kind: String, Codable {
        case product
        case searchResults = "search_results"
    }

    let url: String
    let domain: String
    let verified: Bool
    let kind: Kind
    let trusted: Bool
}

struct ShoppingCandidate: Codable {
    let url: String
    let domain: String
    let title: String
    let verified: Bool
    let trusted: Bool
    let kind: ShoppingLink.Kind
}

struct PlacePayload: Codable {
    let name: String
    let category: String?
    let address: String?
    let lat: Double?
    let lng: Double?
    let naverPlaceUrl: String?
}

struct GenericPayload: Codable {
    let ocrText: String
    let summary: String?
}

struct CardsPage: Codable {
    let cards: [Card]
    let nextCursor: String?
}

enum CaptureStatus: String, Codable {
    case processing
    case resolved
    case failed
}

struct CaptureCreated: Codable {
    let captureId: String
    let status: CaptureStatus
}

struct CaptureState: Codable {
    let captureId: String
    let status: CaptureStatus
    let cardId: String?
    let failureReason: String?
}

enum FeedbackKind: String, Codable {
    case notThis = "not_this"
    case correct
}
