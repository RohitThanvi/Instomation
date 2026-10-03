import asyncio
from collections.abc import Mapping
from dataclasses import dataclass

import structlog
from redis.asyncio import Redis

from app.config.settings import Settings
from app.core.rate_limit import RateLimiter, RateLimitRule
from app.core.retry import RetryPolicy
from app.services.ai.circuit_breaker import CircuitBreaker, CircuitBreakerConfig, CircuitOpenError
from app.services.ai.provider import AICompletion, AIMessage, AIProvider, AIProviderError

logger = structlog.get_logger(__name__)


class AIGatewayError(Exception):
    """Every configured provider failed or was unavailable (circuit open, rate limited, no key)."""


@dataclass(frozen=True, slots=True)
class _Attempt:
    provider: str
    error: str


class AIGateway:
    """Single entry point for generating an AI completion.

    Per call: rate limit -> circuit breaker -> timeout -> retry-with-backoff against the primary
    provider; on exhaustion (or an open circuit) falls through to the configured fallback provider
    once. Never rotates API keys to dodge a rate limit — if a provider is throttled, the gateway
    waits, retries within its budget, or falls back; it does not try a different credential for the
    same provider.
    """

    def __init__(
        self,
        providers: Mapping[str, AIProvider],
        primary: str,
        fallback: str | None,
        redis: Redis,
        settings: Settings,
    ) -> None:
        self._providers = providers
        self._primary = primary
        self._fallback = fallback
        self._retry_policy = RetryPolicy(
            max_attempts=settings.ai_max_attempts,
            base_seconds=settings.ai_retry_base_seconds,
            cap_seconds=settings.ai_retry_cap_seconds,
        )
        self._rate_limiter = RateLimiter(redis, prefix="instomation:ai_rl")
        self._rate_limit_per_minute = settings.ai_rate_limit_per_minute
        self._rate_limit_per_minute_per_tenant = settings.ai_rate_limit_per_minute_per_tenant
        self._circuit_breaker = CircuitBreaker(
            redis,
            CircuitBreakerConfig(
                settings.ai_circuit_failure_threshold, settings.ai_circuit_cooldown_seconds
            ),
        )
        self._timeout_seconds = settings.ai_request_timeout_seconds

    async def complete(
        self,
        messages: list[AIMessage],
        *,
        max_tokens: int,
        temperature: float = 0.4,
        organization_id: str | None = None,
    ) -> AICompletion:
        attempts: list[_Attempt] = []
        order = [self._primary] + ([self._fallback] if self._fallback else [])
        for provider_name in order:
            provider = self._providers.get(provider_name)
            if provider is None:
                continue
            try:
                return await self._call_with_resilience(
                    provider, messages, max_tokens, temperature, organization_id
                )
            except (AIProviderError, CircuitOpenError) as exc:
                attempts.append(_Attempt(provider_name, str(exc)))
                logger.warning(
                    "ai_provider_failed", provider=provider_name, error=str(exc), falling_back=True
                )
        raise AIGatewayError(
            "All AI providers failed: " + "; ".join(f"{a.provider}: {a.error}" for a in attempts)
        )

    async def _call_with_resilience(
        self,
        provider: AIProvider,
        messages: list[AIMessage],
        max_tokens: int,
        temperature: float,
        organization_id: str | None,
    ) -> AICompletion:
        rules = [RateLimitRule("ai_provider", provider.name, self._rate_limit_per_minute, 60)]
        if organization_id:
            rules.append(
                RateLimitRule(
                    "ai_tenant", organization_id, self._rate_limit_per_minute_per_tenant, 60
                )
            )

        last_error: AIProviderError | None = None
        for attempt in range(1, self._retry_policy.max_attempts + 1):
            await self._circuit_breaker.before_call(provider.name)
            decision = await self._rate_limiter.hit(rules)
            if not decision.allowed:
                raise AIProviderError(
                    f"Rate limit exceeded ({decision.exceeded_scope}).",
                    status_code=429,
                    retry_after=decision.retry_after_seconds,
                )
            try:
                completion = await provider.complete(
                    messages,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    timeout_seconds=self._timeout_seconds,
                )
            except AIProviderError as exc:
                last_error = exc
                await self._circuit_breaker.record_failure(provider.name)
                if not exc.is_retryable or not self._retry_policy.should_retry(attempt):
                    raise
                await asyncio.sleep(self._retry_policy.delay(attempt, exc.retry_after))
                continue
            await self._circuit_breaker.record_success(provider.name)
            return completion
        assert last_error is not None
        raise last_error
