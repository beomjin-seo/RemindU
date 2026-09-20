"""Rule-based structuring of on-device OCR text.

Zero-cost, no-network extraction tier used when no LLM credentials are
configured (and as the fallback when the LLM path fails). Same privacy
contract as TextExtractor: consumes OCR lines only, never pixels, and
never produces URLs — visible_domain is domain text copied from the OCR.
Lower recall than the LLM path by design; when unsure it leaves fields None
so downstream verification fails closed rather than guessing.
"""

import re

from app.pipeline.extraction import CaptureExtraction, ExtractionError, usable_ocr_text

_TLDS = r"(?:com|net|org|shop|store|kr|co\.kr|ne\.kr|or\.kr|io|me|app|xyz|jp)"
_DOMAIN_RE = re.compile(
    rf"(?<![\w@])((?:[a-z0-9-]+\.)+{_TLDS})(?![\w.])", re.IGNORECASE
)
_PRICE_RE = re.compile(r"(?:₩|\$)?\s*(\d{1,3}(?:,\d{3})+|\d{4,7})\s*(원|₩|\$|KRW|USD)?")
_PERCENT_RE = re.compile(r"^\s*\d{1,3}(?:\.\d+)?\s*%\s*$")
_RATING_RE = re.compile(r"[☆★]\s*\d|리뷰|평점")
_TIME_RE = re.compile(r"^\s*\d{1,2}:\d{2}\s*\d?\s*$")

_UI_WORDS = (
    "구매하기", "장바구니", "선물하기", "무료배송", "상담하기", "바로구매", "찜",
    "더 알아보기", "팔로우", "게시물", "좋아요", "댓글", "저장", "공유", "언어변경",
    "한국어", "영어", "cart", "buy it now", "add to wish", "add item", "sale-", "shop mens",
    "shop womens", "free shipping", "방문", "저작권", "자세히 알아보기", "쿠폰",
    "카카오톡 채널", "카카오 플러스", "이상 구매시", "브랜드:", "예약배송", "hot", "best",
    "event", "전 시리즈", "네이버", "전체 1위",
)
_INSTAGRAM_MARKERS = ("팔로우", "게시물", "좋아요")
# Deadline cues need a date/count or a hard word; a bare "까지" inside a noun
# list ("투명케이스까지") is not a deadline.
_DEADLINE_RE = re.compile(
    r"(\d+\s*일\s*까지|\d+\s*월\s*\d+\s*일|\d{1,2}[./]\d{1,2}\s*까지|오늘\s*까지|마감|D-\d|공구|특가|딱\s*\d+\s*일|(?<!\S)sale(?!\S))",
    re.IGNORECASE,
)
# Prices in these lines are promotions, not the product price.
_COUPON_RE = re.compile(r"(추가\s*할인|쿠폰|이상\s*구매|적립|배송비)")
_CATEGORY_NAV_RE = re.compile(r"^(?:\S{1,2}\s+){2,}\S{1,2}$")
_HANGUL_RE = re.compile(r"[가-힣]")
_PLACE_RE = re.compile(r"(영업시간|주차|예약|맛집|카페|서울|부산|대구|인천|광주|대전|\S+구\s\S+로|\S+동\s\d)")
_SHOPPING_CUE_RE = re.compile(r"(구매|장바구니|배송|쿠폰|할인|원$|₩|cart|buy)", re.IGNORECASE)


def _clean_lines(ocr_text: str) -> list[str]:
    lines = []
    for raw in ocr_text.splitlines():
        line = raw.strip(" \t•·-|>=<*#")
        line = re.sub(r"\s+", " ", line)
        if len(line) < 2 or _TIME_RE.match(line):
            continue
        lines.append(line)
    return lines


def _find_domain(lines: list[str]) -> str | None:
    for line in lines[:12]:
        match = _DOMAIN_RE.search(line)
        if match:
            return match.group(1).lower()
    return None


def _prices_in(line: str) -> list[int]:
    values = []
    for match in _PRICE_RE.finditer(line):
        try:
            value = int(match.group(1).replace(",", ""))
        except ValueError:
            continue
        # Require a currency marker or a thousands separator: bare "2026" is a year.
        if match.group(2) or "," in match.group(1) or match.group(0).lstrip().startswith(("₩", "$")):
            if 100 <= value <= 50_000_000:
                values.append(value)
    return values


def _is_ui_noise(line: str) -> bool:
    lowered = line.lower()
    if any(word in lowered for word in _UI_WORDS):
        return True
    if _PERCENT_RE.match(line) or _RATING_RE.search(line) or _CATEGORY_NAV_RE.match(line):
        return True
    if _DOMAIN_RE.search(line) and len(line) < 40:
        return True
    if re.match(r"^\d+\s", line):
        return True
    letters = sum(ch.isalpha() for ch in line)
    return letters < 3


def _is_brand_line(line: str) -> bool:
    return 2 <= len(line) <= 20 and line.isupper() and line.replace(" ", "").isalpha()


