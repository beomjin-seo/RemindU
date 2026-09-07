from urllib.parse import urlencode

from app.pipeline.extraction import CaptureExtraction
from app.pipeline.search.base import PlaceResult, SearchResult

SHOPPING_EXTRACTION = CaptureExtraction(
    kind="shopping",
    visible_domain="nike.com",
    product_name="Nike Air Max 97",
    brand="Nike",
    price=129000,
    currency="KRW",
)

PLACE_EXTRACTION = CaptureExtraction(
    kind="place",
    place_name="London Bagel Museum",
    area_hint="Anguk",
)

GENERIC_EXTRACTION = CaptureExtraction(
    kind="generic",
    ocr_text="Random screenshot text\nmore lines",
    summary="A random note",
)

CANDIDATE_URL = "https://store.example.com/products/airmax97"


def upload_and_resolve(client, png_upload):
    response = client.post("/v1/captures", files=png_upload, data={"source_hint": "share-ext"})
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "processing"
    capture_id = body["capture_id"]

    # TestClient runs BackgroundTasks before returning, so one poll suffices.
    status = client.get(f"/v1/captures/{capture_id}").json()
    assert status["status"] == "resolved", status
    assert status["card_id"]
    return client.get(f"/v1/cards/{status['card_id']}").json()


def test_shopping_pipeline_verified_link(make_client, png_upload):
    client = make_client(
        SHOPPING_EXTRACTION,
        search_results=[SearchResult(url=CANDIDATE_URL, title="Nike Air Max 97", price=129000)],
        pages={CANDIDATE_URL: "<html>Buy Nike Air Max 97 today for 129,000 won</html>"},
    )
    card = upload_and_resolve(client, png_upload)

    assert card["type"] == "shopping"
    assert card["place"] is None and card["generic"] is None
    shopping = card["shopping"]
    assert shopping["product_name"] == "Nike Air Max 97"
    assert shopping["confidence"] == "high"
    link = shopping["link"]
    assert link["verified"] is True
    assert link["kind"] == "product"
    assert link["url"] == CANDIDATE_URL
    assert link["domain"] == "store.example.com"


def test_shopping_pipeline_fallback_when_page_does_not_match(make_client, png_upload):
    client = make_client(
        SHOPPING_EXTRACTION,
        search_results=[SearchResult(url=CANDIDATE_URL, title="Nike Air Max 97")],
        pages={CANDIDATE_URL: "<html>Something else entirely, no match here</html>"},
    )
    card = upload_and_resolve(client, png_upload)

    link = card["shopping"]["link"]
    assert link["verified"] is False
    assert link["kind"] == "search_results"
    expected = "https://search.naver.com/search.naver?" + urlencode(
        {"query": "Nike Air Max 97"}
    )
    assert link["url"] == expected
    assert link["domain"] == "search.naver.com"


def test_shopping_pipeline_fallback_when_fetch_fails(make_client, png_upload):
    # Invariant 2, fetch-failure branch: pages={} makes fake_fetch raise for
    # the candidate URL, so verification must fail closed into the
    # deterministic search-results fallback.
    client = make_client(
        SHOPPING_EXTRACTION,
        search_results=[SearchResult(url=CANDIDATE_URL, title="Nike Air Max 97")],
        pages={},
    )
    card = upload_and_resolve(client, png_upload)

    link = card["shopping"]["link"]
    assert link["verified"] is False
    assert link["kind"] == "search_results"
    expected = "https://search.naver.com/search.naver?" + urlencode(
        {"query": "Nike Air Max 97"}
    )
    assert link["url"] == expected
    assert link["domain"] == "search.naver.com"


def test_shopping_retailer_candidate_verified_first(make_client, png_upload):
    # Screenshot shows Coupang -> the coupang.com candidate is verified before
    # an earlier-listed candidate from another mall, so the card links to the
    # store the user was actually shopping at.
    extraction = SHOPPING_EXTRACTION.model_copy(update={"visible_domain": "m.coupang.com"})
    other_url = "https://other-mall.example.com/p/1"
    coupang_url = "https://www.coupang.com/vp/products/123"
    client = make_client(
        extraction,
        search_results=[
            SearchResult(url=other_url, title="Nike Air Max 97"),
            SearchResult(url=coupang_url, title="Nike Air Max 97"),
        ],
        pages={
            other_url: "<html>Buy Nike Air Max 97 for 129,000 won</html>",
            coupang_url: "<html>Nike Air Max 97 129,000 free shipping</html>",
        },
    )
    card = upload_and_resolve(client, png_upload)

    link = card["shopping"]["link"]
    assert link["verified"] is True
    assert link["kind"] == "product"
    assert link["url"] == coupang_url


