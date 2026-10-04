from functools import lru_cache
from typing import Annotated, Literal

from cryptography.fernet import Fernet
from pydantic import Field, SecretStr, field_validator, model_validator
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
    clerk_clock_skew_seconds: int = Field(default=10, ge=0, le=60)

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

    # ---- AI gateway ----
    ai_primary_provider: str = "groq"
    ai_fallback_provider: str | None = None
    groq_api_key: SecretStr = SecretStr("")
    groq_base_url: str = "https://api.groq.com/openai/v1"
    groq_model: str = "llama-3.3-70b-versatile"
    openai_api_key: SecretStr = SecretStr("")
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-4o-mini"
    ai_request_timeout_seconds: float = Field(default=20.0, gt=0)
    ai_max_attempts: int = Field(default=3, ge=1)
    ai_retry_base_seconds: float = Field(default=1.0, gt=0)
    ai_retry_cap_seconds: float = Field(default=20.0, gt=0)
    ai_circuit_failure_threshold: int = Field(default=5, ge=1)
    ai_circuit_cooldown_seconds: int = Field(default=60, ge=1)
    ai_rate_limit_per_minute: int = Field(default=60, ge=1)
    ai_rate_limit_per_minute_per_tenant: int = Field(default=20, ge=1)
    ai_default_max_tokens: int = Field(default=300, ge=1)

    # ---- Moderation (safety classifier; runs before any AI response generation) ----
    # Instagram caps DMs at 1000 bytes and comments at 2200 characters, so longer input cannot come
    # from Meta. Rather than truncating (which lets an attacker pad a threat past the cut), such
    # input is escalated to a human unclassified.
    moderation_max_input_chars: int = Field(default=2200, ge=50)
    moderation_max_tokens: int = Field(default=60, ge=20)
    # Below this self-reported confidence a non-threat verdict is not trusted; a human decides.
    moderation_min_confidence: float = Field(default=0.6, ge=0.0, le=1.0)
    # Structural spam limits (cheap, deterministic, and they protect AI quota from spam floods).
    moderation_max_links: int = Field(default=2, ge=0)
    moderation_max_mentions: int = Field(default=5, ge=0)

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

    @model_validator(mode="after")
    def _consistent_configuration(self) -> "Settings":
        if self.job_requeue_after_seconds <= max(
            self.job_timeout_seconds, int(self.job_retry_cap_seconds)
        ):
            raise ValueError(
                "JOB_REQUEUE_AFTER_SECONDS must exceed JOB_TIMEOUT_SECONDS "
                "and JOB_RETRY_CAP_SECONDS"
            )
        if self.is_production and not (self.clerk_authorized_parties and self.cors_allowed_origins):
            raise ValueError(
                "CLERK_AUTHORIZED_PARTIES and CORS_ALLOWED_ORIGINS are required in production"
            )
        return self

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
