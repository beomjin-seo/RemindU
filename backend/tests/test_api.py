from urllib.parse import urlencode

from app.pipeline.extraction import CaptureExtraction, FakeExtractor, RoutingExtractor
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

# Allowlisted domain: only those can become a verified product link.
CANDIDATE_URL = "https://kream.co.kr/products/airmax97"
MATCHING_PAGE = "<html>Nike Air Max 97 129,000원</html>"

OCR_TEXT = "www.musinsa.com\nNike Air Max 97\n129,000원\n세일 마감 D-3"


def upload(client, png_upload, ocr_text=None):
    data = {"source_hint": "share-ext"}
    if ocr_text is not None:
        data["ocr_text"] = ocr_text
    response = client.post("/v1/captures", files=png_upload, data=data)
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "processing"

    # TestClient runs BackgroundTasks before returning, so one poll suffices.
    return client.get(f"/v1/captures/{body['capture_id']}").json()


def upload_and_resolve(client, png_upload, ocr_text=None):
    status = upload(client, png_upload, ocr_text)
    assert status["status"] == "resolved", status
    assert status["card_id"]
    assert status["failure_reason"] is None
    return client.get(f"/v1/cards/{status['card_id']}").json()


def test_upload_with_ocr_text_uses_text_extractor(make_client, png_upload):
    # Contract A + privacy invariant: usable OCR text routes to the text-only
    # extractor; the image extractor is never touched.
    text_fake = FakeExtractor(SHOPPING_EXTRACTION)
    image_fake = FakeExtractor(GENERIC_EXTRACTION)
    client = make_client(
        SHOPPING_EXTRACTION,
        search_results=[SearchResult(url=CANDIDATE_URL, title="Nike Air Max 97")],
        pages={CANDIDATE_URL: MATCHING_PAGE},
        extractor=RoutingExtractor(text_fake, image_fake, allow_image=False),
    )
    card = upload_and_resolve(client, png_upload, ocr_text=OCR_TEXT)

    assert card["type"] == "shopping"
    assert card["shopping"]["link"]["verified"] is True
    assert [call["ocr_text"] for call in text_fake.calls] == [OCR_TEXT]
    assert text_fake.calls[0]["source_hint"] == "share-ext"
    assert image_fake.calls == []


def test_upload_without_ocr_text_fails_no_text_by_default(make_client, png_upload):
    # Contract D + privacy invariant: with image extraction disabled (default),
    # a capture without OCR text fails closed and no pixels reach any extractor.
    text_fake = FakeExtractor(SHOPPING_EXTRACTION)
    image_fake = FakeExtractor(SHOPPING_EXTRACTION)
    client = make_client(
        SHOPPING_EXTRACTION,
        extractor=RoutingExtractor(text_fake, image_fake, allow_image=False),
    )
    status = upload(client, png_upload)

    assert status["status"] == "failed"
    assert status["failure_reason"] == "no_text"
    assert status["card_id"] is None
    assert text_fake.calls == [] and image_fake.calls == []
    assert client.get("/v1/cards").json()["cards"] == []


def test_short_ocr_text_is_treated_as_no_text(make_client, png_upload):
    client = make_client(
        SHOPPING_EXTRACTION,
        extractor=RoutingExtractor(FakeExtractor(SHOPPING_EXTRACTION), None, allow_image=False),
    )
    status = upload(client, png_upload, ocr_text="ab  c\n")
    assert status["status"] == "failed"
    assert status["failure_reason"] == "no_text"


def test_upload_without_ocr_text_uses_image_when_allowed(make_client, png_upload):
    text_fake = FakeExtractor(SHOPPING_EXTRACTION)
    image_fake = FakeExtractor(GENERIC_EXTRACTION)
    client = make_client(
        GENERIC_EXTRACTION,
        extractor=RoutingExtractor(text_fake, image_fake, allow_image=True),
    )
    card = upload_and_resolve(client, png_upload)

    assert card["type"] == "generic"
    assert text_fake.calls == []
    assert len(image_fake.calls) == 1


