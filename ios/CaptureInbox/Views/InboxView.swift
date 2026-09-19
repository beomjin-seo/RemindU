import PhotosUI
import SwiftUI

/// Dark-concept library: scattered screenshots gather into a 3-column grid
/// (ui-prototype/dark.html). Tapping a shot opens the detail overlay.
struct InboxView: View {
    @EnvironmentObject private var router: AppRouter

    @State private var cards: [Card] = []
    @State private var errorMessage: String?
    @State private var selected: Card?

    // Secondary capture entry: PhotosPicker needs no photo permission.
    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var importing = false

    // Intro animation state.
    @State private var gathered = false
    @State private var introDone = false
    @State private var statusText: String?
    @State private var hasPlayedIntro = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let ocrMaxPixelSize = 2000
    private static let resolvePollAttempts = 15

    private let columns = [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)]

    var body: some View {
        ZStack {
            Color.inkSurface.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    sectionLabel
                    headingStack
                        .frame(height: 104, alignment: .topLeading)
                        .padding(.top, 14)
                    collectionHeading
                        .padding(.top, 2)
                        .padding(.bottom, 12)
                    grid
                    footnote
                }
                .padding(.horizontal, 22)
                .padding(.top, 12)
                .padding(.bottom, 45)
            }
            .refreshable { await load() }

            pickerButton
            statusPill

            if let card = selected {
                CardDetailView(card: card) {
                    withAnimation(.spring(response: 0.4, dampingFraction: 0.9)) { selected = nil }
                } onNotThis: {
                    sendNotThis(card)
                }
                .zIndex(10)
                .transition(.asymmetric(
                    insertion: .scale(scale: 0.94).combined(with: .opacity),
                    removal: .opacity
                ))
            }
        }
        .task {
            if let cardId = router.pendingCardId { await openCard(id: cardId) }
            await load()
        }
        .onChange(of: router.pendingCardId) { _, cardId in
            guard let cardId else { return }
            Task { await openCard(id: cardId) }
        }
        .onChange(of: pickerItems) { _, items in
            guard !items.isEmpty else { return }
            Task { await importPicked(items) }
        }
    }

    // MARK: header

    private var sectionLabel: some View {
        HStack(spacing: 8) {
            Image(systemName: "square.on.square")
                .font(.system(size: 12, weight: .medium))
            Text("스크린샷")
                .font(.system(size: 12, weight: .medium))
        }
        .foregroundStyle(Color(hex: 0xADAEB7))
    }

    private var headingStack: some View {
        ZStack(alignment: .topLeading) {
            Text("흩어진 순간을,\n한곳에.")
                .font(.system(size: 34, weight: .bold))
                .tracking(-1.2)
                .lineSpacing(2)
                .opacity(introDone ? 0 : 1)
                .offset(y: introDone ? -9 : 0)
            VStack(alignment: .leading, spacing: 11) {
                Text("모아보기")
                    .font(.system(size: 35, weight: .bold))
                    .tracking(-1.2)
                Text("저장한 순간에서, 원래 페이지로.")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.inkMuted)
            }
            .opacity(introDone ? 1 : 0)
            .offset(y: introDone ? 0 : 9)
        }
        .foregroundStyle(Color.inkText)
    }

    private var collectionHeading: some View {
        HStack {
            Text("최근 스크린샷")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Color(hex: 0xB2B2BA))
            Spacer()
            Text("\(cards.count)개")
                .font(.system(size: 11))
                .monospacedDigit()
                .foregroundStyle(Color(hex: 0x8E8E98))
        }
    }

    // MARK: grid

    @ViewBuilder
    private var grid: some View {
        if cards.isEmpty {
            emptyState
        } else {
            LazyVGrid(columns: columns, spacing: 8) {
                ForEach(Array(cards.enumerated()), id: \.element.id) { index, card in
                    ShotCell(card: card) {
                        withAnimation(.spring(response: 0.42, dampingFraction: 0.86)) {
                            selected = card
                        }
                    }
                    .offset(gathered ? .zero : scatterOffset(index))
                    .rotationEffect(gathered ? .zero : scatterRotation(index))
                    .scaleEffect(gathered ? 1 : 1.12)
                    .animation(
                        .spring(response: 0.85, dampingFraction: 0.72)
                            .delay(Double(index % 9) * 0.055),
                        value: gathered
                    )
                }
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "sparkles.rectangle.stack")
                .font(.system(size: 30))
                .foregroundStyle(Color.inkMuted)
            Text(errorMessage == nil ? "아직 스크린샷이 없어요" : "불러오지 못했어요")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.inkText)
            Text(errorMessage ?? "공유 시트에서 Capture Inbox로 보내거나, + 버튼으로 스크린샷을 고르세요.")
                .font(.system(size: 12))
                .foregroundStyle(Color.inkMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 70)
    }

    private var footnote: some View {
        HStack(spacing: 6) {
            Image(systemName: "link")
                .font(.system(size: 11))
            Text("장면을 누르면, 다시 이어져요")
                .font(.system(size: 11))
        }
        .foregroundStyle(Color.inkFaint)
        .frame(maxWidth: .infinity)
        .padding(.top, 23)
    }

    private var pickerButton: some View {
        VStack {
            Spacer()
            HStack {
                Spacer()
                PhotosPicker(selection: $pickerItems, maxSelectionCount: 10, matching: .screenshots) {
                    Image(systemName: "plus")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 52, height: 52)
                        .background(Circle().fill(Color.inkAccent))
                        .shadow(color: .black.opacity(0.3), radius: 12, y: 6)
                }
                .disabled(importing)
                .opacity(importing ? 0.5 : 1)
                .accessibilityLabel("스크린샷 추가")
                .padding(.trailing, 22)
                .padding(.bottom, 20)
            }
        }
    }

    private var statusPill: some View {
        VStack {
            Spacer()
            if let statusText {
                HStack(spacing: 9) {
                    Text("✦")
                        .font(.system(size: 15))
                        .foregroundStyle(Color(hex: 0xA6BFFF))
                    Text(statusText)
                        .font(.system(size: 12, weight: .medium))
                        .monospacedDigit()
                        .foregroundStyle(Color.inkText)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 11)
                .background(
                    Capsule()
                        .fill(Color(hex: 0x292A2E).opacity(0.9))
                        .overlay(Capsule().stroke(Color.white.opacity(0.07)))
                        .shadow(color: .black.opacity(0.25), radius: 17, y: 8)
                )
                .padding(.bottom, 35)
                .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
        }
        .animation(.easeInOut(duration: 0.35), value: statusText)
        .allowsHitTesting(false)
    }

    // MARK: scatter geometry (deterministic per index)

    private func scatterOffset(_ index: Int) -> CGSize {
        let seed = Double(index * 73 + 17)
        return CGSize(width: sin(seed) * 110, height: cos(seed * 1.3) * 150 - 30)
    }

    private func scatterRotation(_ index: Int) -> Angle {
        .degrees(sin(Double(index * 41 + 7)) * 15)
    }

    // MARK: data + intro sequence

    private func load() async {
        do {
            let page = try await APIClient.shared.fetchCards(limit: 60)
            cards = page.cards
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
        if !hasPlayedIntro {
            hasPlayedIntro = true
            await playIntro()
        }
    }

    private func playIntro() async {
        guard !reduceMotion, !cards.isEmpty else {
            gathered = true
            withAnimation(.easeInOut(duration: 0.4)) { introDone = true }
            return
        }
        statusText = "흩어진 순간을 모으고 있어요"
        try? await Task.sleep(for: .milliseconds(500))
        gathered = true
        try? await Task.sleep(for: .milliseconds(650))
        statusText = "하나씩, 제자리를 찾고 있어요"
        withAnimation(.easeInOut(duration: 0.55)) { introDone = true }
        try? await Task.sleep(for: .milliseconds(1300))
        statusText = "모두 제자리에 모였어요"
        try? await Task.sleep(for: .milliseconds(1000))
        statusText = nil
    }

    private func sendNotThis(_ card: Card) {
        Task {
            try? await APIClient.shared.sendFeedback(cardId: card.id, kind: .notThis)
            withAnimation(.spring(response: 0.4, dampingFraction: 0.9)) {
                selected = nil
                cards.removeAll { $0.id == card.id }
            }
        }
    }

    // MARK: push routing

    @MainActor
    private func openCard(id: String) async {
        defer { router.pendingCardId = nil }
        guard let card = try? await APIClient.shared.fetchCard(id: id) else { return }
        withAnimation(.spring(response: 0.42, dampingFraction: 0.86)) { selected = card }
    }

    // MARK: in-app picker import

    @MainActor
    private func importPicked(_ items: [PhotosPickerItem]) async {
        importing = true
        var captureIds: [String] = []
        for (index, item) in items.enumerated() {
            statusText = "\(index + 1)/\(items.count) 저장 중"
            guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
            // On-device OCR: only text and a thumbnail reach the server.
            let ocrText = (try? await ScreenshotOCR.recognizeText(
                in: data, maxPixelSize: Self.ocrMaxPixelSize
            )) ?? ""
            if let created = try? await APIClient.shared.uploadCapture(
                imageData: data, ocrText: ocrText, sourceHint: "picker"
            ) {
                captureIds.append(created.captureId)
            }
        }
        pickerItems = []
        statusText = "링크를 찾는 중"
        await waitForResolution(captureIds)
        await load()
        statusText = "\(captureIds.count)/\(items.count)개 저장했어요"
        try? await Task.sleep(for: .milliseconds(1400))
        statusText = nil
        importing = false
    }

    /// Cards appear only once the server pipeline resolves a capture; wait
    /// briefly so the refresh after an import actually shows the new cards.
    private func waitForResolution(_ captureIds: [String]) async {
        var pending = Set(captureIds)
        for _ in 0..<Self.resolvePollAttempts where !pending.isEmpty {
            try? await Task.sleep(for: .seconds(1))
            for id in pending {
                if let state = try? await APIClient.shared.fetchCapture(id: id), state.status != .processing {
                    pending.remove(id)
                }
            }
        }
    }
}

/// One 3:4 thumbnail card in the grid, with a link badge like the prototype.
struct ShotCell: View {
    let card: Card
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Color.inkElevated
                .aspectRatio(3.0 / 4.0, contentMode: .fit)
                .overlay {
                    AsyncImage(url: APIClient.captureImageURL(captureId: card.captureId)) { phase in
                        switch phase {
                        case .success(let image):
                            image.resizable().scaledToFill()
                        case .failure:
                            Image(systemName: "photo")
                                .foregroundStyle(Color.inkMuted)
                        default:
                            ProgressView().tint(Color.inkMuted)
                        }
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(alignment: .bottomTrailing) {
                    if hasLink {
                        Image(systemName: "link")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(.white)
                            .frame(width: 22, height: 22)
                            .background(
                                Circle()
                                    .fill(Color(hex: 0x1D2127).opacity(0.72))
                                    .overlay(Circle().stroke(Color.white.opacity(0.13)))
                            )
                            .padding(6)
                    }
                }
        }
        .buttonStyle(.plain)
    }

    private var hasLink: Bool {
        card.shopping?.link != nil || card.place?.naverPlaceUrl != nil
    }
}
