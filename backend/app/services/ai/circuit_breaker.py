import time
from dataclasses import dataclass

from redis.asyncio import Redis

# Atomic check-and-record so concurrent requests against the same provider see a consistent
# open/closed decision and never race on the failure counter.
_RECORD_OUTCOME = """
local failures_key, opened_key = KEYS[1], KEYS[2]
local success = ARGV[1]
local threshold, cooldown_ms, now = tonumber(ARGV[2]), tonumber(ARGV[3]), tonumber(ARGV[4])
if success == '1' then
  redis.call('DEL', failures_key)
  redis.call('DEL', opened_key)
  return 0
end
local failures = redis.call('INCR', failures_key)
redis.call('PEXPIRE', failures_key, cooldown_ms)
if failures >= threshold then
  redis.call('SET', opened_key, now, 'PX', cooldown_ms)
  return 1
end
return 0
"""


@dataclass(frozen=True, slots=True)
class CircuitBreakerConfig:
    failure_threshold: int
    cooldown_seconds: int


class CircuitOpenError(Exception):
    """Raised instead of calling a provider that has tripped its breaker."""

    def __init__(self, provider: str, retry_after_seconds: float) -> None:
        super().__init__(f"{provider} circuit is open")
        self.provider = provider
        self.retry_after_seconds = retry_after_seconds


class CircuitBreaker:
    """Per-provider failure tracking in Redis: after `failure_threshold` consecutive failures the
    provider is skipped for `cooldown_seconds`, so a struggling provider doesn't keep adding retry
    latency to every request while it is down. A single success anywhere resets the count."""

    def __init__(
        self, redis: Redis, config: CircuitBreakerConfig, prefix: str = "instomation:ai_cb"
    ) -> None:
        self._redis = redis
        self._config = config
        self._prefix = prefix
        self._record = redis.register_script(_RECORD_OUTCOME)

    def _keys(self, provider: str) -> tuple[str, str]:
        return f"{self._prefix}:{provider}:failures", f"{self._prefix}:{provider}:opened"

    async def before_call(self, provider: str) -> None:
        _, opened_key = self._keys(provider)
        opened_at = await self._redis.get(opened_key)
        if opened_at is None:
            return
        ttl_ms = await self._redis.pttl(opened_key)
        raise CircuitOpenError(provider, max(ttl_ms, 0) / 1000)

    async def record_success(self, provider: str) -> None:
        failures_key, opened_key = self._keys(provider)
        await self._record(
            keys=[failures_key, opened_key],
            args=[
                "1",
                self._config.failure_threshold,
                self._config.cooldown_seconds * 1000,
                time.time(),
            ],
        )

    async def record_failure(self, provider: str) -> None:
        failures_key, opened_key = self._keys(provider)
        await self._record(
            keys=[failures_key, opened_key],
            args=[
                "0",
                self._config.failure_threshold,
                self._config.cooldown_seconds * 1000,
                time.time(),
            ],
        )
