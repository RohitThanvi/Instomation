from dataclasses import dataclass
from typing import Literal, Protocol

Role = Literal["system", "user", "assistant"]


@dataclass(frozen=True, slots=True)
class AIMessage:
    role: Role
    content: str


@dataclass(frozen=True, slots=True)
class AICompletion:
    text: str
    provider: str
    model: str
    input_tokens: int
    output_tokens: int
    latency_ms: int


class AIProviderError(Exception):
    """Failure from an AI provider. `status_code` is 0 for transport-level failures."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int,
        retry_after: float | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.retry_after = retry_after

    @property
    def is_rate_limited(self) -> bool:
        return self.status_code == 429

    @property
    def is_auth_error(self) -> bool:
        return self.status_code in (401, 403)

    @property
    def is_retryable(self) -> bool:
        return self.status_code == 0 or self.status_code >= 500 or self.is_rate_limited


class AIProvider(Protocol):
    """Everything the gateway needs from a provider. Business logic depends on this, never on a
    specific SDK or HTTP client, so providers can be added or swapped without touching callers."""

    name: str
    default_model: str

    async def complete(
        self,
        messages: list[AIMessage],
        *,
        model: str | None = None,
        max_tokens: int,
        temperature: float,
        timeout_seconds: float,
    ) -> AICompletion: ...