def test_extractor_crash_sets_extraction_failed(make_client, png_upload):
    class BoomExtractor:
        def extract(self, image_bytes, media_type, source_hint=None, ocr_text=None):
            raise RuntimeError("api down")

    client = make_client(SHOPPING_EXTRACTION, extractor=BoomExtractor())
    status = upload(client, png_upload, ocr_text=OCR_TEXT)

    assert status["status"] == "failed"
    assert status["failure_reason"] == "extraction_failed"
    assert status["card_id"] is None


def test_shopping_candidates_top_three_with_per_candidate_verification(make_client, png_upload):
    # Contract B: verification is attempted on the top 3 ranked candidates in
    # order; link = first verified one; the rest stay listed with verified=false.
    urls = [
        "https://www.coupang.com/vp/products/0",
        "https://www.musinsa.com/p/1",
        "https://www.11st.co.kr/products/2",
        "https://www.ssg.com/item/3",
    ]
    client = make_client(
        SHOPPING_EXTRACTION,
        search_results=[SearchResult(url=url, title=f"Result {i}") for i, url in enumerate(urls)],
        pages={
            urls[0]: "<html>unrelated page</html>",
            urls[1]: MATCHING_PAGE,
            urls[2]: "<html>another unrelated page</html>",
            # urls[3] is never fetched: only the top 3 are verified.
        },
    )
    card = upload_and_resolve(client, png_upload)

    shopping = card["shopping"]
    assert shopping["link"]["url"] == urls[1]
    assert shopping["link"]["verified"] is True
    assert shopping["link"]["kind"] == "product"
    candidates = shopping["candidates"]
    assert [c["url"] for c in candidates] == urls[:3]
    assert [c["verified"] for c in candidates] == [False, True, False]
    assert all(c["kind"] == "product" and c["trusted"] is True for c in candidates)
    assert candidates[1]["title"] == "Result 1"
    assert candidates[1]["domain"] == "www.musinsa.com"


def test_off_allowlist_candidate_is_listed_but_never_verified(make_client, png_upload):
    # Link-safety gate: a matching page on an unknown domain stays an
    # unverified "similar result"; the card falls back to search results.
    unknown_url = "https://store.example.com/products/airmax97"
    client = make_client(
        SHOPPING_EXTRACTION,
        search_results=[SearchResult(url=unknown_url, title="Nike Air Max 97", price=129000)],
        pages={unknown_url: MATCHING_PAGE},
    )
    card = upload_and_resolve(client, png_upload)

    shopping = card["shopping"]
    assert shopping["link"]["kind"] == "search_results"
    assert shopping["link"]["verified"] is False
    assert [(c["url"], c["verified"], c["trusted"]) for c in shopping["candidates"]] == [
        (unknown_url, False, False)
    ]


def test_shopping_candidates_empty_when_search_returns_nothing(make_client, png_upload):
    client = make_client(SHOPPING_EXTRACTION, search_results=[], pages={})
    card = upload_and_resolve(client, png_upload)

    assert card["shopping"]["candidates"] == []
    assert card["shopping"]["link"]["kind"] == "search_results"


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
    assert link["domain"] == "kream.co.kr"
    assert link["trusted"] is True  # verified implies allowlisted


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
    other_url = "https://www.ssg.com/item/1"
    coupang_url = "https://www.coupang.com/vp/products/123"
    client = make_client(
        extraction,
        search_results=[
            SearchResult(url=other_url, title="Nike Air Max 97"),
            SearchResult(url=coupang_url, title="Nike Air Max 97"),
        ],
        pages={
            other_url: "<html>Buy Nike Air Max 97 for 129,000 won</html>",
            coupang_url: "<html>Nike Air Max 97 129,000원 free shipping</html>",
        },
    )
    card = upload_and_resolve(client, png_upload)

    link = card["shopping"]["link"]
    assert link["verified"] is True
    assert link["kind"] == "product"
    assert link["url"] == coupang_url
    assert link["trusted"] is True


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
    assert link["trusted"] is True


