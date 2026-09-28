from functools import lru_cache
from typing import Annotated, Literal

from cryptography.fernet import Fernet
from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

from app.workers.queues import QueueName

# Lists are supplied as comma-separated env values (e.g. "a,b"), not JSON.
CommaList = Annotated[list[str], NoDecode]
CommaSecrets = Annotated[list[SecretStr], NoDecode]


class Settings(BaseSettings):
    """Application settings loaded from environment variables (see .env.example)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: Literal["development", "staging", "production"] = "development"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    cors_allowed_origins: CommaList = Field(default_factory=list)
    frontend_base_url: str

    database_url: str
    db_pool_size: int = Field(default=5, ge=1)
    db_max_overflow: int = Field(default=5, ge=0)
    redis_url: str

    clerk_jwks_url: str
    clerk_issuer: str
    clerk_authorized_parties: CommaList = Field(default_factory=list)
    clerk_jwks_cache_seconds: int = Field(default=3600, ge=60)
    clerk_jwks_min_refetch_seconds: int = Field(default=30, ge=1)

    # Fernet key for Instagram tokens; previous keys stay readable during rotation.
    token_encryption_key: SecretStr
    token_encryption_previous_keys: CommaSecrets = Field(default_factory=list)

    meta_app_id: str
    meta_app_secret: SecretStr
    meta_redirect_uri: str
    meta_webhook_verify_token: SecretStr = SecretStr("")
    meta_graph_api_version: str = "v26.0"
    meta_oauth_scopes: CommaList = Field(
        default_factory=lambda: [
            "instagram_business_basic",
            "instagram_business_manage_messages",
            "instagram_business_manage_comments",
        ]
    )
    meta_webhook_fields: CommaList = Field(default_factory=lambda: ["comments", "messages"])
    meta_http_timeout_seconds: float = Field(default=10.0, gt=0)
    oauth_result_path: str = "/settings/instagram"
    oauth_state_ttl_seconds: int = Field(default=600, ge=60)
    token_refresh_window_days: int = Field(default=10, ge=1)

    # Capabilities Meta supports; operators may switch them off per environment.
    feature_comment_reply: bool = True
    feature_dm_reply: bool = True
    feature_private_reply: bool = True

    worker_queue: QueueName = QueueName.MAINTENANCE
    worker_max_jobs: int = Field(default=10, ge=1)
    worker_poll_delay_seconds: float = Field(default=1.0, ge=0.1)
    job_timeout_seconds: int = Field(default=120, ge=1)
    job_max_tries: int = Field(default=5, ge=1)
    job_retry_base_seconds: float = Field(default=1.0, gt=0)
    job_retry_cap_seconds: float = Field(default=300.0, gt=0)
    job_requeue_after_seconds: int = Field(default=900, ge=60)
    job_retention_days: int = Field(default=14, ge=1)
    webhook_event_retention_days: int = Field(default=30, ge=1)

    @field_validator(
        "cors_allowed_origins",
        "clerk_authorized_parties",
        "meta_oauth_scopes",
        "meta_webhook_fields",
        "token_encryption_previous_keys",
        mode="before",
    )
    @classmethod
    def _split_commas(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("token_encryption_key", mode="after")
    @classmethod
    def _valid_primary_key(cls, value: SecretStr) -> SecretStr:
        Fernet(value.get_secret_value())
        return value

    @field_validator("token_encryption_previous_keys", mode="after")
    @classmethod
    def _valid_previous_keys(cls, value: list[SecretStr]) -> list[SecretStr]:
        for key in value:
            Fernet(key.get_secret_value())
        return value

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
