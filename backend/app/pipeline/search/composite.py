import logging

from app.pipeline.search.base import ConfigurationError, SearchClient, SearchResult

logger = logging.getLogger(__name__)


class CompositeSearchClient:
    """Queries each client in order and merges results, deduplicated by URL.

    A client that is not configured (ConfigurationError) or fails outright is
    skipped, so one missing key never takes the whole search backbone down.
    """

    def __init__(self, clients: list[SearchClient]):
        self._clients = list(clients)

    def search(self, query: str, limit: int = 5) -> list[SearchResult]:
        merged: list[SearchResult] = []
        seen: set[str] = set()
        for client in self._clients:
            name = type(client).__name__
            try:
                results = client.search(query, limit=limit)
            except ConfigurationError as exc:
                logger.info("search client %s skipped: %s", name, exc)
                continue
            except Exception:
                logger.exception("search client %s failed", name)
                continue
            for result in results:
                if result.url in seen:
                    continue
                seen.add(result.url)
                merged.append(result)
        return merged[: limit * len(self._clients)]
