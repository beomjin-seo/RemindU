"""Conservative deadline parsing (precision >> recall).

Only an explicit calendar date yields a value. Relative or vague phrases
("7일간", "곧 마감", "오늘까지", "D-3") return None: a missed deadline alert
is better than a confidently wrong one.
"""

import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

SEOUL = ZoneInfo("Asia/Seoul")

# End of day KST when the text carries a date but no time.
DEFAULT_HOUR, DEFAULT_MINUTE = 23, 59

# A year-less date that resolved to more than this far in the past means the
# calendar rolled over (e.g. "1월 5일까지" captured in late December).
PAST_GRACE = timedelta(days=7)

_MONTHS_EN = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}  # fmt: skip

# Alternation order matters: a full date must win over its month/day suffix.
_DATE_RE = re.compile(
    r"(?<![\d.])(?:"
    r"(?P<y>\d{4})\s*[.\-/년]\s*(?P<ym>\d{1,2})\s*[.\-/월]\s*(?P<yd>\d{1,2})\s*일?"
    r"|(?P<km>\d{1,2})\s*월\s*(?P<kd>\d{1,2})\s*일"
    r"|(?P<em>jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(?P<ed>\d{1,2})(?:st|nd|rd|th)?"
    r"|(?P<nm>\d{1,2})\s*[./]\s*(?P<nd>\d{1,2})"
    r")(?!\d)",
    re.IGNORECASE,
)

# Text right after a date: optional weekday, optional time, optional cue.
_TAIL_RE = re.compile(
    r"\s*(?:\(\s*[월화수목금토일](?:요일)?\s*\)\s*)?"
    r"(?:\(?\s*(?P<mer1>오전|오후|저녁|밤|새벽|아침|낮|am|pm|a\.m\.|p\.m\.)?\s*(?P<hour>\d{1,2})"
    r"(?::(?P<minute>\d{2})|\s*시(?:\s*(?P<kmin>\d{1,2})\s*분)?)"
    r"\s*(?P<mer2>오전|오후|am|pm|a\.m\.|p\.m\.)?\s*\)?)?"
    r"\s*(?P<cue>까지|마감|종료|끝)?",
    re.IGNORECASE,
)

# Text right before a date that marks it as the end of a period.
_LEAD_CUE_RE = re.compile(
    r"(?:until|till|by|through|thru|before|deadline:?|ends?(?: on)?|마감일?:?|종료일?:?|~)\s*$",
    re.IGNORECASE,
)

_PM_WORDS = {"오후", "저녁", "밤", "낮", "pm", "p.m."}
_AM_WORDS = {"오전", "새벽", "아침", "am", "a.m."}


@dataclass(frozen=True)
class _Found:
    explicit_year: bool  # full date, Korean "M월 D일", or English month name
    year: int | None
    month: int
    day: int
    hour: int
    minute: int
    cued: bool


def _time_from(tail: re.Match) -> tuple[int, int]:
    if tail.group("hour") is None:
        return DEFAULT_HOUR, DEFAULT_MINUTE
    hour = int(tail.group("hour"))
    minute = int(tail.group("minute") or tail.group("kmin") or 0)
    meridiem = (tail.group("mer1") or tail.group("mer2") or "").lower()
    if meridiem in _PM_WORDS and hour < 12:
        hour += 12
    elif meridiem in _AM_WORDS and hour == 12:
        hour = 0
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return DEFAULT_HOUR, DEFAULT_MINUTE
    return hour, minute


def _scan(text: str) -> list[_Found]:
    found: list[_Found] = []
    for match in _DATE_RE.finditer(text):
        year: int | None = None
        if match.group("y"):
            year, month, day = int(match.group("y")), int(match.group("ym")), int(match.group("yd"))
            unambiguous = True
        elif match.group("km"):
            month, day = int(match.group("km")), int(match.group("kd"))
            unambiguous = True
        elif match.group("em"):
            month, day = _MONTHS_EN[match.group("em").lower()], int(match.group("ed"))
            unambiguous = True
        else:
            month, day = int(match.group("nm")), int(match.group("nd"))
            unambiguous = False  # "9/12" or "9.12" needs a cue to count as a date
        if not (1 <= month <= 12 and 1 <= day <= 31):
            continue
        tail = _TAIL_RE.match(text, match.end())
        hour, minute = _time_from(tail)
        cued = bool(tail.group("cue")) or bool(_LEAD_CUE_RE.search(text[: match.start()]))
        found.append(_Found(unambiguous, year, month, day, hour, minute, cued))
    return found


def parse_deadline(text: str | None, now: datetime) -> datetime | None:
    """Return the deadline as an Asia/Seoul datetime, or None when the text
    holds no explicit date. Year-less dates take now.year, rolling to next
    year when that lands more than PAST_GRACE in the past."""
    if not text or not text.strip():
        return None
    now = now.astimezone(SEOUL) if now.tzinfo else now.replace(tzinfo=SEOUL)

    found = _scan(text)
    cued = [item for item in found if item.cued]
    if cued:
        pick = cued[-1]  # "9/5 ~ 9/12까지": the last cued date ends the period
    elif len(found) == 1 and found[0].explicit_year:
        pick = found[0]
    else:
        return None  # nothing, or several dates with no cue -> ambiguous

    try:
        if pick.year is not None:
            return datetime(pick.year, pick.month, pick.day, pick.hour, pick.minute, tzinfo=SEOUL)
        candidate = datetime(now.year, pick.month, pick.day, pick.hour, pick.minute, tzinfo=SEOUL)
        if now - candidate > PAST_GRACE:
            candidate = datetime(
                now.year + 1, pick.month, pick.day, pick.hour, pick.minute, tzinfo=SEOUL
            )
        return candidate
    except ValueError:
        return None  # e.g. 2월 30일