def _title_like(line: str) -> bool:
    if _is_ui_noise(line) or _prices_in(line) or _is_brand_line(line):
        return False
    if _DEADLINE_RE.search(line):
        return False
    return 4 <= len(line) <= 70


def _pick_price(lines: list[str]) -> tuple[int | None, str | None, int | None]:
    """Return (price, currency, index of the first price line)."""
    for index, line in enumerate(lines):
        if _COUPON_RE.search(line):
            continue
        values = _prices_in(line)
        if not values:
            continue
        group = list(values)
        # A sale price often sits on the next line by itself, e.g. "5% 52,530원" / "49,900원".
        if index + 1 < len(lines):
            next_values = _prices_in(lines[index + 1])
            if len(next_values) == 1:
                group.extend(next_values)
        currency = "USD" if ("$" in line or "USD" in line) else "KRW"
        return min(group), currency, index
    return None, None, None


def _pick_title(lines: list[str], price_index: int | None) -> str | None:
    if price_index is not None:
        parts: list[str] = []
        for line in reversed(lines[max(0, price_index - 4) : price_index]):
            if _title_like(line):
                parts.insert(0, line)
                if len(parts) == 3:
                    break
            elif parts:
                break
        if parts:
            return " ".join(parts)[:120]
    # No price anchor: prefer the line a promo/deadline cue follows, else the longest.
    best, best_score = None, -1
    for index, line in enumerate(lines):
        if not _title_like(line):
            continue
        score = len(line)
        if index + 1 < len(lines) and (_DEADLINE_RE.search(lines[index + 1]) or _prices_in(lines[index + 1])):
            score += 40
        if score > best_score:
            best, best_score = line, score
    return best[:120] if best else None


def _pick_brand(lines: list[str], domain: str | None) -> str | None:
    for line in lines:
        match = re.match(r"브랜드\s*[:：]\s*(\S.*)", line)
        if match:
            return match.group(1).strip()
    for line in lines[:20]:
        if _is_brand_line(line) and not _is_ui_noise(line):
            return line.title()
    if domain:
        parts = domain.split(".")
        core = [p for p in parts if p not in ("www", "m", "kr", "co", "com", "net", "shop", "store")]
        if core:
            return core[0]
    return None


def _instagram_handle(lines: list[str]) -> str | None:
    if not any(marker in line for line in lines[:8] for marker in _INSTAGRAM_MARKERS):
        return None
    for line in lines[:10]:
        token = line.replace(" ", "")
        if re.fullmatch(r"[a-z0-9_.]{3,30}", token) and ("." in token or "_" in token):
            return token
    return None


def _caption_title(lines: list[str], handle: str) -> str | None:
    """Instagram: the first caption line after the handle is the subject."""
    seen_handle = False
    fallback = None
    for line in lines:
        if line.replace(" ", "") == handle:
            seen_handle = True
            continue
        if seen_handle and _title_like(line) and len(line) >= 6:
            if _HANGUL_RE.search(line):
                return line[:120]
            fallback = fallback or line[:120]
    return fallback


def _deadline(lines: list[str]) -> str | None:
    """Prefer lines carrying a date or day count over bare promo words."""
    best, best_score = None, 0
    for line in lines:
        if len(line) > 40 or _is_ui_noise(line) or not _DEADLINE_RE.search(line):
            continue
        score = 2 if re.search(r"(\d+\s*일|까지|마감|D-\d|\d+\s*월)", line) else 1
        if score > best_score:
            best, best_score = line, score
    return best


class HeuristicExtractor:
    def extract(
        self,
        image_bytes: bytes,
        media_type: str,
        source_hint: str | None = None,
        ocr_text: str | None = None,
    ) -> CaptureExtraction:
        if not usable_ocr_text(ocr_text):
            raise ExtractionError("no_text")
        lines = _clean_lines(ocr_text or "")
        domain = _find_domain(lines)
        price, currency, price_index = _pick_price(lines)
        handle = _instagram_handle(lines)
        title = (_caption_title(lines, handle) if handle else None) or _pick_title(lines, price_index)
        joined = "\n".join(lines)
        has_brand_label = any(re.match(r"브랜드\s*[:：]", line) for line in lines)

        is_shopping = price is not None or handle is not None or has_brand_label or (
            domain is not None and _SHOPPING_CUE_RE.search(joined) is not None
        )
        if is_shopping and title:
            return CaptureExtraction(
                kind="shopping",
                visible_domain=domain,
                product_name=title,
                brand=handle or _pick_brand(lines, domain),
                store_name=handle or (domain.split(".")[-2] if domain and domain.count(".") >= 1 else None),
                price=price,
                currency=currency or ("KRW" if price else None),
                deadline_text=_deadline(lines),
                ocr_text=joined,
            )
        if _PLACE_RE.search(joined) and title:
            return CaptureExtraction(kind="place", place_name=title, ocr_text=joined)
        return CaptureExtraction(kind="generic", ocr_text=joined, summary=title)
