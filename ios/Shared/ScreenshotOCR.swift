import Foundation
import ImageIO
import Vision

/// On-device text recognition (Apple Vision). Screenshot pixels never leave
/// the device for extraction: only the recognized lines are uploaded as
/// `ocr_text`, and the server keeps the image solely as a thumbnail.
enum ScreenshotOCR {
    enum OCRError: Error {
        case undecodableImage
    }

    /// Recognized lines joined by "\n" in top-to-bottom reading order.
    static func recognizeText(in cgImage: CGImage) async throws -> String {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["ko-KR", "en-US"]
        request.usesLanguageCorrection = true
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        return try await Task.detached(priority: .userInitiated) {
            try handler.perform([request])
            let observations = request.results ?? []
            // Vision's origin is bottom-left, so a larger minY sits higher on screen.
            return observations
                .sorted { $0.boundingBox.minY > $1.boundingBox.minY }
                .compactMap { $0.topCandidates(1).first?.string }
                .joined(separator: "\n")
        }.value
    }

    /// Decodes `data`, downscaled to `maxPixelSize` on the long edge when
    /// larger (keeps 3x screenshots inside the share extension's memory
    /// budget), then recognizes its text.
    static func recognizeText(in data: Data, maxPixelSize: Int? = nil) async throws -> String {
        guard let cgImage = decode(data, maxPixelSize: maxPixelSize) else {
            throw OCRError.undecodableImage
        }
        return try await recognizeText(in: cgImage)
    }

    static func decode(_ data: Data, maxPixelSize: Int? = nil) -> CGImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        if let maxPixelSize, longEdge(of: source) > maxPixelSize {
            let options: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
            ]
            return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
        }
        return CGImageSourceCreateImageAtIndex(source, 0, nil)
    }

    private static func longEdge(of source: CGImageSource) -> Int {
        guard
            let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
            let width = properties[kCGImagePropertyPixelWidth] as? Int,
            let height = properties[kCGImagePropertyPixelHeight] as? Int
        else { return .max }
        return max(width, height)
    }
}
