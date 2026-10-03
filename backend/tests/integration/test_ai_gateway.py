import uuid
from dataclasses import dataclass, field

import pytest
from redis.asyncio import Redis

from app.config.settings import get_settings
from app.services.ai.gateway import AIGateway, AIGatewayError
from app.services.ai.provider import AICompletion, AIMessage, AIProviderError


@dataclass
class FakeProvider:
    name: str
    default_model: str = "fake-model"
    calls: int = field(default=0)
    fail_times: int = field(default=0)
    error_factory: type[AIProviderError] | None = None
    always_fail_with: AIProviderError | None = None

    async def complete(
        self, messages: list[AIMessage], *, model=None, max_tokens, temperature, timeout_seconds
    ) -> AICompletion:
        self.calls += 1
        if self.always_fail_with is not None:
            raise self.always_fail_with
        if self.calls <= self.fail_times:
            raise AIProviderError("transient", status_code=500)
        return AICompletion(
            text=f"reply from {self.name}",
            provider=self.name,
            model=self.default_model,
            input_tokens=10,
            output_tokens=5,
            latency_ms=1,
        )


def _settings_overrides(**overrides: object) -> object:
    settings = get_settings()
    return settings.model_copy(update=overrides)


async def test_successful_call_returns_completion(redis: Redis) -> None:
    primary = FakeProvider("groq")
    gateway = AIGateway({"groq": primary}, "groq", None, redis, _settings_overrides())
    result = await gateway.complete([AIMessage("user", "hi")], max_tokens=50)
    assert result.text == "reply from groq" and primary.calls == 1


async def test_transient_failure_is_retried_then_succeeds(redis: Redis) -> None:
    primary = FakeProvider("groq", fail_times=1)
    settings = _settings_overrides(ai_retry_base_seconds=0.01, ai_retry_cap_seconds=0.02)
    gateway = AIGateway({"groq": primary}, "groq", None, redis, settings)
    result = await gateway.complete([AIMessage("user", "hi")], max_tokens=50)
    assert result.text == "reply from groq" and primary.calls == 2


async def test_primary_exhausted_falls_back_to_secondary(redis: Redis) -> None:
    primary = FakeProvider("groq", always_fail_with=AIProviderError("down", status_code=500))
    fallback = FakeProvider("openai")
    settings = _settings_overrides(
        ai_max_attempts=2, ai_retry_base_seconds=0.01, ai_retry_cap_seconds=0.02
    )
    gateway = AIGateway({"groq": primary, "openai": fallback}, "groq", "openai", redis, settings)
    result = await gateway.complete([AIMessage("user", "hi")], max_tokens=50)
    assert result.provider == "openai"
    assert primary.calls == 2  # exhausted its own retry budget before falling back
    assert fallback.calls == 1


async def test_non_retryable_error_falls_back_immediately_without_retrying_primary(
    redis: Redis,
) -> None:
    primary = FakeProvider("groq", always_fail_with=AIProviderError("bad request", status_code=400))
    fallback = FakeProvider("openai")
    gateway = AIGateway(
        {"groq": primary, "openai": fallback}, "groq", "openai", redis, _settings_overrides()
    )
    result = await gateway.complete([AIMessage("user", "hi")], max_tokens=50)
    assert result.provider == "openai" and primary.calls == 1


async def test_all_providers_failing_raises_gateway_error(redis: Redis) -> None:
    primary = FakeProvider("groq", always_fail_with=AIProviderError("down", status_code=500))
    fallback = FakeProvider("openai", always_fail_with=AIProviderError("down too", status_code=500))
    settings = _settings_overrides(
        ai_max_attempts=1, ai_retry_base_seconds=0.01, ai_retry_cap_seconds=0.02
    )
    gateway = AIGateway({"groq": primary, "openai": fallback}, "groq", "openai", redis, settings)
    with pytest.raises(AIGatewayError):
        await gateway.complete([AIMessage("user", "hi")], max_tokens=50)


