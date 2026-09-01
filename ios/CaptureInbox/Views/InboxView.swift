import SwiftUI

private struct SafariItem: Identifiable {
    let id = UUID()
    let url: URL
}

struct InboxView: View {
    @State private var cards: [Card] = []
    @State private var errorMessage: String?
    @State private var safariItem: SafariItem?

    var body: some View {
        NavigationStack {
            List {
                ForEach(cards) { card in
                    CardRow(card: card)
                        .contentShape(Rectangle())
                        .onTapGesture { open(card) }
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) {
                                sendNotThis(card)
                            } label: {
                                Label("Not this", systemImage: "hand.thumbsdown")
                            }
                        }
                        .contextMenu {
                            Button(role: .destructive) {
                                sendNotThis(card)
                            } label: {
                                Label("Not this", systemImage: "hand.thumbsdown")
                            }
                        }
                }
            }
            .navigationTitle("Inbox")
            .refreshable { await load() }
            .task { await load() }
            .overlay {
                if cards.isEmpty {
                    ContentUnavailableView(
                        errorMessage == nil ? "No cards yet" : "Could not load cards",
                        systemImage: errorMessage == nil ? "tray" : "wifi.exclamationmark",
                        description: Text(errorMessage ?? "Share a screenshot to Capture Inbox to get started.")
                    )
                }
            }
            .sheet(item: $safariItem) { item in
                SafariView(url: item.url)
                    .ignoresSafeArea()
            }
        }
    }

    private func load() async {
        do {
            let page = try await APIClient.shared.fetchCards()
            cards = page.cards
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    // Link preview rule: the domain is always visible in the row badge
    // before the link is ever opened.
    private func open(_ card: Card) {
        guard card.type == .shopping,
              let link = card.shopping?.link,
              let url = URL(string: link.url) else { return }
        safariItem = SafariItem(url: url)
    }

    private func sendNotThis(_ card: Card) {
        Task {
            try? await APIClient.shared.sendFeedback(cardId: card.id, kind: .notThis)
            cards.removeAll { $0.id == card.id }
        }
    }
}

struct CardRow: View {
    let card: Card

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: iconName)
                .font(.title3)
                .foregroundStyle(.tint)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 4) {
                Text(card.title)
                    .font(.headline)
                    .lineLimit(2)
                subtitle
            }
        }
        .padding(.vertical, 2)
    }

    private var iconName: String {
        switch card.type {
        case .shopping: return "cart"
        case .place: return "mappin.and.ellipse"
        case .generic: return "doc.text"
        }
    }

    @ViewBuilder
    private var subtitle: some View {
        switch card.type {
        case .shopping:
            if let shopping = card.shopping {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        if let price = shopping.price {
                            Text("\(price.formatted()) \(shopping.currency)")
                                .font(.subheadline)
                                .fontWeight(.semibold)
                        }
                        if let deadline = shopping.deadlineText {
                            Text(deadline)
                                .font(.caption)
                                .foregroundStyle(.orange)
                        }
                    }
                    DomainBadge(link: shopping.link)
                }
            }
        case .place:
            if let address = card.place?.address {
                Text(address)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        case .generic:
            if let summary = card.generic?.summary {
                Text(summary)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
    }
}

struct DomainBadge: View {
    let link: ShoppingLink

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: link.verified ? "checkmark.seal.fill" : "magnifyingglass")
                .font(.caption2)
            Text(link.domain)
                .font(.caption)
            if !link.verified {
                Text("search results")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(link.verified ? Color.green.opacity(0.15) : Color.gray.opacity(0.15))
        .foregroundStyle(link.verified ? .green : .secondary)
        .clipShape(Capsule())
    }
}
