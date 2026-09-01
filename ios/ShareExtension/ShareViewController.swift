import UIKit
import UniformTypeIdentifiers

/// Minimal share-extension UI: receive one image, upload it, show the result, dismiss.
/// The 2-tap capture path is the core product experience, so every code path
/// must end in completeRequest/cancelRequest — never leave the sheet hanging.
final class ShareViewController: UIViewController {
    // TODO: share the server URL with the main app via an App Group once
    // signing/entitlements are set up; until then both sides default to localhost.
    private static let defaultServerURL = "http://localhost:8000"

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
        statusLabel.text = "Saving…"
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
            guard let data = Self.imageData(from: value) else {
                self.finish(success: false, message: "Unsupported image")
                return
            }
            self.upload(imageData: data)
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

    private func upload(imageData: Data) {
        guard let url = URL(string: Self.defaultServerURL + "/v1/captures") else {
            finish(success: false, message: "Bad server URL")
            return
        }

        let boundary = "Boundary-\(UUID().uuidString)"
        var body = Data()
        body.append(Data("--\(boundary)\r\n".utf8))
        body.append(Data("Content-Disposition: form-data; name=\"image\"; filename=\"capture.jpg\"\r\n".utf8))
        body.append(Data("Content-Type: image/jpeg\r\n\r\n".utf8))
        body.append(imageData)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = body

        let task = URLSession.shared.dataTask(with: request) { [weak self] _, response, error in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let ok = error == nil && (200..<300).contains(status)
            self?.finish(success: ok, message: ok ? "Saved" : "Upload failed")
        }
        task.resume()
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
