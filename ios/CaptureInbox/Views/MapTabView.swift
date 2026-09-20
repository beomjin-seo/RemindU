import SwiftUI
import MapKit

// TODO: Swap MapKit for the Naver Maps SDK later (CLAUDE.md decision).
struct MapTabView: View {
    @State private var placeCards: [Card] = []
    @State private var selectedCard: Card?
    @State private var position: MapCameraPosition = .region(Self.seoul)
    @State private var loaded = false

    // Where the validation cohort lives; the simulator's default camera is
    // North America, which reads as broken before any place is saved.
    private static let seoul = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 37.5665, longitude: 126.9780),
        span: MKCoordinateSpan(latitudeDelta: 0.12, longitudeDelta: 0.12)
    )

    var body: some View {
        ZStack(alignment: .top) {
            Map(position: $position) {
                ForEach(placeCards) { card in
                    if let place = card.place, let lat = place.lat, let lng = place.lng {
                        Annotation(place.name, coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lng)) {
                            Button {
                                selectedCard = card
                            } label: {
                                Image(systemName: "mappin.circle.fill")
                                    .font(.title)
                                    .foregroundStyle(.red)
                            }
                        }
                    }
                }
            }
            .mapStyle(.standard(elevation: .flat, pointsOfInterest: .including([.restaurant, .cafe])))
            .ignoresSafeArea(edges: .bottom)

            header

            if loaded && placeCards.isEmpty {
                emptyHint
            }
        }
        .task { await load() }
        .sheet(item: $selectedCard) { card in
            PlaceSheet(card: card)
                .presentationDetents([.height(180)])
                .presentationBackground(Color.inkElevated)
        }
    }

    private var header: some View {
        HStack {
            Text("지도")
                .font(.system(size: 22, weight: .bold))
                .tracking(-0.5)
                .foregroundStyle(Color.inkText)
            Spacer()
            Text("\(placeCards.count)곳")
                .font(.system(size: 12))
                .monospacedDigit()
                .foregroundStyle(Color.inkMuted)
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 12)
        .background(
            Color.inkSurface.opacity(0.85)
                .background(.ultraThinMaterial)
                .ignoresSafeArea(edges: .top)
        )
    }

    private var emptyHint: some View {
        VStack {
            Spacer()
            HStack(spacing: 9) {
                Image(systemName: "mappin.slash")
                    .font(.system(size: 14))
                    .foregroundStyle(Color(hex: 0xA6BFFF))
                Text("릴스에서 본 가게를 캡처하면 여기에 핀으로 모여요")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Color.inkText)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 11)
            .background(
                Capsule()
                    .fill(Color(hex: 0x292A2E).opacity(0.92))
                    .overlay(Capsule().stroke(Color.white.opacity(0.07)))
                    .shadow(color: .black.opacity(0.25), radius: 17, y: 8)
            )
            .padding(.bottom, 24)
        }
        .allowsHitTesting(false)
    }

    private func load() async {
        defer { loaded = true }
        do {
            let page = try await APIClient.shared.fetchCards(type: .place, limit: 100)
            placeCards = page.cards.filter { $0.place?.lat != nil && $0.place?.lng != nil }
            if let first = placeCards.first?.place, let lat = first.lat, let lng = first.lng {
                position = .region(MKCoordinateRegion(
                    center: CLLocationCoordinate2D(latitude: lat, longitude: lng),
                    span: MKCoordinateSpan(latitudeDelta: 0.05, longitudeDelta: 0.05)
                ))
            }
        } catch {
            // Keep last known pins on failure.
        }
    }
}

struct PlaceSheet: View {
    let card: Card

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(card.place?.name ?? card.title)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Color.inkText)
            if let address = card.place?.address {
                Text(address)
                    .font(.system(size: 13))
                    .foregroundStyle(Color.inkMuted)
            }
            Button {
                openInNaverMaps(name: card.place?.name ?? card.title)
            } label: {
                HStack(spacing: 8) {
                    Text("네이버 지도에서 열기")
                        .font(.system(size: 15, weight: .semibold))
                    Image(systemName: "arrow.up.right")
                        .font(.system(size: 13, weight: .semibold))
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, minHeight: 50)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.inkAccent))
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func openInNaverMaps(name: String) {
        let encoded = name.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? name
        guard let deepLink = URL(string: "nmap://search?query=\(encoded)") else { return }
        UIApplication.shared.open(deepLink) { success in
            if !success, let web = URL(string: "https://map.naver.com/p/search/\(encoded)") {
                UIApplication.shared.open(web)
            }
        }
    }
}
