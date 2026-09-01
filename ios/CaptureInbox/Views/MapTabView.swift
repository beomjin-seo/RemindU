import SwiftUI
import MapKit

// TODO: Swap MapKit for the Naver Maps SDK later (CLAUDE.md decision).
struct MapTabView: View {
    @State private var placeCards: [Card] = []
    @State private var selectedCard: Card?

    var body: some View {
        NavigationStack {
            Map {
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
            .navigationTitle("Map")
            .task { await load() }
            .refreshable { await load() }
            .sheet(item: $selectedCard) { card in
                PlaceSheet(card: card)
                    .presentationDetents([.height(180)])
            }
        }
    }

    private func load() async {
        do {
            let page = try await APIClient.shared.fetchCards(type: .place, limit: 100)
            placeCards = page.cards.filter { $0.place?.lat != nil && $0.place?.lng != nil }
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
                .font(.title3)
                .fontWeight(.semibold)
            if let address = card.place?.address {
                Text(address)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Button {
                openInNaverMaps(name: card.place?.name ?? card.title)
            } label: {
                Label("Open in Naver Maps", systemImage: "arrow.up.right.square")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
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
