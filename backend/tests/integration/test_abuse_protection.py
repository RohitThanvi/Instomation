"""Request-level protection against floods and overload, on real PostgreSQL and Redis."""

import time
from collections.abc import AsyncIterator

import httpx
import pytest_asyncio
from fastapi import FastAPI
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.deps import SessionDep
from app.config.settings import Settings, get_settings
from app.core.errors import register_error_handlers
from app.core.middleware import REQUEST_ID_HEADER
from app.db.session import create_engine, create_session_factory
from app.main import create_app
from tests.integration.conftest import DATABASE_URL
from tests.integration.test_conversations_flow import FakeVerifier

ORGANIZATIONS = "/api/v1/organizations"
WEBHOOK = "/api/v1/instagram/webhooks"


def _app(
    session_factory: async_sessionmaker[AsyncSession], redis: Redis, **overrides: object
) -> FastAPI:
    settings = get_settings().model_copy(update=overrides)
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    app.state.session_factory = session_factory
    app.state.redis = redis
    app.state.token_verifier = FakeVerifier()
    return app


def _client(app: FastAPI) -> httpx.AsyncClient:
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


def _as(user: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {user}"}


# ---- headers -----------------------------------------------------------------------------------


async def test_the_app_sends_the_strict_headers_only_in_production(
    session_factory: async_sessionmaker[AsyncSession], redis: Redis
) -> None:
    async with _client(_app(session_factory, redis, app_env="production")) as client:
        production = await client.get("/health")
    async with _client(_app(session_factory, redis, app_env="development")) as client:
        development = await client.get("/health")
    assert "content-security-policy" in production.headers
    assert "strict-transport-security" in production.headers
    assert "content-security-policy" not in development.headers
    assert "strict-transport-security" not in development.headers


# ---- request size ------------------------------------------------------------------------------


async def test_an_oversized_body_is_refused_before_authentication_or_signature_checks(
    session_factory: async_sessionmaker[AsyncSession], redis: Redis
) -> None:
    app = _app(session_factory, redis, max_request_body_bytes=1024)
    async with _client(app) as client:
        webhook = await client.post(WEBHOOK, content=b"x" * 2000)
        api = await client.post(ORGANIZATIONS, content=b"x" * 2000)
        small = await client.post(WEBHOOK, content=b"x" * 1000)
    assert (webhook.status_code, api.status_code) == (413, 413)
    assert small.status_code != 413  # within the limit it reaches the webhook's own checks


# ---- per-address flood guard -------------------------------------------------------------------


async def test_an_address_over_its_limit_is_turned_away_with_a_retry_hint(
    session_factory: async_sessionmaker[AsyncSession], redis: Redis
) -> None:
    app = _app(session_factory, redis, rate_limit_per_minute_per_ip=3)
    async with _client(app) as client:
        statuses = [(await client.get(ORGANIZATIONS)).status_code for _ in range(3)]
        blocked = await client.get(ORGANIZATIONS, headers={REQUEST_ID_HEADER: "trace-abc-12345"})
    assert statuses == [401, 401, 401]
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "RATE_LIMITED"
    assert 1 <= int(blocked.headers["retry-after"]) <= 60
    # The refusal still carries the request id and security headers of every other response.
    assert blocked.headers[REQUEST_ID_HEADER] == "trace-abc-12345"
    assert blocked.headers["x-content-type-options"] == "nosniff"


async def test_probes_and_the_signed_webhook_are_never_rate_limited(
    session_factory: async_sessionmaker[AsyncSession], redis: Redis
) -> None:
    app = _app(session_factory, redis, rate_limit_per_minute_per_ip=1)
    async with _client(app) as client:
        await client.get(ORGANIZATIONS)
        assert (await client.get(ORGANIZATIONS)).status_code == 429  # the bucket is spent
        health = [(await client.get("/health")).status_code for _ in range(3)]
        hooks = [(await client.post(WEBHOOK, content=b"{}")).status_code for _ in range(3)]
    assert health == [200, 200, 200]
    assert 429 not in hooks


async def test_each_client_behind_a_trusted_proxy_has_its_own_allowance(
    session_factory: async_sessionmaker[AsyncSession], redis: Redis
) -> None:
    app = _app(session_factory, redis, rate_limit_per_minute_per_ip=1, trusted_proxy_count=1)
    async with _client(app) as client:
        a1 = await client.get(ORGANIZATIONS, headers={"X-Forwarded-For": "198.51.100.1"})
        a2 = await client.get(ORGANIZATIONS, headers={"X-Forwarded-For": "198.51.100.1"})
        b1 = await client.get(ORGANIZATIONS, headers={"X-Forwarded-For": "198.51.100.2"})
    assert (a1.status_code, a2.status_code, b1.status_code) == (401, 429, 401)


async def test_a_client_cannot_dodge_the_limit_by_inventing_addresses(
    session_factory: async_sessionmaker[AsyncSession], redis: Redis
) -> None:
    app = _app(session_factory, redis, rate_limit_per_minute_per_ip=1, trusted_proxy_count=1)
    async with _client(app) as client:
        first = await client.get(
            ORGANIZATIONS, headers={"X-Forwarded-For": "1.1.1.1, 198.51.100.1"}
        )
        second = await client.get(
            ORGANIZATIONS, headers={"X-Forwarded-For": "2.2.2.2, 198.51.100.1"}
        )
    assert (first.status_code, second.status_code) == (401, 429)


async def test_without_a_trusted_proxy_the_forwarded_header_is_ignored(
    session_factory: async_sessionmaker[AsyncSession], redis: Redis
) -> None:
    app = _app(session_factory, redis, rate_limit_per_minute_per_ip=1)
    async with _client(app) as client:
        first = await client.get(ORGANIZATIONS, headers={"X-Forwarded-For": "1.1.1.1"})
        second = await client.get(ORGANIZATIONS, headers={"X-Forwarded-For": "2.2.2.2"})
    assert (first.status_code, second.status_code) == (401, 429)


async def test_the_api_keeps_working_when_redis_is_unreachable(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    dead = Redis.from_url("redis://127.0.0.1:1", decode_responses=True)
    app = _app(session_factory, dead, rate_limit_per_minute_per_ip=1)
    async with _client(app) as client:
        statuses = [(await client.get(ORGANIZATIONS)).status_code for _ in range(3)]
    await dead.aclose()
    assert statuses == [401, 401, 401]  # still answered (by authentication), never a 429 or 500


# ---- per-member limit --------------------------------------------------------------------------


async def test_a_member_over_their_limit_is_stopped_without_affecting_others(
    session_factory: async_sessionmaker[AsyncSession], redis: Redis
) -> None:
    app = _app(session_factory, redis, rate_limit_per_minute_per_user=2)
    async with _client(app) as client:
        first = [
            (await client.get(ORGANIZATIONS, headers=_as("user-a"))).status_code for _ in range(2)
        ]
        blocked = await client.get(ORGANIZATIONS, headers=_as("user-a"))
        other = await client.get(ORGANIZATIONS, headers=_as("user-b"))
    assert first == [200, 200]
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "RATE_LIMITED"
    assert int(blocked.headers["retry-after"]) >= 1
    assert other.status_code == 200


async def test_requests_that_fail_authentication_do_not_use_up_a_members_allowance(
    session_factory: async_sessionmaker[AsyncSession], redis: Redis
) -> None:
    app = _app(session_factory, redis, rate_limit_per_minute_per_user=1)
    async with _client(app) as client:
        for _ in range(3):
            assert (await client.get(ORGANIZATIONS)).status_code == 401
        assert (await client.get(ORGANIZATIONS, headers=_as("user-a"))).status_code == 200


# ---- shedding load instead of failing slowly ---------------------------------------------------


@pytest_asyncio.fixture
async def db_app() -> AsyncIterator[tuple[FastAPI, httpx.AsyncClient]]:
    """A tiny app over a real engine: one pooled connection, a short wait, a short query limit."""
    settings: Settings = get_settings().model_copy(
        update={
            "database_url": DATABASE_URL,
            "db_pool_size": 1,
            "db_max_overflow": 0,
            "db_pool_timeout_seconds": 0.2,
        }
    )
    engine = create_engine(settings, statement_timeout_ms=200)
    app = FastAPI()
    register_error_handlers(app)
    app.state.engine = engine
    app.state.session_factory = create_session_factory(engine)

    @app.get("/quick")
    async def quick(session: SessionDep) -> dict[str, int]:
        return {"one": (await session.execute(text("SELECT 1"))).scalar_one()}

    @app.get("/slow")
    async def slow(session: SessionDep) -> None:
        await session.execute(text("SELECT pg_sleep(2)"))

    @app.get("/broken")
    async def broken(session: SessionDep) -> None:
        await session.execute(text("SELECT 1 / 0"))

    async with _client(app) as client:
        yield app, client
    await engine.dispose()


async def test_a_request_that_cannot_get_a_connection_is_shed_with_a_503(
    db_app: tuple[FastAPI, httpx.AsyncClient],
) -> None:
    app, client = db_app
    async with app.state.engine.connect():  # the only pooled connection is now taken
        started = time.perf_counter()
        response = await client.get("/quick")
        waited = time.perf_counter() - started
    assert response.status_code == 503
    assert waited < 3  # it gave up after the configured wait instead of queueing behind the rest
    assert response.json()["error"]["code"] == "SERVICE_BUSY"
    assert response.headers["retry-after"] == "1"
    assert (await client.get("/quick")).status_code == 200  # and it recovers once it is free


async def test_a_query_that_runs_too_long_is_cancelled_and_reported_as_busy(
    db_app: tuple[FastAPI, httpx.AsyncClient],
) -> None:
    _, client = db_app
    response = await client.get("/slow")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "SERVICE_BUSY"
    assert response.headers["retry-after"] == "1"


async def test_any_other_database_error_is_still_an_internal_error(
    db_app: tuple[FastAPI, httpx.AsyncClient],
) -> None:
    _, client = db_app
    response = await client.get("/broken")
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "INTERNAL_ERROR"


async def test_the_statement_limit_is_set_on_every_connection_and_can_be_switched_off() -> None:
    settings = get_settings().model_copy(update={"database_url": DATABASE_URL})
    for milliseconds, expected in [(1234, "1234ms"), (0, "0")]:
        engine = create_engine(settings, statement_timeout_ms=milliseconds)
        async with engine.connect() as connection:
            shown = (await connection.execute(text("SHOW statement_timeout"))).scalar_one()
        await engine.dispose()
        assert shown == expected
