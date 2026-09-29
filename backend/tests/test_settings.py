import pytest
from cryptography.fernet import Fernet
from pydantic import ValidationError

from app.config.settings import Settings


def _build(**overrides: str) -> Settings:
    return Settings(_env_file=None, **overrides)  # type: ignore[arg-type]


def test_lists_accept_comma_separated_values(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "http://a.test, http://b.test")
    monkeypatch.setenv("META_OAUTH_SCOPES", "one,two")
    settings = _build()
    assert settings.cors_allowed_origins == ["http://a.test", "http://b.test"]
    assert settings.meta_oauth_scopes == ["one", "two"]


def test_invalid_encryption_key_fails_fast(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TOKEN_ENCRYPTION_KEY", "not-a-fernet-key")
    with pytest.raises(ValidationError):
        _build()


def test_previous_keys_are_validated(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TOKEN_ENCRYPTION_PREVIOUS_KEYS", Fernet.generate_key().decode())
    assert len(_build().token_encryption_previous_keys) == 1
    monkeypatch.setenv("TOKEN_ENCRYPTION_PREVIOUS_KEYS", "garbage")
    with pytest.raises(ValidationError):
        _build()


def test_production_requires_azp_and_cors_allowlists(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("CLERK_AUTHORIZED_PARTIES", raising=False)
    with pytest.raises(ValidationError):
        _build()
    monkeypatch.setenv("CLERK_AUTHORIZED_PARTIES", "https://app.example.com")
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "https://app.example.com")
    assert _build().is_production


def test_requeue_threshold_must_exceed_job_timeout_and_retry_cap(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("JOB_REQUEUE_AFTER_SECONDS", "100")
    monkeypatch.setenv("JOB_TIMEOUT_SECONDS", "120")
    with pytest.raises(ValidationError):
        _build()


def test_env_example_has_no_values_that_are_really_comments() -> None:
    from pathlib import Path

    from dotenv import dotenv_values

    values = dotenv_values(Path(__file__).resolve().parents[2] / ".env.example")
    offenders = {k: v for k, v in values.items() if v and v.lstrip().startswith("#")}
    assert offenders == {}
