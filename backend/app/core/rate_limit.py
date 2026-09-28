from collections.abc import Sequence
from dataclasses import dataclass

from redis.asyncio import Redis

# Atomically checks every rule first and consumes only if all pass, so a request denied by an
# inner layer never inflates the counters of outer layers. Fixed windows (burst of up to 2x
# across a window boundary is accepted). All keys must live on one Redis instance.
_HIT_ALL = """
for i = 1, #KEYS do
  local current = tonumber(redis.call('GET', KEYS[i]) or '0')
  if current + 1 > tonumber(ARGV[2 * i - 1]) then
    return {i, redis.call('PTTL', KEYS[i])}
  end
end
for i = 1, #KEYS do
  if redis.call('INCR', KEYS[i]) == 1 then
    redis.call('PEXPIRE', KEYS[i], ARGV[2 * i])
  end
end
return {0, 0}
"""


@dataclass(frozen=True, slots=True)
class RateLimitRule:
    scope: str  # e.g. "global", "tenant", "ig_account", "conversation", "ai_provider"
    key: str
    limit: int
    window_seconds: int


@dataclass(frozen=True, slots=True)
class RateLimitDecision:
    allowed: bool
    exceeded_scope: str | None = None
    retry_after_seconds: float = 0.0


class RateLimiter:
    def __init__(self, redis: Redis, prefix: str = "instomation:rl") -> None:
        self._redis = redis
        self._prefix = prefix
        self._script = redis.register_script(_HIT_ALL)

    async def hit(self, rules: Sequence[RateLimitRule]) -> RateLimitDecision:
        """Consume one unit from every rule, outermost layer first, or none if any is exhausted."""
        if not rules:
            return RateLimitDecision(allowed=True)
        keys = [f"{self._prefix}:{rule.scope}:{rule.key}" for rule in rules]
        args: list[int] = []
        for rule in rules:
            args.extend((rule.limit, rule.window_seconds * 1000))
        failed_index, ttl_ms = await self._script(keys=keys, args=args)
        if failed_index == 0:
            return RateLimitDecision(allowed=True)
        return RateLimitDecision(
            allowed=False,
            exceeded_scope=rules[failed_index - 1].scope,
            retry_after_seconds=max(ttl_ms, 0) / 1000,
        )
