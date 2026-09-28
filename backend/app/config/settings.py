from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.workers.queues import QueueName


class Settings(BaseSettings):
    """Application settings loaded from environment variables (see .env.example)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: Literal["development", "staging", "production"] = "development"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    cors_allowed_origins: list[str] = Field(default_factory=list)

    database_url: str
    db_pool_size: int = Field(default=5, ge=1)
    db_max_overflow: int = Field(default=5, ge=0)
    redis_url: str

    clerk_jwks_url: str
    clerk_issuer: str
    clerk_authorized_parties: list[str] = Field(default_factory=list)
    clerk_jwks_cache_seconds: int = Field(default=3600, ge=60)
    clerk_jwks_min_refetch_seconds: int = Field(default=30, ge=1)

    token_encryption_key: SecretStr = SecretStr("")

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

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
