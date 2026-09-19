from datetime import datetime, timezone

import pytest

from app.pipeline.deadlines import SEOUL, parse_deadline

NOW = datetime(2026, 9, 1, 12, 0, tzinfo=SEOUL)


def kst(*args) -> datetime:
    return datetime(*args, tzinfo=SEOUL)


@pytest.mark.parametrize(
    "text, expected",
    [
        ("9월 12일까지", kst(2026, 9, 12, 23, 59)),
        ("9/12까지", kst(2026, 9, 12, 23, 59)),
        ("9.12까지", kst(2026, 9, 12, 23, 59)),
        ("9/12 마감", kst(2026, 9, 12, 23, 59)),
        ("9/12(금)까지", kst(2026, 9, 12, 23, 59)),
        ("2026.09.12", kst(2026, 9, 12, 23, 59)),
        ("2026-09-12", kst(2026, 9, 12, 23, 59)),
        ("2026년 9월 12일 오후 6시", kst(2026, 9, 12, 18, 0)),
        ("9월 12일 오후 6시", kst(2026, 9, 12, 18, 0)),
        ("9월 12일 (오후 6시)", kst(2026, 9, 12, 18, 0)),
        ("9월 12일 18시", kst(2026, 9, 12, 18, 0)),
        ("9월 12일 23:59 마감", kst(2026, 9, 12, 23, 59)),
        ("9월 12일 오전 12시", kst(2026, 9, 12, 0, 0)),
        ("9월 12일 오후 12시", kst(2026, 9, 12, 12, 0)),
        ("until Sep 12", kst(2026, 9, 12, 23, 59)),
        ("by 9/12", kst(2026, 9, 12, 23, 59)),
        ("Sept 12th", kst(2026, 9, 12, 23, 59)),
        ("마감일: 9월 12일", kst(2026, 9, 12, 23, 59)),
    ],
)
def test_explicit_dates_parse(text, expected):
    assert parse_deadline(text, NOW) == expected


@pytest.mark.parametrize(
    "text",
    [
        None,
        "",
        "7일간",
        "곧 마감",
        "오늘까지",
        "내일까지",
        "D-3",
        "세일 마감 임박",
        "9/12",  # numeric month/day without a cue is too ambiguous
        "9.12",
        "12.9% 할인",
        "4.5점",
        "2/30까지",  # impossible date
        "9월 5일 또는 9월 12일",  # two uncued dates -> ambiguous
    ],
)
def test_relative_or_ambiguous_text_returns_none(text):
    assert parse_deadline(text, NOW) is None


def test_period_end_is_the_deadline():
    assert parse_deadline("9/5~9/12까지", NOW) == kst(2026, 9, 12, 23, 59)
    assert parse_deadline("9/5 ~ 9/12", NOW) == kst(2026, 9, 12, 23, 59)
    assert parse_deadline("2026.09.05 ~ 2026.09.12", NOW) == kst(2026, 9, 12, 23, 59)
    assert parse_deadline("10/1~10/15 (15일간)", NOW) == kst(2026, 10, 15, 23, 59)


def test_year_rolls_over_when_more_than_a_week_past():
    assert parse_deadline("1월 5일까지", NOW) == kst(2027, 1, 5, 23, 59)
    assert parse_deadline("8월 20일까지", NOW) == kst(2027, 8, 20, 23, 59)
    # Within the 7-day grace: a sale that just ended stays in the current year.
    assert parse_deadline("8월 26일까지", NOW) == kst(2026, 8, 26, 23, 59)


def test_explicit_year_is_kept_even_when_past():
    assert parse_deadline("2025.09.12", NOW) == kst(2025, 9, 12, 23, 59)


def test_now_in_other_timezone_is_converted():
    # 2026-12-31 23:30 KST is still Dec 31 in UTC terms only if converted first;
    # the year for "1월 5일" must come from the KST calendar.
    utc_now = datetime(2026, 12, 31, 23, 30, tzinfo=SEOUL).astimezone(timezone.utc)
    result = parse_deadline("1월 5일까지", utc_now)
    assert result == kst(2027, 1, 5, 23, 59)
    assert result.tzinfo == SEOUL
