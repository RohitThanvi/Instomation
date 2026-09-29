import hashlib
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config.settings import Settings, get_settings
from app.models.enums import ProcessingStatus
from app.models.instagram import InstagramAccount, WebhookEvent
from app.services.instagram.webhooks import (
    WebhookVerificationError,
    extract_items,
    parse_payload,
    verify_challenge,
    verify_signature,
)
from app.workers.queue import JobQueue
from app.workers.queues import QueueName

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/instagram/webhooks", tags=["webhooks"])

_MAX_BODY_BYTES = 2 * 1024 * 1024  # Meta payloads are small; anything larger is not legitimate.


@router.get("", include_in_schema=False)
async def verify(
    settings: Annotated[Settings, Depends(get_settings)],
    hub_mode: Annotated[str | None, Query(alias="hub.mode")] = None,
    hub_verify_token: Annotated[str | None, Query(alias="hub.verify_token")] = None,
    hub_challenge: Annotated[str | None, Query(alias="hub.challenge")] = None,
) -> Response:
    try:
        verify_challenge(settings, hub_mode, hub_verify_token)
    except WebhookVerificationError:
        return Response(status_code=403)
    return Response(content=hub_challenge or "", media_type="text/plain")


@router.post("", include_in_schema=False)
async def receive(
    request: Request, settings: Annotated[Settings, Depends(get_settings)]
) -> Response:
    """Meta's delivery endpoint. Must return fast: verify, persist, enqueue, done. No AI call, no
    outbound Instagram call, ever happens on this path."""
    if not settings.meta_app_secret.get_secret_value() or not (
        settings.meta_webhook_verify_token.get_secret_value()
    ):
        # Fail closed: never accept unverifiable deliveries.
        return Response(status_code=503)

    body = await request.body()
    if len(body) > _MAX_BODY_BYTES:
        return Response(status_code=413)
    if not verify_signature(settings, body, request.headers.get("X-Hub-Signature-256")):
        logger.warning("webhook_signature_invalid")
        return Response(status_code=403)

    try:
        payload = parse_payload(body)
    except ValueError:
        logger.warning("webhook_payload_malformed")
        return Response(status_code=400)

    session_factory: async_sessionmaker[AsyncSession] = request.app.state.session_factory
    job_queue: JobQueue = request.app.state.job_queue
    payload_hash = hashlib.sha256(body).hexdigest()
    accepted = 0

    async with session_factory() as session:
        accounts = {
            row.external_account_id: (row.id, row.organization_id)
            for row in (
                await session.execute(
                    select(
                        InstagramAccount.external_account_id,
                        InstagramAccount.id,
                        InstagramAccount.organization_id,
                    ).where(
                        InstagramAccount.external_account_id.in_(
                            {entry.id for entry in payload.entry}
                        )
                    )
                )
            )
        }
        for item in extract_items(payload):
            resolved = accounts.get(item.external_account_id)
            result = await session.execute(
                insert(WebhookEvent)
                .values(
                    organization_id=resolved[1] if resolved else None,
                    instagram_account_id=resolved[0] if resolved else None,
                    external_event_id=item.external_event_id,
                    event_type=item.event_type,
                    payload_hash=payload_hash,
                    payload_json=item.data,
                    status=ProcessingStatus.PENDING,
                )
                .on_conflict_do_nothing(index_elements=[WebhookEvent.external_event_id])
                .returning(WebhookEvent.id)
            )
            row = result.first()
            if row is None:
                continue  # already processed this delivery (Meta retried, or a duplicate item)
            await session.commit()
            try:
                await job_queue.enqueue(
                    QueueName.EVENTS,
                    "process_webhook_event",
                    {"webhook_event_id": str(row.id)},
                    organization_id=resolved[1] if resolved else None,
                )
                accepted += 1
            except Exception:  # noqa: BLE001 - JobQueue already persisted the Job row for retry
                logger.warning("webhook_event_enqueue_deferred", webhook_event_id=str(row.id))

    logger.info("webhook_received", items=accepted)
    return Response(status_code=200)