def test_shopping_store_name_ranks_matching_mall_first(make_client, png_upload):
    # No known retailer domain, but the screenshot showed the seller name ->
    # the candidate whose mall name (snippet) matches is verified first.
    extraction = SHOPPING_EXTRACTION.model_copy(update={"store_name": "나이키공식스토어"})
    generic_url = "https://www.11st.co.kr/products/9"
    official_url = "https://brand.naver.com/nike/products/1"
    client = make_client(
        extraction,
        search_results=[
            SearchResult(url=generic_url, title="Nike Air Max 97", snippet="어떤몰"),
            SearchResult(url=official_url, title="Nike Air Max 97", snippet="나이키공식스토어"),
        ],
        pages={generic_url: MATCHING_PAGE, official_url: MATCHING_PAGE},
    )
    card = upload_and_resolve(client, png_upload)

    assert card["shopping"]["link"]["url"] == official_url


def test_shopping_deadline_text_parsed_into_deadline_at(make_client, png_upload):
    from datetime import datetime, timedelta, timezone

    extraction = SHOPPING_EXTRACTION.model_copy(update={"deadline_text": "9월 12일 오후 6시까지"})
    client = make_client(extraction, search_results=[], pages={})
    card = upload_and_resolve(client, png_upload)

    deadline_at = datetime.fromisoformat(card["shopping"]["deadline_at"])
    assert (deadline_at.month, deadline_at.day, deadline_at.hour, deadline_at.minute) == (9, 12, 18, 0)
    assert deadline_at.utcoffset() == timedelta(hours=9)
    assert card["shopping"]["deadline_text"] == "9월 12일 오후 6시까지"

    # Relative text never schedules a deadline.
    vague = SHOPPING_EXTRACTION.model_copy(update={"deadline_text": "곧 마감"})
    client = make_client(vague, search_results=[], pages={})
    card = upload_and_resolve(client, png_upload)
    assert card["shopping"]["deadline_at"] is None


def test_resolved_push_sent_to_registered_devices(make_client, png_upload):
    client = make_client(SHOPPING_EXTRACTION, search_results=[], pages={})
    assert client.post("/v1/devices", json={"apns_token": "tok1"}).status_code == 204
    card = upload_and_resolve(client, png_upload)

    sender = client.app.state.push_sender
    assert [token for token, _ in sender.sent] == ["tok1"]
    payload = sender.sent[0][1]
    assert payload["kind"] == "resolved"
    assert payload["card_id"] == card["id"]
    # Search-results fallback: nothing was found, so the push says "saved".
    assert payload["aps"]["alert"]["title"] == "저장했어요: Nike Air Max 97"
    assert payload["aps"]["sound"] == "default"


def test_resolved_push_says_found_only_for_verified_links(make_client, png_upload):
    client = make_client(
        SHOPPING_EXTRACTION,
        search_results=[SearchResult(url=CANDIDATE_URL, title="Nike Air Max 97")],
        pages={CANDIDATE_URL: MATCHING_PAGE},
    )
    client.post("/v1/devices", json={"apns_token": "tok1"})
    upload_and_resolve(client, png_upload)
    payload = client.app.state.push_sender.sent[0][1]
    assert payload["aps"]["alert"]["title"] == "찾았어요: Nike Air Max 97"


def test_resolved_push_targets_only_the_owning_install(make_client, png_upload):
    client = make_client(SHOPPING_EXTRACTION, search_results=[], pages={})
    client.post("/v1/devices", json={"apns_token": "tok-a"})
    client.headers["X-Install-Id"] = "install-b"
    client.post("/v1/devices", json={"apns_token": "tok-b"})
    upload_and_resolve(client, png_upload)

    assert [token for token, _ in client.app.state.push_sender.sent] == ["tok-b"]


