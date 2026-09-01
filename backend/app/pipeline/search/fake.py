from app.pipeline.search.base import PlaceResult, SearchResult


class FakeSearchClient:
    """Implements both SearchClient and LocalSearchClient with canned results."""

    def __init__(
        self,
        results: list[SearchResult] | None = None,
        place_results: list[PlaceResult] | None = None,
    ):
        self.results = results or []
        self.place_results = place_results or []
        self.queries: list[str] = []
        self.place_queries: list[str] = []

    def search(self, query: str, limit: int = 5) -> list[SearchResult]:
        self.queries.append(query)
        return self.results[:limit]

    def search_places(self, query: str, limit: int = 5) -> list[PlaceResult]:
        self.place_queries.append(query)
        return self.place_results[:limit]