async def test_circuit_opens_after_threshold_and_skips_further_calls(redis: Redis) -> None:
    primary = FakeProvider("groq", always_fail_with=AIProviderError("down", status_code=500))
    settings = _settings_overrides(
        ai_max_attempts=1,
        ai_circuit_failure_threshold=2,
        ai_circuit_cooldown_seconds=30,
        ai_retry_base_seconds=0.01,
        ai_retry_cap_seconds=0.02,
    )
    gateway = AIGateway({"groq": primary}, "groq", None, redis, settings)
    for _ in range(2):
        with pytest.raises(AIGatewayError):
            await gateway.complete([AIMessage("user", "hi")], max_tokens=50)
    calls_before = primary.calls
    with pytest.raises(AIGatewayError):
        await gateway.complete([AIMessage("user", "hi")], max_tokens=50)
    # circuit is open: the provider must not have been called a third time
    assert primary.calls == calls_before


async def test_circuit_closes_on_success_after_being_tripped(redis: Redis) -> None:
    primary = FakeProvider("groq")
    settings = _settings_overrides(ai_circuit_failure_threshold=1)
    gateway = AIGateway({"groq": primary}, "groq", None, redis, settings)
    await gateway._circuit_breaker.record_failure("groq")
    # cooldown far in the future would normally block calls; force-reset via a success record
    await gateway._circuit_breaker.record_success("groq")
    result = await gateway.complete([AIMessage("user", "hi")], max_tokens=50)
    assert result.text == "reply from groq"


async def test_rate_limit_exceeded_prevents_the_call(redis: Redis) -> None:
    primary = FakeProvider("groq")
    settings = _settings_overrides(ai_rate_limit_per_minute=1, ai_max_attempts=1)
    gateway = AIGateway({"groq": primary}, "groq", None, redis, settings)
    first = await gateway.complete([AIMessage("user", "hi")], max_tokens=50)
    assert first.text == "reply from groq"
    with pytest.raises(AIGatewayError):
        await gateway.complete([AIMessage("user", "hi")], max_tokens=50)
    assert primary.calls == 1  # the second call never reached the provider


async def test_rate_limit_is_scoped_per_tenant(redis: Redis) -> None:
    primary = FakeProvider("groq")
    settings = _settings_overrides(
        ai_rate_limit_per_minute=100,  # generous provider-wide budget, shared by all tenants
        ai_rate_limit_per_minute_per_tenant=1,  # tight per-tenant budget
        ai_max_attempts=1,
    )
    gateway = AIGateway({"groq": primary}, "groq", None, redis, settings)
    org_a, org_b = str(uuid.uuid4()), str(uuid.uuid4())
    await gateway.complete([AIMessage("user", "hi")], max_tokens=50, organization_id=org_a)
    result_b = await gateway.complete(
        [AIMessage("user", "hi")], max_tokens=50, organization_id=org_b
    )
    assert result_b.text == "reply from groq" and primary.calls == 2

    # org_a's budget is now exhausted, but org_b (and the shared provider budget) is unaffected
    with pytest.raises(AIGatewayError):
        await gateway.complete([AIMessage("user", "hi")], max_tokens=50, organization_id=org_a)
    assert primary.calls == 2


async def test_provider_wide_limit_protects_shared_capacity_across_tenants(redis: Redis) -> None:
    primary = FakeProvider("groq")
    settings = _settings_overrides(
        ai_rate_limit_per_minute=1,  # tight shared provider budget
        ai_rate_limit_per_minute_per_tenant=100,
        ai_max_attempts=1,
    )
    gateway = AIGateway({"groq": primary}, "groq", None, redis, settings)
    org_a, org_b = str(uuid.uuid4()), str(uuid.uuid4())
    await gateway.complete([AIMessage("user", "hi")], max_tokens=50, organization_id=org_a)
    # org_b has its own per-tenant budget, but the shared provider-wide budget is already spent
    with pytest.raises(AIGatewayError):
        await gateway.complete([AIMessage("user", "hi")], max_tokens=50, organization_id=org_b)
    assert primary.calls == 1
