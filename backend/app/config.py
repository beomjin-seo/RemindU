from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    anthropic_api_key: str | None = None
    extractor_model: str = "claude-opus-5"
    # PRIVACY: screenshot pixels are sent to the model only when this is true.
    # Default path structures on-device OCR text only.
    allow_image_extraction: bool = False
    naver_client_id: str | None = None
    naver_client_secret: str | None = None
    elevenst_api_key: str | None = None
    google_cse_key: str | None = None
    google_cse_cx: str | None = None
    database_url: str = f"sqlite:///{_BACKEND_DIR / 'data' / 'capture_inbox.db'}"
    data_dir: Path = _BACKEND_DIR / "data" / "captures"

    # APNs token-based auth. All three must be set for real delivery; otherwise
    # ApnsSender.send logs the payload and returns "unconfigured".
    apns_key_id: str | None = None
    apns_team_id: str | None = None
    apns_auth_key_path: str | None = None
    apns_bundle_id: str = "com.captureinbox.app"
    apns_use_sandbox: bool = True
    # "찾았어요" push when a capture resolves into a card. On for the validation
    # cohort (the share-and-forget loop needs it); turn off once cards are
    # surfaced another way.
    push_on_resolved: bool = True
