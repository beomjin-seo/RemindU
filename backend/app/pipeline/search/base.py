from dataclasses import dataclass
from typing import Protocol


class ConfigurationError(RuntimeError):
    pass


@dataclass
class SearchResult:
    url: str
    title: str
    snippet: str = ""
    price: int | None = None


@dataclass
class PlaceResult:
    name: str
    url: str | None = None
    category: str | None = None
    address: str | None = None
    lat: float | None = None
    lng: float | None = None


class SearchClient(Protocol):
    def search(self, query: str, limit: int = 5) -> list[SearchResult]: ...


class LocalSearchClient(Protocol):
    def search_places(self, query: str, limit: int = 5) -> list[PlaceResult]: ...
