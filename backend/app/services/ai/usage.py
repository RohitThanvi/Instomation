import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ops import AiUsage
from app.services.ai.pricing import estimate_cost
from app.services.ai.provider import AICompletion


def record_usage(
    session: AsyncSession,
    organization_id: uuid.UUID,
    purpose: str,
    completion: AICompletion,
    status: str = "success",
    conversation_id: uuid.UUID | None = None,
) -> None:
    session.add(
        AiUsage(
            organization_id=organization_id,
            conversation_id=conversation_id,
            provider=completion.provider,
            model=completion.model,
            purpose=purpose,
            input_tokens=completion.input_tokens,
            output_tokens=completion.output_tokens,
            estimated_cost=estimate_cost(
                completion.provider,
                completion.model,
                completion.input_tokens,
                completion.output_tokens,
            ),
            latency_ms=completion.latency_ms,
            status=status,
        )
    )
