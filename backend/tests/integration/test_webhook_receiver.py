import hashlib
import hmac
import uuid
from collections.abc import AsyncIterator

import httpx
import pytest_asyncio
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config.settings import get_settings
from app.core.security import Identity
from app.main import create_app
from app.models.enums import AccountType, InstagramAccountStatus, ProcessingStatus
from app.models.identity import Organization
from app.models.instagram import InstagramAccount, WebhookEvent
from app.models.ops import Job
from app.services.events import dispatch as dispatch_module
from app.workers.queue import process_webhook_event
from app.workers.runtime import tracked
from tests.integration.conftest import REDIS_URL


class FakeVerifier:
    async def verify(self, token: str) -> Identity:
        return Identity(clerk_user_id=token, session_id=None)


@pytest_asyncio.fixture
async def client(
    session_factory: async_sessionmaker[AsyncSession], redis: Redis
) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app()
    app.state.session_factory = session_factory
    app.state.redis = redis
    app.state.token_verifier = FakeVerifier()

    from arq import create_pool
    from arq.connections import RedisSettings

    from app.workers.queue import JobQueue
    from tests.integration.conftest import REDIS_URL

    pool = await create_pool(RedisSettings.from_dsn(REDIS_URL))
    app.state.job_queue = JobQueue(pool, session_factory)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as http:
        yield http
    await pool.aclose()


async def _connected_account(
    session_factory: async_sessionmaker[AsyncSession],
) -> tuple[str, uuid.UUID]:
    external_id = f"ig-{uuid.uuid4().hex[:10]}"
    async with session_factory() as session:
        org = Organization(name="T", account_type=AccountType.CREATOR)
        session.add(org)
        await session.flush()
        session.add(
            InstagramAccount(
                organization_id=org.id,
                external_account_id=external_id,
                username="acme",
                status=InstagramAccountStatus.ACTIVE,
                access_token_encrypted=b"",
                granted_permissions=[],
            )
        )
        await session.commit()
        return external_id, org.id


def _sign(body: bytes) -> str:
    secret = get_settings().meta_app_secret.get_secret_value()
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def _comment_body(account_id: str, comment_id: str) -> bytes:
    return (
        f'{{"object":"instagram","entry":[{{"id":"{account_id}","time":1,'
        f'"changes":[{{"field":"comments","value":{{"id":"{comment_id}","text":"hi"}}}}]}}]}}'
    ).encode()


