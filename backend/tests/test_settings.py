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
