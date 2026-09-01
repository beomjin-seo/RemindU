from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    anthropic_api_key: str | None = None
    extractor_model: str = "claude-opus-5"
    naver_client_id: str | None = None
    naver_client_secret: str | None = None
    google_cse_key: str | None = None
    google_cse_cx: str | None = None
    database_url: str = f"sqlite:///{_BACKEND_DIR / 'data' / 'capture_inbox.db'}"
    data_dir: Path = _BACKEND_DIR / "data" / "captures"