async def test_valid_signed_event_is_persisted_and_enqueued(
    client: httpx.AsyncClient, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    account_id, org_id = await _connected_account(session_factory)
    body = _comment_body(account_id, f"c-{uuid.uuid4().hex[:8]}")
    response = await client.post(
        "/api/v1/instagram/webhooks",
        content=body,
        headers={"X-Hub-Signature-256": _sign(body), "Content-Type": "application/json"},
    )
    assert response.status_code == 200
    async with session_factory() as session:
        event = (
            await session.execute(
                select(WebhookEvent).where(WebhookEvent.organization_id == org_id)
            )
        ).scalar_one()
        assert event.status is ProcessingStatus.PENDING
        job = (await session.execute(select(Job).where(Job.organization_id == org_id))).scalar_one()
        assert job.kind == "process_webhook_event"


async def test_invalid_signature_is_rejected_and_nothing_is_persisted(
    client: httpx.AsyncClient, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    account_id, org_id = await _connected_account(session_factory)
    body = _comment_body(account_id, f"c-{uuid.uuid4().hex[:8]}")
    response = await client.post(
        "/api/v1/instagram/webhooks",
        content=body,
        headers={"X-Hub-Signature-256": "sha256=wrong", "Content-Type": "application/json"},
    )
    assert response.status_code == 403
    async with session_factory() as session:
        rows = (
            await session.execute(
                select(WebhookEvent).where(WebhookEvent.organization_id == org_id)
            )
        ).first()
        assert rows is None


async def test_duplicate_delivery_is_deduplicated(
    client: httpx.AsyncClient, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    account_id, org_id = await _connected_account(session_factory)
    body = _comment_body(account_id, f"c-{uuid.uuid4().hex[:8]}")
    headers = {"X-Hub-Signature-256": _sign(body), "Content-Type": "application/json"}
    first = await client.post("/api/v1/instagram/webhooks", content=body, headers=headers)
    second = await client.post("/api/v1/instagram/webhooks", content=body, headers=headers)
    assert first.status_code == second.status_code == 200
    async with session_factory() as session:
        rows = (
            (
                await session.execute(
                    select(WebhookEvent).where(WebhookEvent.organization_id == org_id)
                )
            )
            .scalars()
            .all()
        )
    assert len(rows) == 1


async def test_unknown_account_is_stored_without_tenant_and_not_dropped(
    client: httpx.AsyncClient, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    comment_id = f"c-{uuid.uuid4().hex[:8]}"
    body = _comment_body("does-not-exist", comment_id)
    response = await client.post(
        "/api/v1/instagram/webhooks",
        content=body,
        headers={"X-Hub-Signature-256": _sign(body), "Content-Type": "application/json"},
    )
    assert response.status_code == 200
    async with session_factory() as session:
        event = (
            await session.execute(
                select(WebhookEvent).where(
                    WebhookEvent.external_event_id == f"comments:{comment_id}"
                )
            )
        ).scalar_one()
        assert event.organization_id is None and event.instagram_account_id is None


async def test_malformed_json_is_rejected_with_400() -> None:
    body = b"not json"
    settings = get_settings()
    import hashlib as h
    import hmac as m

    sig = (
        "sha256="
        + m.new(settings.meta_app_secret.get_secret_value().encode(), body, h.sha256).hexdigest()
    )
    app = create_app()

    async def fake_body(self: object) -> bytes:  # pragma: no cover - trivial
        return body

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/instagram/webhooks", content=body, headers={"X-Hub-Signature-256": sig}
        )
    assert response.status_code == 400


async def test_get_verification_handshake(client: httpx.AsyncClient, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("META_WEBHOOK_VERIFY_TOKEN", "expected-token")
    get_settings.cache_clear()
    ok = await client.get(
        "/api/v1/instagram/webhooks",
        params={
            "hub.mode": "subscribe",
            "hub.verify_token": "expected-token",
            "hub.challenge": "xyz",
        },
    )
    bad = await client.get(
        "/api/v1/instagram/webhooks",
        params={"hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "xyz"},
    )
    get_settings.cache_clear()
    assert ok.status_code == 200 and ok.text == "xyz"
    assert bad.status_code == 403


async def _redis_for_test() -> Redis:
    return Redis.from_url(REDIS_URL, decode_responses=True)


async def test_process_webhook_event_is_idempotent_and_dispatches_once(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    account_id, org_id = await _connected_account(session_factory)
    async with session_factory() as session:
        event = WebhookEvent(
            organization_id=org_id,
            external_event_id=f"comments:{uuid.uuid4().hex}",
            event_type="comments",
            payload_hash="h",
            payload_json={"id": "c1", "text": "hi"},
            status=ProcessingStatus.PENDING,
        )
        session.add(event)
        job = Job(
            organization_id=org_id,
            queue="events",
            kind="process_webhook_event",
            status=ProcessingStatus.PENDING,
            payload={},
        )
        session.add(job)
        await session.commit()
        job.payload = {"webhook_event_id": str(event.id)}
        await session.commit()
        event_id, job_id = event.id, job.id

    calls: list[str] = []
    saved = dispatch_module._clear_for_tests()
    try:

        @dispatch_module.register("comments")
        async def _handle(event_ctx: object, evt: WebhookEvent) -> None:
            calls.append(evt.event_type)

        ctx = {
            "session_factory": session_factory,
            "settings": get_settings(),
            "retry_policy": __import__("app.core.retry", fromlist=["RetryPolicy"]).RetryPolicy(
                3, 1.0, 8.0
            ),
            "job_try": 1,
            "redis": await _redis_for_test(),
        }
        await tracked(process_webhook_event)(ctx, str(job_id))
        await tracked(process_webhook_event)(ctx, str(job_id))
    finally:
        dispatch_module._restore_for_tests(saved)

    assert calls == ["comments"]
    async with session_factory() as session:
        refreshed = await session.get(WebhookEvent, event_id)
        assert refreshed is not None and refreshed.status is ProcessingStatus.DONE