def test_shopping_retailer_fallback_targets_retailer_search(make_client, png_upload):
    # Screenshot shows Musinsa but nothing verifies -> fallback is Musinsa's
    # own search page, not generic Naver search.
    extraction = SHOPPING_EXTRACTION.model_copy(update={"visible_domain": "www.musinsa.com"})
    client = make_client(extraction, search_results=[], pages={})
    card = upload_and_resolve(client, png_upload)

    link = card["shopping"]["link"]
    assert link["verified"] is False
    assert link["kind"] == "search_results"
    expected = "https://www.musinsa.com/search/goods?" + urlencode({"keyword": "Nike Air Max 97"})
    assert link["url"] == expected
    assert link["domain"] == "www.musinsa.com"


def test_shopping_store_name_ranks_matching_mall_first(make_client, png_upload):
    # No known retailer domain, but the screenshot showed the seller name ->
    # the candidate whose mall name (snippet) matches is verified first.
    extraction = SHOPPING_EXTRACTION.model_copy(update={"store_name": "나이키공식스토어"})
    generic_url = "https://random-mall.example.com/p/9"
    official_url = "https://official.example.com/airmax97"
    client = make_client(
        extraction,
        search_results=[
            SearchResult(url=generic_url, title="Nike Air Max 97", snippet="어떤몰"),
            SearchResult(url=official_url, title="Nike Air Max 97", snippet="나이키공식스토어"),
        ],
        pages={
            generic_url: "<html>Nike Air Max 97 129,000</html>",
            official_url: "<html>Nike Air Max 97 129,000</html>",
        },
    )
    card = upload_and_resolve(client, png_upload)

    assert card["shopping"]["link"]["url"] == official_url


def test_capture_upload_rejects_unsupported_content_type(make_client):
    client = make_client(GENERIC_EXTRACTION)
    response = client.post(
        "/v1/captures",
        files={"image": ("capture.heic", b"not-really-heic", "image/heic")},
    )
    assert response.status_code == 415


def test_place_pipeline(make_client, png_upload):
    client = make_client(
        PLACE_EXTRACTION,
        place_results=[
            PlaceResult(
                name="London Bagel Museum Anguk",
                url="https://map.naver.com/p/entry/place/12345",
                category="Bakery",
                address="Seoul Jongno-gu",
                lat=37.5776,
                lng=126.9852,
            )
        ],
    )
    card = upload_and_resolve(client, png_upload)

    assert card["type"] == "place"
    place = card["place"]
    assert place["name"] == "London Bagel Museum Anguk"
    assert place["lat"] == 37.5776
    assert place["lng"] == 126.9852
    assert place["naver_place_url"] == "https://map.naver.com/p/entry/place/12345"


def test_feedback_persisted(make_client, png_upload):
    client = make_client(GENERIC_EXTRACTION)
    card = upload_and_resolve(client, png_upload)

    response = client.post(f"/v1/cards/{card['id']}/feedback", json={"kind": "not_this"})
    assert response.status_code == 204

    from app.models import Feedback

    session_factory = client.app.state.session_factory
    with session_factory() as session:
        rows = session.query(Feedback).filter_by(card_id=card["id"]).all()
    assert len(rows) == 1
    assert rows[0].kind == "not_this"


def test_cards_listing_and_filter(make_client, png_upload):
    client = make_client(GENERIC_EXTRACTION)
    upload_and_resolve(client, png_upload)

    body = client.get("/v1/cards", params={"type": "generic", "limit": 10}).json()
    assert len(body["cards"]) == 1
    assert body["next_cursor"] is None
    assert client.get("/v1/cards", params={"type": "shopping"}).json()["cards"] == []


def test_device_registration(make_client):
    client = make_client(GENERIC_EXTRACTION)
    response = client.post("/v1/devices", json={"apns_token": "abc123"})
    assert response.status_code == 204
    # Idempotent for the same token.
    assert client.post("/v1/devices", json={"apns_token": "abc123"}).status_code == 204


def test_healthz(make_client):
    client = make_client(GENERIC_EXTRACTION)
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_capture_image_served(make_client, png_upload):
    client = make_client(GENERIC_EXTRACTION)
    card = upload_and_resolve(client, png_upload)

    response = client.get(f"/v1/captures/{card['capture_id']}/image")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.content[:8] == b"\x89PNG\r\n\x1a\n"
