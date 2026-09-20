import UIKit
import UniformTypeIdentifiers

/// Minimal share-extension UI: receive one image, read its text on device,
/// upload both, show the result, dismiss. The 2-tap capture path is the core
/// product experience, so every code path must end in
/// completeRequest/cancelRequest — never leave the sheet hanging.
final class ShareViewController: UIViewController {
    // The server URL comes from the App Group (set in the app's Settings).
    // "Saved" means uploaded: the pipeline runs server-side and the card
    // arrives by push, so a later pipeline failure is only visible in the
    // app (background-URLSession handoff for large uploads is deferred).
    // Long-edge cap for the OCR decode; keeps 3x screenshots inside the
    // extension's memory budget. The original bytes are still uploaded.
    private static let ocrMaxPixelSize = 2000

    private let statusLabel = UILabel()
    private let spinner = UIActivityIndicatorView(style: .large)

    override func viewDidLoad() {
        super.viewDidLoad()
        setUpUI()
        loadImageAndUpload()
    }

    private func setUpUI() {
        view.backgroundColor = .systemBackground

        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.startAnimating()
        view.addSubview(spinner)

        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.text = "글자 읽는 중…"
        statusLabel.font = .preferredFont(forTextStyle: .headline)
        statusLabel.textAlignment = .center
        view.addSubview(statusLabel)

        NSLayoutConstraint.activate([
            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -24),
            statusLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            statusLabel.topAnchor.constraint(equalTo: spinner.bottomAnchor, constant: 16),
        ])
    }

    private func loadImageAndUpload() {
        guard
            let item = extensionContext?.inputItems.first as? NSExtensionItem,
            let provider = item.attachments?.first(where: {
                $0.hasItemConformingToTypeIdentifier(UTType.image.identifier)
            })
        else {
            finish(success: false, message: "No image found")
            return
        }

        provider.loadItem(forTypeIdentifier: UTType.image.identifier, options: nil) { [weak self] value, error in
            guard let self else { return }
            if error != nil {
                self.finish(success: false, message: "Could not read image")
                return
            }
            guard let raw = Self.imageData(from: value), let upload = ImageUpload.normalize(raw) else {
                self.finish(success: false, message: "Unsupported image")
                return
            }
            Task { @MainActor in
                await self.recognizeAndUpload(upload)
            }
        }
    }

    /// Providers hand back images as a file URL, raw Data, or UIImage depending on the host app.
    private static func imageData(from value: NSSecureCoding?) -> Data? {
        switch value {
        case let url as URL:
            return try? Data(contentsOf: url)
        case let data as Data:
            return data
        case let image as UIImage:
            return image.jpegData(compressionQuality: 0.9)
        default:
            return nil
        }
    }

    @MainActor
    private func recognizeAndUpload(_ upload: ImageUpload) async {
        statusLabel.text = "글자 읽는 중…"
        // A Vision failure degrades to empty ocr_text, which the server fails
        // closed as no_text instead of guessing from pixels.
        let ocrText = (try? await ScreenshotOCR.recognizeText(
            in: upload.data, maxPixelSize: Self.ocrMaxPixelSize
        )) ?? ""
        statusLabel.text = "Saving…"
        do {
            try await send(upload, ocrText: ocrText)
            finish(success: true, message: "Saved")
        } catch {
            finish(success: false, message: "Upload failed")
        }
    }

    private func send(_ upload: ImageUpload, ocrText: String) async throws {
        let url = AppGroup.serverURL.appendingPathComponent("v1/captures")
        var form = MultipartFormData()
        form.addFile(name: "image", filename: upload.filename, mimeType: upload.mimeType, data: upload.data)
        form.addField(name: "ocr_text", value: ocrText)
        form.addField(name: "source_hint", value: "share")

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(form.contentType, forHTTPHeaderField: "Content-Type")
        InstallIdentity.apply(to: &request)
        let (_, response) = try await URLSession.shared.upload(for: request, from: form.finalized())
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else { throw URLError(.badServerResponse) }
    }

    private func finish(success: Bool, message: String) {
        DispatchQueue.main.async {
            self.spinner.stopAnimating()
            self.spinner.isHidden = true
            self.statusLabel.text = success ? "✓ \(message)" : message
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                self.extensionContext?.completeRequest(returningItems: nil)
            }
        }
    }
}
