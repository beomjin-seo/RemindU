"""Trusted-domain registry.

Well-known Korean commerce/portal domains get a "trusted" mark that clients
render as a safety badge next to the link (like a verified checkmark).
Display-level trust only — link verification (fetch-and-match) is a separate,
orthogonal check, and this list is also the seed for the future candidate-URL
allowlist from CLAUDE.md.
"""

TRUSTED_DOMAIN_SUFFIXES: tuple[str, ...] = (
    "naver.com",
    "kakao.com",
    "coupang.com",
    "musinsa.com",
    "kream.co.kr",
    "29cm.co.kr",
    "ssg.com",
    "gmarket.co.kr",
    "11st.co.kr",
    "oliveyoung.co.kr",
)


def is_trusted_domain(domain: str) -> bool:
    host = domain.strip().lower()
    return any(
        host == suffix or host.endswith("." + suffix) for suffix in TRUSTED_DOMAIN_SUFFIXES
    )
