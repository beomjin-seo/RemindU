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
    let link: ShoppingLink
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
}

enum FeedbackKind: String, Codable {
    case notThis = "not_this"
    case correct
}
