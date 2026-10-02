import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy import literal, select

from app.api.deps import SessionDep, Tenant, require
from app.core.pagination import DEFAULT_LIMIT, MAX_LIMIT, Page, keyset_page
from app.core.rbac import Permission
from app.models.enums import (
    ConversationState,
    DeliveryStatus,
    MemberRole,
    MessageDirection,
    MessageOrigin,
    Priority,
)
from app.models.instagram import Conversation, Customer, Message
from app.schemas.conversations import (
    ConversationOut,
    ConversationUpdate,
    CustomerOut,
    MessageOut,
    NoteIn,
    SendMessageIn,
)
from app.services.conversations import conversations as service
from app.services.conversations.messages import mark_read, record_message
from app.services.conversations.sending import send_human_reply
from app.services.tenancy import TenantContext
from app.workers.queue import JobQueue

router = APIRouter(prefix="/conversations", tags=["conversations"])

Cursor = Annotated[str | None, Query(max_length=200)]
Limit = Annotated[int, Query(ge=1, le=MAX_LIMIT)]
AutomationManager = Annotated[TenantContext, Depends(require(Permission.AUTOMATION_MANAGE))]


def _out(conversation: Conversation, customer: Customer) -> ConversationOut:
    return ConversationOut(
        id=conversation.id,
        instagram_account_id=conversation.instagram_account_id,
        customer=CustomerOut(
            id=customer.id,
            external_user_id=customer.external_user_id,
            username=customer.username,
            display_name=customer.display_name,
        ),
        state=conversation.state,
        priority=conversation.priority,
        last_intent=conversation.last_intent,
        is_lead=conversation.is_lead,
        tags=list(conversation.tags),
        summary=conversation.summary,
        unread_count=conversation.unread_count,
        assigned_user_id=conversation.assigned_user_id,
        last_message_at=conversation.last_message_at,
        created_at=conversation.created_at,
    )


@router.get("", response_model=Page[ConversationOut])
async def list_conversations(
    tenant: Tenant,
    session: SessionDep,
    cursor: Cursor = None,
    limit: Limit = DEFAULT_LIMIT,
    state: ConversationState | None = None,
    priority: Priority | None = None,
    is_lead: bool | None = None,
    tag: Annotated[str | None, Query(max_length=50)] = None,
) -> Page[ConversationOut]:
    stmt = (
        select(Conversation, Customer)
        .join(Customer, Customer.id == Conversation.customer_id)
        .where(
            Conversation.organization_id == tenant.organization_id,
            Conversation.deleted_at.is_(None),
        )
    )
    if tenant.role is MemberRole.STAFF:
        stmt = stmt.where(Conversation.assigned_user_id == tenant.user_id)
    if state is not None:
        stmt = stmt.where(Conversation.state == state)
    if priority is not None:
        stmt = stmt.where(Conversation.priority == priority)
    if is_lead is not None:
        stmt = stmt.where(Conversation.is_lead == is_lead)
    if tag is not None:
        stmt = stmt.where(Conversation.tags.any(literal(tag)))

    rows, next_cursor = await keyset_page(
        session,
        stmt,
        Conversation.created_at,
        Conversation.id,
        lambda row: (row[0].created_at, row[0].id),
        cursor,
        limit,
    )
    return Page[ConversationOut](items=[_out(c, cust) for c, cust in rows], next_cursor=next_cursor)


@router.get("/{conversation_id}", response_model=ConversationOut)
async def get_conversation(
    conversation_id: uuid.UUID, tenant: Tenant, session: SessionDep
) -> ConversationOut:
    conversation = await service.get_conversation_for_tenant(session, tenant, conversation_id)
    customer = await session.get(Customer, conversation.customer_id)
    assert customer is not None
    await mark_read(session, conversation)
    return _out(conversation, customer)


@router.patch("/{conversation_id}", response_model=ConversationOut)
async def update_conversation(
    conversation_id: uuid.UUID, body: ConversationUpdate, tenant: Tenant, session: SessionDep
) -> ConversationOut:
    conversation = await service.get_conversation_for_tenant(session, tenant, conversation_id)
    if body.priority is not None:
        conversation.priority = body.priority
    if body.tags is not None:
        conversation.tags = body.tags
    if body.is_lead is not None:
        conversation.is_lead = body.is_lead
    customer = await session.get(Customer, conversation.customer_id)
    assert customer is not None
    return _out(conversation, customer)


