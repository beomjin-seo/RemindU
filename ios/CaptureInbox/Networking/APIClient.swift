import Foundation

enum APIError: Error {
    case invalidURL
    case badStatus(Int)
    case unsupportedImage
}

struct APIClient {
    static let shared = APIClient()

    private let session: URLSession = .shared

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let raw = try container.decode(String.self)
            if let date = withFraction.date(from: raw) ?? plain.date(from: raw) {
                return date
            }
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Unrecognized ISO 8601 date: \(raw)"
            )
        }
        return decoder
    }()

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        return encoder
    }()

    static func captureImageURL(captureId: String) -> URL {
        AppGroup.serverURL.appendingPathComponent("v1/captures/\(captureId)/image")
    }

    func fetchCards(type: CardType? = nil, cursor: String? = nil, limit: Int = 20) async throws -> CardsPage {
        var query = [URLQueryItem(name: "limit", value: String(limit))]
        if let type { query.append(URLQueryItem(name: "type", value: type.rawValue)) }
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        let request = try makeRequest(path: "/v1/cards", query: query)
        return try await send(request, decoding: CardsPage.self)
    }

    func fetchCard(id: String) async throws -> Card {
        let request = try makeRequest(path: "/v1/cards/\(id)")
        return try await send(request, decoding: Card.self)
    }

    func fetchCapture(id: String) async throws -> CaptureState {
        let request = try makeRequest(path: "/v1/captures/\(id)")
        return try await send(request, decoding: CaptureState.self)
    }

    /// `ocrText` is the on-device Vision output (newline-separated lines); the
    /// server extracts from it instead of the pixels.
    func uploadCapture(imageData: Data, ocrText: String? = nil, sourceHint: String? = nil) async throws -> CaptureCreated {
        guard let upload = ImageUpload.normalize(imageData) else { throw APIError.unsupportedImage }
        var request = try makeRequest(path: "/v1/captures")
        request.httpMethod = "POST"
        var form = MultipartFormData()
        form.addFile(name: "image", filename: upload.filename, mimeType: upload.mimeType, data: upload.data)
        if let ocrText { form.addField(name: "ocr_text", value: ocrText) }
        if let sourceHint { form.addField(name: "source_hint", value: sourceHint) }
        request.setValue(form.contentType, forHTTPHeaderField: "Content-Type")
        request.httpBody = form.finalized()
        return try await send(request, decoding: CaptureCreated.self)
    }

    func sendFeedback(cardId: String, kind: FeedbackKind) async throws {
        var request = try makeRequest(path: "/v1/cards/\(cardId)/feedback")
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try Self.encoder.encode(["kind": kind.rawValue])
        try await send(request)
    }

    func registerDevice(token: String) async throws {
        var request = try makeRequest(path: "/v1/devices")
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try Self.encoder.encode(["apns_token": token])
        try await send(request)
    }

    private func makeRequest(path: String, query: [URLQueryItem] = []) throws -> URLRequest {
        guard var components = URLComponents(url: AppGroup.serverURL, resolvingAgainstBaseURL: false) else {
            throw APIError.invalidURL
        }
        components.path = path
        if !query.isEmpty { components.queryItems = query }
        guard let url = components.url else { throw APIError.invalidURL }
        var request = URLRequest(url: url)
        InstallIdentity.apply(to: &request)
        return request
    }

    @discardableResult
    private func send(_ request: URLRequest) async throws -> Data {
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else { throw APIError.badStatus(status) }
        return data
    }

    private func send<T: Decodable>(_ request: URLRequest, decoding type: T.Type) async throws -> T {
        let data = try await send(request)
        return try Self.decoder.decode(T.self, from: data)
    }
}
