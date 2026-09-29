import asyncio
import json
import time
from typing import Any

import httpx
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


def _verifier(
    fetch_count: list[int] | None = None, skew: int = 0, document: dict[str, Any] | None = None
) -> ClerkTokenVerifier:
    async def fetch() -> dict[str, Any]:
        if fetch_count is not None:
            fetch_count.append(1)
        return document if document is not None else {"keys": [PUBLIC_JWK]}

    return ClerkTokenVerifier(
        fetch, ISSUER, [ORIGIN], cache_seconds=3600, min_refetch_seconds=30, clock_skew_seconds=skew
    )


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


async def test_small_clock_skew_is_tolerated_only_when_configured() -> None:
    future = _token(iat=int(time.time()) + 5)
    with pytest.raises(AppError):
        await _verifier(skew=0).verify(future)
    identity = await _verifier(skew=10).verify(future)
    assert identity.clerk_user_id == "user_1"


def _outage_verifier(fetches: list[int], calls: dict[str, bool]) -> ClerkTokenVerifier:
    async def fetch() -> dict[str, Any]:
        fetches.append(1)
        if calls["down"]:
            raise httpx.ConnectError("clerk unreachable")
        return {"keys": [PUBLIC_JWK]}

    return ClerkTokenVerifier(fetch, ISSUER, [ORIGIN], cache_seconds=60, min_refetch_seconds=30)


async def test_cached_keys_keep_working_when_clerk_is_down() -> None:
    fetches: list[int] = []
    state = {"down": False}
    verifier = _outage_verifier(fetches, state)
    await verifier.verify(_token())
    verifier._fetched_at -= 3600  # cache expired
    verifier._last_attempt -= 3600
    state["down"] = True
    assert (await verifier.verify(_token())).clerk_user_id == "user_1"


async def test_outage_causes_one_upstream_attempt_per_window() -> None:
    fetches: list[int] = []
    verifier = _outage_verifier(fetches, {"down": True})
    results = await asyncio.gather(
        *[verifier.verify(_token()) for _ in range(5)], return_exceptions=True
    )
    assert len(fetches) == 1
    assert all(isinstance(r, AppError) and r.code == "AUTH_PROVIDER_UNAVAILABLE" for r in results)


async def test_malformed_jwks_is_a_503_not_a_crash() -> None:
    verifier = _verifier(document={"keys": [{"kid": "key-1", "kty": "RSA"}]})
    with pytest.raises(AppError) as exc:
        await verifier.verify(_token())
    assert exc.value.code == "AUTH_PROVIDER_UNAVAILABLE"
