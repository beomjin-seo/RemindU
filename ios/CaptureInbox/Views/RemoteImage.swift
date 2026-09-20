import SwiftUI

/// Cached, retrying remote image. AsyncImage gives up on the first transient
/// failure (server not up yet, sleeping simulator network) and never retries;
/// thumbnails are the whole grid, so they must recover on their own.
actor ImageStore {
    static let shared = ImageStore()

    private let cache = NSCache<NSURL, UIImage>()
    private let retryDelays: [Duration] = [.milliseconds(400), .seconds(1), .seconds(2)]

    func image(for url: URL) async throws -> UIImage {
        if let cached = cache.object(forKey: url as NSURL) { return cached }
        var lastError: Error = URLError(.unknown)
        for (index, delay) in ([Duration.zero] + retryDelays).enumerated() {
            if index > 0 { try? await Task.sleep(for: delay) }
            do {
                var request = URLRequest(url: url)
                InstallIdentity.apply(to: &request)
                let (data, response) = try await URLSession.shared.data(for: request)
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                guard (200..<300).contains(status), let image = UIImage(data: data) else {
                    throw URLError(.badServerResponse)
                }
                cache.setObject(image, forKey: url as NSURL)
                return image
            } catch {
                lastError = error
            }
        }
        throw lastError
    }
}

struct RemoteImage: View {
    let url: URL

    @State private var image: UIImage?
    @State private var failed = false
    @State private var attempt = 0

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .transition(.opacity)
            } else if failed {
                Button {
                    failed = false
                    attempt += 1
                } label: {
                    VStack(spacing: 6) {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 16, weight: .medium))
                        Text("다시 시도")
                            .font(.system(size: 10))
                    }
                    .foregroundStyle(Color.inkMuted)
                }
                .buttonStyle(.plain)
            } else {
                Skeleton()
            }
        }
        .task(id: attempt) {
            do {
                let loaded = try await ImageStore.shared.image(for: url)
                withAnimation(.easeOut(duration: 0.25)) { image = loaded }
            } catch {
                if !Task.isCancelled { failed = true }
            }
        }
    }
}

/// Pulsing placeholder used while a thumbnail loads.
struct Skeleton: View {
    @State private var pulse = false

    var body: some View {
        Color.white.opacity(pulse ? 0.09 : 0.03)
            .animation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true), value: pulse)
            .onAppear { pulse = true }
    }
}
