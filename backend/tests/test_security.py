import json
import time
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import FastAPI
from fastapi.testclient import TestClient
from jwt.algorithms import RSAAlgorithm

from app.api.v1 import api_router
from app.core.errors import AppError, register_error_handlers
from app.core.security import ClerkTokenVerifier

ISSUER = "https://clerk.test"
ORIGIN = "http://localhost:5173"


def _make_key() -> tuple[Any, dict[str, Any]]:
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = json.loads(RSAAlgorithm.to_jwk(private.public_key()))
    jwk.update({"kid": "key-1", "alg": "RS256", "use": "sig"})
    return private, jwk


PRIVATE_KEY, PUBLIC_JWK = _make_key()


def _token(**overrides: Any) -> str:
    now = int(time.time())
    claims = {
        "sub": "user_1",
        "sid": "sess_1",
        "iss": ISSUER,
        "iat": now,
        "exp": now + 60,
        "azp": ORIGIN,
        **overrides,
    }
    return jwt.encode(claims, PRIVATE_KEY, algorithm="RS256", headers={"kid": "key-1"})


def _verifier(fetch_count: list[int] | None = None) -> ClerkTokenVerifier:
    async def fetch() -> dict[str, Any]:
        if fetch_count is not None:
            fetch_count.append(1)
        return {"keys": [PUBLIC_JWK]}

    return ClerkTokenVerifier(fetch, ISSUER, [ORIGIN], cache_seconds=3600, min_refetch_seconds=30)


async def test_valid_token_returns_identity() -> None:
    identity = await _verifier().verify(_token())
    assert identity.clerk_user_id == "user_1"
    assert identity.session_id == "sess_1"


@pytest.mark.parametrize(
    "overrides",
    [{"exp": int(time.time()) - 10}, {"iss": "https://evil.test"}, {"azp": "https://evil.test"}],
)
async def test_invalid_claims_are_rejected(overrides: dict[str, Any]) -> None:
    with pytest.raises(AppError) as exc:
        await _verifier().verify(_token(**overrides))
    assert exc.value.status_code == 401


async def test_unknown_kid_refetch_is_rate_limited() -> None:
    fetches: list[int] = []
    verifier = _verifier(fetches)
    await verifier.verify(_token())
    forged = jwt.encode({"sub": "x"}, PRIVATE_KEY, algorithm="RS256", headers={"kid": "nope"})
    for _ in range(3):
        with pytest.raises(AppError):
            await verifier.verify(forged)
    assert len(fetches) == 1


def _client() -> TestClient:
    app = FastAPI()
    register_error_handlers(app)
    app.include_router(api_router)
    app.state.token_verifier = _verifier()
    return TestClient(app)


def test_me_requires_bearer_token() -> None:
    response = _client().get("/api/v1/auth/me")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"


def test_me_returns_identity() -> None:
    response = _client().get("/api/v1/auth/me", headers={"Authorization": f"Bearer {_token()}"})
    assert response.status_code == 200
    assert response.json() == {"clerk_user_id": "user_1"}
