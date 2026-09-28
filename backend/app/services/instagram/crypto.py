from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from app.config.settings import Settings


class TokenDecryptionError(Exception):
    """Ciphertext could not be decrypted with any configured key."""


class TokenCipher:
    """Encrypts Instagram tokens at rest. First key encrypts; all keys decrypt (rotation)."""

    def __init__(self, primary_key: str, previous_keys: list[str]) -> None:
        self._fernet = MultiFernet([Fernet(k) for k in (primary_key, *previous_keys)])

    @classmethod
    def from_settings(cls, settings: Settings) -> "TokenCipher":
        return cls(
            settings.token_encryption_key.get_secret_value(),
            [key.get_secret_value() for key in settings.token_encryption_previous_keys],
        )

    def encrypt(self, plaintext: str) -> bytes:
        return self._fernet.encrypt(plaintext.encode())

    def decrypt(self, ciphertext: bytes) -> str:
        try:
            return self._fernet.decrypt(ciphertext).decode()
        except InvalidToken as exc:
            raise TokenDecryptionError from exc