@router.post("/{conversation_id}/takeover", response_model=ConversationOut)
async def takeover(
    conversation_id: uuid.UUID, tenant: Tenant, session: SessionDep
) -> ConversationOut:
    conversation = await service.get_conversation_for_tenant(session, tenant, conversation_id)
    await service.take_over(session, tenant, conversation)
    customer = await session.get(Customer, conversation.customer_id)
    assert customer is not None
    return _out(conversation, customer)


@router.post("/{conversation_id}/hand-back", response_model=ConversationOut)
async def hand_back(
    conversation_id: uuid.UUID, tenant: Tenant, session: SessionDep
) -> ConversationOut:
    conversation = await service.get_conversation_for_tenant(session, tenant, conversation_id)
    await service.hand_back_to_ai(session, tenant, conversation)
    customer = await session.get(Customer, conversation.customer_id)
    assert customer is not None
    return _out(conversation, customer)


@router.post("/{conversation_id}/resolve", response_model=ConversationOut)
async def resolve(
    conversation_id: uuid.UUID, tenant: Tenant, session: SessionDep
) -> ConversationOut:
    conversation = await service.get_conversation_for_tenant(session, tenant, conversation_id)
    await service.resolve(session, tenant, conversation)
    customer = await session.get(Customer, conversation.customer_id)
    assert customer is not None
    return _out(conversation, customer)


@router.get("/{conversation_id}/messages", response_model=Page[MessageOut])
async def list_messages(
    conversation_id: uuid.UUID,
    tenant: Tenant,
    session: SessionDep,
    cursor: Cursor = None,
    limit: Limit = DEFAULT_LIMIT,
) -> Page[MessageOut]:
    await service.get_conversation_for_tenant(session, tenant, conversation_id)
    stmt = select(Message).where(Message.conversation_id == conversation_id)
    rows, next_cursor = await keyset_page(
        session,
        stmt,
        Message.created_at,
        Message.id,
        lambda row: (row[0].created_at, row[0].id),
        cursor,
        limit,
    )
    items = [
        MessageOut(
            id=m.id,
            direction=m.direction,
            origin=m.origin,
            body=m.body,
            status=m.status,
            intent=m.intent,
            ai_confidence=m.ai_confidence,
            author_user_id=m.author_user_id,
            created_at=m.created_at,
        )
        for (m,) in rows
    ]
    return Page[MessageOut](items=items, next_cursor=next_cursor)


@router.post(
    "/{conversation_id}/messages", response_model=MessageOut, status_code=status.HTTP_201_CREATED
)
async def send_message(
    conversation_id: uuid.UUID,
    body: SendMessageIn,
    tenant: Tenant,
    session: SessionDep,
    request: Request,
) -> MessageOut:
    job_queue: JobQueue = request.app.state.job_queue
    _, message = await send_human_reply(session, job_queue, tenant, conversation_id, body.body)
    assert isinstance(message, Message)
    return MessageOut(
        id=message.id,
        direction=message.direction,
        origin=message.origin,
        body=message.body,
        status=message.status,
        intent=message.intent,
        ai_confidence=message.ai_confidence,
        author_user_id=message.author_user_id,
        created_at=message.created_at,
    )


@router.post(
    "/{conversation_id}/notes", response_model=MessageOut, status_code=status.HTTP_201_CREATED
)
async def add_note(
    conversation_id: uuid.UUID, body: NoteIn, tenant: Tenant, session: SessionDep
) -> MessageOut:
    conversation = await service.get_conversation_for_tenant(session, tenant, conversation_id)
    message = await record_message(
        session,
        tenant.organization_id,
        conversation.instagram_account_id,
        conversation,
        direction=MessageDirection.OUTBOUND,
        origin=MessageOrigin.INTERNAL_NOTE,
        body=body.body,
        status=DeliveryStatus.SENT,
        author_user_id=tenant.user_id,
    )
    assert message is not None
    return MessageOut(
        id=message.id,
        direction=message.direction,
        origin=message.origin,
        body=message.body,
        status=message.status,
        intent=message.intent,
        ai_confidence=message.ai_confidence,
        author_user_id=message.author_user_id,
        created_at=message.created_at,
    )
