import SwiftUI

/// Detail overlay matching the dark concept: preview art, confidence + capture
/// time, title/description, source row, and a primary "open source" action.
struct CardDetailView: View {
    let card: Card
    var onClose: () -> Void
    var onNotThis: () -> Void

    @State private var safariItem: SafariItem?
    @State private var pendingLink: PendingLink?

    private struct SafariItem: Identifiable {
        let id = UUID()
        let url: URL
    }

    // Link preview shown before anything opens (CLAUDE.md link-safety rule):
    // the user always sees where a tap will take them, Instagram-style.
    private struct PendingLink {
        let url: URL
        let domain: String
        let trusted: Bool
        let kindLabel: String
    }

    var body: some View {
        ZStack(alignment: .top) {
            Color.inkSurface.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    preview
                        .padding(.horizontal, 22)
                        .padding(.top, 65)
                    info
                        .padding(25)
                        .padding(.bottom, 110)
                }
            }

            navBar
            footer

            if let pending = pendingLink {
                linkConfirmOverlay(pending)
            }
        }
        .sheet(item: $safariItem) { item in
            SafariView(url: item.url).ignoresSafeArea()
        }
        // Edge swipe back, like a pushed screen; vertical scrolling is untouched.
        .simultaneousGesture(
            DragGesture(minimumDistance: 24)
                .onEnded { value in
                    guard pendingLink == nil, value.startLocation.x < 40,
                          value.translation.width > 90, abs(value.translation.height) < 80
                    else { return }
                    onClose()
                }
        )
    }

    // MARK: chrome

    private var navBar: some View {
        HStack {
            Button(action: onClose) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color.inkText)
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(Color.inkControl))
            }
            Spacer()
            Text("스크린샷")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Color(hex: 0xD9D9DF))
            Spacer()
            Color.clear.frame(width: 44, height: 44)
        }
        .padding(.horizontal, 18)
        .padding(.top, 6)
        .background(
            Color.inkSurface.opacity(0.85)
                .background(.ultraThinMaterial)
                .ignoresSafeArea(edges: .top)
        )
        .frame(maxHeight: 57, alignment: .center)
    }

    @ViewBuilder
    private var footer: some View {
        if let url = primaryURL {
            VStack {
                Spacer()
                Button {
                    withAnimation(.spring(response: 0.35, dampingFraction: 0.9)) {
                        pendingLink = PendingLink(
                            url: url,
                            domain: url.host ?? "",
                            trusted: linkTrusted,
                            kindLabel: sourceSubtitle
                        )
                    }
                } label: {
                    HStack(spacing: 9) {
                        Text(primaryTitle)
                            .font(.system(size: 15, weight: .semibold))
                        Image(systemName: "arrow.up.right")
                            .font(.system(size: 13, weight: .semibold))
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 55)
                    .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.inkAccent))
                }
                .padding(.horizontal, 22)
                .padding(.bottom, 12)
                .background(
                    LinearGradient(
                        colors: [Color.inkSurface.opacity(0), Color.inkSurface],
                        startPoint: .top,
                        endPoint: UnitPoint(x: 0.5, y: 0.35)
                    )
                    .ignoresSafeArea(edges: .bottom)
                )
            }
        }
    }

    // MARK: content

    private var preview: some View {
        RoundedRectangle(cornerRadius: 20, style: .continuous)
            .fill(Color.inkElevated)
            .frame(height: 330)
            .overlay {
                Color.clear
                    .aspectRatio(3.0 / 4.0, contentMode: .fit)
                    .frame(height: 300)
                    .overlay {
                        RemoteImage(url: APIClient.captureImageURL(captureId: card.captureId))
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                    .shadow(color: .black.opacity(0.25), radius: 11, y: 8)
            }
    }

    private var info: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center) {
                metaPill
                Spacer()
                Text(card.createdAt.formatted(
                    Date.FormatStyle(date: .abbreviated, time: .shortened)
                        .locale(Locale(identifier: "ko_KR"))
                ))
                .font(.system(size: 13))
                .monospacedDigit()
                .foregroundStyle(Color.inkText)
            }

            Text(card.title)
                .font(.system(size: 22, weight: .semibold))
                .tracking(-0.5)
                .foregroundStyle(Color.inkText)
                .padding(.top, 11)

            if let description {
                Text(description)
                    .font(.system(size: 13))
                    .lineSpacing(3)
                    .foregroundStyle(Color(hex: 0x9999A3))
                    .padding(.top, 8)
            }

            sourceRow
                .padding(.top, 22)

            candidatesSection

            notThisButton
                .padding(.top, 18)
        }
    }

    // MARK: candidate links

    /// Shown only when no candidate verified: a verified link is the one
    /// answer and alternatives would just dilute it. Rows never open
    /// directly: every tap goes through the same link-confirm overlay.
    private var extraCandidates: [ShoppingCandidate] {
        guard let shopping = card.shopping, !shopping.link.verified else { return [] }
        return Array(shopping.candidates.filter { $0.url != shopping.link.url }.prefix(3))
    }

    @ViewBuilder
    private var candidatesSection: some View {
        if !extraCandidates.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                Text("비슷한 상품")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Color(hex: 0x90909A))
                    .padding(.top, 22)
                    .padding(.bottom, 4)
                ForEach(Array(extraCandidates.enumerated()), id: \.element.url) { index, candidate in
                    candidateRow(rank: index + 1, candidate: candidate)
                }
            }
        }
    }

    private func candidateRow(rank: Int, candidate: ShoppingCandidate) -> some View {
        Button {
            guard let url = URL(string: candidate.url) else { return }
            withAnimation(.spring(response: 0.35, dampingFraction: 0.9)) {
                pendingLink = PendingLink(
                    url: url,
                    domain: candidate.domain,
                    trusted: candidate.trusted,
                    kindLabel: candidate.verified ? "검증된 상품 링크" : "검증되지 않은 후보 링크"
                )
            }
        } label: {
            HStack(spacing: 11) {
                Text("\(rank)")
                    .font(.system(size: 13, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(Color(hex: 0xA6A6B0))
                    .frame(width: 35, height: 35)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color(hex: 0x252529)))
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 4) {
                        Text(candidate.title.isEmpty ? candidate.domain : candidate.title)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Color.inkText)
                            .lineLimit(1)
                        if candidate.trusted {
                            TrustedSeal(size: 12)
                        }
                    }
                    HStack(spacing: 6) {
                        Text(candidate.domain)
                            .font(.system(size: 10))
                            .foregroundStyle(Color(hex: 0x90909A))
                        if candidate.verified {
                            Text("검증됨")
                                .font(.system(size: 10, weight: .medium))
                                .foregroundStyle(Color.confidenceHigh)
                        }
                    }
                }
                Spacer()
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color(hex: 0x8C8D98))
            }
            .padding(.vertical, 9)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var metaPill: some View {
        if let shopping = card.shopping {
            pill(color: shopping.linkAccuracy.color, label: "링크 정확도", value: shopping.linkAccuracy.displayName)
        } else if card.place != nil {
            pill(color: Color(hex: 0x7AADFF), label: "장소", value: "지도에 저장됨")
        } else {
            pill(color: Color.inkMuted, label: "메모", value: "텍스트 저장")
        }
    }

    private func pill(color: Color, label: String, value: String) -> some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 5, height: 5)
            Text(label)
                .font(.system(size: 11, weight: .medium))
            Text(value)
                .font(.system(size: 12, weight: .bold))
        }
        .foregroundStyle(color)
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(RoundedRectangle(cornerRadius: 7, style: .continuous).fill(color.opacity(0.1)))
    }

    private var sourceRow: some View {
        VStack(alignment: .leading, spacing: 0) {
            Rectangle()
                .fill(Color.white.opacity(0.09))
                .frame(height: 1)
            HStack(spacing: 11) {
                Image(systemName: sourceIcon)
                    .font(.system(size: 16))
                    .foregroundStyle(Color(hex: 0xA6A6B0))
                    .frame(width: 35, height: 35)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color(hex: 0x252529)))
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 4) {
                        Text(sourceTitle)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Color.inkText)
                        if linkTrusted {
                            TrustedSeal(size: 12)
                        }
                    }
                    Text(sourceSubtitle)
                        .font(.system(size: 10))
                        .foregroundStyle(Color(hex: 0x90909A))
                }
                Spacer()
                if isVerified {
                    Image(systemName: "checkmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color(hex: 0x8C8D98))
                }
            }
            .padding(.top, 17)
        }
    }

    private var notThisButton: some View {
        Button {
            onNotThis()
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "hand.thumbsdown")
                    .font(.system(size: 11))
                Text("이 결과가 아니에요")
                    .font(.system(size: 12))
            }
            .foregroundStyle(Color.inkMuted)
        }
        .buttonStyle(.plain)
    }

    // MARK: derived content

    private var description: String? {
        if let shopping = card.shopping {
            var parts: [String] = []
            if let brand = shopping.brand { parts.append(brand) }
            if let price = shopping.price { parts.append("\(price.formatted()) \(shopping.currency)") }
            if let deadline = shopping.deadlineText { parts.append(deadline) }
            return parts.isEmpty ? nil : parts.joined(separator: " · ")
        }
        if let place = card.place {
            let parts = [place.category, place.address].compactMap { $0 }
            return parts.isEmpty ? nil : parts.joined(separator: " · ")
        }
        if let generic = card.generic {
            return generic.summary ?? generic.ocrText.components(separatedBy: "\n").first
        }
        return nil
    }

    private var sourceIcon: String {
        switch card.type {
        case .shopping: return "globe"
        case .place: return "mappin.and.ellipse"
        case .generic: return "doc.text"
        }
    }

    private var sourceTitle: String {
        if let link = card.shopping?.link { return link.domain }
        if card.place != nil { return "네이버 지도" }
        return "저장된 텍스트"
    }

    private var sourceSubtitle: String {
        if let link = card.shopping?.link {
            return link.verified ? "검증된 상품 링크" : "검색 결과 링크"
        }
        if let place = card.place { return place.name }
        return "OCR 추출"
    }

    private var isVerified: Bool {
        card.shopping?.link.verified == true
    }

    private var linkTrusted: Bool {
        if let link = card.shopping?.link { return link.trusted }
        // Place links are always Naver Maps URLs we construct server-side;
        // the trusted flag for them is derivable from the host alone.
        if let raw = card.place?.naverPlaceUrl, let host = URL(string: raw)?.host {
            return host == "naver.com" || host.hasSuffix(".naver.com")
        }
        return false
    }

    // MARK: link confirmation overlay

    private func linkConfirmOverlay(_ pending: PendingLink) -> some View {
        ZStack(alignment: .bottom) {
            Color.black.opacity(0.55)
                .ignoresSafeArea()
                .onTapGesture {
                    withAnimation(.easeOut(duration: 0.2)) { pendingLink = nil }
                }
            VStack(spacing: 0) {
                Capsule()
                    .fill(Color.white.opacity(0.18))
                    .frame(width: 36, height: 4)
                    .padding(.top, 10)

                Image(systemName: "globe")
                    .font(.system(size: 21))
                    .foregroundStyle(Color(hex: 0xA6A6B0))
                    .frame(width: 48, height: 48)
                    .background(RoundedRectangle(cornerRadius: 13, style: .continuous).fill(Color(hex: 0x252529)))
                    .padding(.top, 18)

                HStack(spacing: 5) {
                    Text(pending.domain)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Color.inkText)
                    if pending.trusted {
                        TrustedSeal(size: 15)
                    }
                }
                .padding(.top, 12)

                Text(pending.trusted ? "인증된 판매처예요 · \(pending.kindLabel)" : pending.kindLabel)
                    .font(.system(size: 12))
                    .foregroundStyle(pending.trusted ? Color(hex: 0x6FA8FF) : Color.inkMuted)
                    .padding(.top, 4)

                Text(pending.url.absoluteString)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(Color.inkMuted)
                    .lineLimit(3)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
                    .padding(.top, 12)

                Button {
                    let url = pending.url
                    pendingLink = nil
                    safariItem = SafariItem(url: url)
                } label: {
                    Text("링크 열기")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: 52)
                        .background(RoundedRectangle(cornerRadius: 15, style: .continuous).fill(Color.inkAccent))
                }
                .padding(.horizontal, 20)
                .padding(.top, 20)

                Button {
                    withAnimation(.easeOut(duration: 0.2)) { pendingLink = nil }
                } label: {
                    Text("취소")
                        .font(.system(size: 14))
                        .foregroundStyle(Color.inkMuted)
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .padding(.top, 4)
                .padding(.bottom, 20)
            }
            .background(
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .fill(Color.inkElevated)
                    .overlay(
                        RoundedRectangle(cornerRadius: 24, style: .continuous)
                            .stroke(Color.white.opacity(0.08))
                    )
            )
            .padding(.horizontal, 10)
            .padding(.bottom, 8)
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
        .zIndex(30)
    }

    private var primaryURL: URL? {
        if let link = card.shopping?.link { return URL(string: link.url) }
        if let raw = card.place?.naverPlaceUrl { return URL(string: raw) }
        return nil
    }

    private var primaryTitle: String {
        switch card.type {
        case .shopping: return isVerified ? "원본 페이지 열기" : "검색 결과 보기"
        case .place: return "네이버 지도에서 열기"
        case .generic: return "열기"
        }
    }
}

/// Verified-style safety badge for well-known retailer/portal domains.
struct TrustedSeal: View {
    let size: CGFloat

    var body: some View {
        Image(systemName: "checkmark.seal.fill")
            .font(.system(size: size))
            .foregroundStyle(Color(hex: 0x4C8DFF))
            .accessibilityLabel("인증된 도메인")
    }
}
