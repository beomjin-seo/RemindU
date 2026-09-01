import Foundation

enum AppConfig {
    static let serverURLKey = "server_url"
    static let defaultServerURL = "http://localhost:8000"

    static var serverURL: URL {
        let raw = UserDefaults.standard.string(forKey: serverURLKey) ?? defaultServerURL
        return URL(string: raw) ?? URL(string: defaultServerURL)!
    }
}

/// Small reusable multipart/form-data body builder.
struct MultipartFormData {
    let boundary = "Boundary-\(UUID().uuidString)"
    private var body = Data()

    var contentType: String { "multipart/form-data; boundary=\(boundary)" }

    mutating func addField(name: String, value: String) {
        body.append(Data("--\(boundary)\r\n".utf8))
        body.append(Data("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n".utf8))
        body.append(Data("\(value)\r\n".utf8))
    }

    mutating func addFile(name: String, filename: String, mimeType: String, data: Data) {
        body.append(Data("--\(boundary)\r\n".utf8))
        body.append(Data("Content-Disposition: form-data; name=\"\(name)\"; filename=\"\(filename)\"\r\n".utf8))
        body.append(Data("Content-Type: \(mimeType)\r\n\r\n".utf8))
        body.append(data)
        body.append(Data("\r\n".utf8))
    }

    func finalized() -> Data {
        var result = body
        result.append(Data("--\(boundary)--\r\n".utf8))
        return result
    }
}

enum APIError: Error {
    case invalidURL
    case badStatus(Int)
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

    func uploadCapture(imageData: Data, sourceHint: String? = nil) async throws -> CaptureCreated {
        var request = try makeRequest(path: "/v1/captures")
        request.httpMethod = "POST"
        var form = MultipartFormData()
        form.addFile(name: "image", filename: "capture.jpg", mimeType: "image/jpeg", data: imageData)
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
        guard var components = URLComponents(url: AppConfig.serverURL, resolvingAgainstBaseURL: false) else {
            throw APIError.invalidURL
        }
        components.path = path
        if !query.isEmpty { components.queryItems = query }
        guard let url = components.url else { throw APIError.invalidURL }
        return URLRequest(url: url)
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