def test_resolved_push_disabled_by_setting(make_client, png_upload):
    client = make_client(SHOPPING_EXTRACTION, search_results=[], pages={}, push_on_resolved=False)
    client.post("/v1/devices", json={"apns_token": "tok1"})
    upload_and_resolve(client, png_upload)
    assert client.app.state.push_sender.sent == []


def test_failed_capture_sends_no_push(make_client, png_upload):
    client = make_client(
        SHOPPING_EXTRACTION,
        extractor=RoutingExtractor(FakeExtractor(SHOPPING_EXTRACTION), None, allow_image=False),
    )
    client.post("/v1/devices", json={"apns_token": "tok1"})
    status = upload(client, png_upload)
    assert status["status"] == "failed"
    assert client.app.state.push_sender.sent == []


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


def test_not_this_rejects_the_card(make_client, png_upload):
    # "Not this" stops resurfacing: the card leaves the feed for good, while a
    # direct fetch (e.g. from an old push) still works and shows the status.
    client = make_client(GENERIC_EXTRACTION)
    card = upload_and_resolve(client, png_upload)
    assert client.post(f"/v1/cards/{card['id']}/feedback", json={"kind": "not_this"}).status_code == 204

    assert client.get("/v1/cards").json()["cards"] == []
    assert client.get(f"/v1/cards/{card['id']}").json()["status"] == "rejected"

    # "correct" feedback leaves the card in the feed.
    other = upload_and_resolve(client, png_upload)
    client.post(f"/v1/cards/{other['id']}/feedback", json={"kind": "correct"})
    assert [c["id"] for c in client.get("/v1/cards").json()["cards"]] == [other["id"]]


def test_requests_without_install_id_are_rejected(make_client, png_upload):
    client = make_client(GENERIC_EXTRACTION)
    card = upload_and_resolve(client, png_upload)
    del client.headers["X-Install-Id"]

    assert client.post("/v1/captures", files=png_upload).status_code == 401
    assert client.get(f"/v1/captures/{card['capture_id']}").status_code == 401
    assert client.get(f"/v1/captures/{card['capture_id']}/image").status_code == 401
    assert client.get("/v1/cards").status_code == 401
    assert client.get(f"/v1/cards/{card['id']}").status_code == 401
    assert client.post(f"/v1/cards/{card['id']}/feedback", json={"kind": "correct"}).status_code == 401
    assert client.post("/v1/devices", json={"apns_token": "tok1"}).status_code == 401
    assert client.get("/healthz").status_code == 200


def test_cards_and_images_are_scoped_to_the_install(make_client, png_upload):
    client = make_client(GENERIC_EXTRACTION)
    card = upload_and_resolve(client, png_upload)
    client.headers["X-Install-Id"] = "install-b"

    assert client.get("/v1/cards").json()["cards"] == []
    assert client.get(f"/v1/cards/{card['id']}").status_code == 404
    assert client.get(f"/v1/captures/{card['capture_id']}").status_code == 404
    assert client.get(f"/v1/captures/{card['capture_id']}/image").status_code == 404
    assert client.post(f"/v1/cards/{card['id']}/feedback", json={"kind": "not_this"}).status_code == 404
    assert client.get("/v1/cards", params={"cursor": card["id"]}).status_code == 400

    client.headers["X-Install-Id"] = "install-a"
    assert [c["id"] for c in client.get("/v1/cards").json()["cards"]] == [card["id"]]


def test_device_token_is_rehomed_on_reinstall(make_client):
    from app.models import Device

    client = make_client(GENERIC_EXTRACTION)
    client.post("/v1/devices", json={"apns_token": "tok1"})
    client.headers["X-Install-Id"] = "install-b"
    client.post("/v1/devices", json={"apns_token": "tok1"})

    with client.app.state.session_factory() as session:
        rows = session.query(Device).all()
    assert [(row.apns_token, row.install_id) for row in rows] == [("tok1", "install-b")]


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
