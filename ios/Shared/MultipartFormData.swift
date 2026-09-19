import UIKit

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

/// Upload-ready image bytes. The server accepts JPEG and PNG only, so anything
/// else (e.g. HEIC handed over by some share hosts) is transcoded to JPEG.
struct ImageUpload {
    let data: Data
    let mimeType: String
    let filename: String

    static func normalize(_ data: Data) -> ImageUpload? {
        if data.starts(with: [0x89, 0x50, 0x4E, 0x47]) {
            return ImageUpload(data: data, mimeType: "image/png", filename: "capture.png")
        }
        if data.starts(with: [0xFF, 0xD8, 0xFF]) {
            return ImageUpload(data: data, mimeType: "image/jpeg", filename: "capture.jpg")
        }
        guard let jpeg = UIImage(data: data)?.jpegData(compressionQuality: 0.9) else { return nil }
        return ImageUpload(data: jpeg, mimeType: "image/jpeg", filename: "capture.jpg")
    }
}
