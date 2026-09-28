import asyncio

import pytest
from redis.asyncio import Redis

from app.core.locks import (
    ConcurrencyLimitReachedError,
    LeaseSemaphore,
    LockNotAcquiredError,
    RedisLock,
    locked,
)
from app.core.rate_limit import RateLimiter, RateLimitRule


async def test_rate_limit_blocks_after_limit_and_reports_retry_after(redis: Redis) -> None:
    limiter = RateLimiter(redis)
    rule = RateLimitRule("tenant", "org-1", limit=3, window_seconds=60)
    assert all([(await limiter.hit([rule])).allowed for _ in range(3)])
    denied = await limiter.hit([rule])
    assert not denied.allowed
    assert denied.exceeded_scope == "tenant"
    assert 0 < denied.retry_after_seconds <= 60


async def test_denied_request_does_not_consume_outer_layers(redis: Redis) -> None:
    limiter = RateLimiter(redis)
    outer = RateLimitRule("tenant", "org-1", limit=10, window_seconds=60)
    inner = RateLimitRule("conversation", "c-1", limit=1, window_seconds=60)
    assert (await limiter.hit([outer, inner])).allowed
    denied = await limiter.hit([outer, inner])
    assert denied.exceeded_scope == "conversation"
    assert await redis.get("instomation:rl:tenant:org-1") == "1"


async def test_lock_is_exclusive_and_owner_only(redis: Redis) -> None:
    first = RedisLock(redis, "lock:c1", ttl_seconds=5)
    second = RedisLock(redis, "lock:c1", ttl_seconds=5)
    assert await first.acquire()
    assert not await second.acquire()
    assert not await second.release()
    assert await first.release()
    assert await second.acquire()


async def test_lock_expires_and_wait_acquires_after_release(redis: Redis) -> None:
    short = RedisLock(redis, "lock:c2", ttl_seconds=0.2)
    assert await short.acquire()
    waiter = RedisLock(redis, "lock:c2", ttl_seconds=5)
    assert await waiter.acquire(wait_seconds=1.0, retry_interval=0.05)


async def test_locked_context_manager_raises_when_held(redis: Redis) -> None:
    async with locked(redis, "lock:c3", ttl_seconds=5):
        with pytest.raises(LockNotAcquiredError):
            async with locked(redis, "lock:c3", ttl_seconds=5):
                pass
    async with locked(redis, "lock:c3", ttl_seconds=5):
        pass


async def test_semaphore_caps_concurrency_and_frees_slots(redis: Redis) -> None:
    semaphore = LeaseSemaphore(redis, "sem:acct", limit=2, lease_seconds=5)
    first, second = await semaphore.acquire(), await semaphore.acquire()
    assert first and second
    assert await semaphore.acquire() is None
    await semaphore.release(first)
    assert await semaphore.acquire() is not None
    with pytest.raises(ConcurrencyLimitReachedError):
        async with semaphore.slot():
            pass


async def test_semaphore_lease_expires_for_crashed_holders(redis: Redis) -> None:
    semaphore = LeaseSemaphore(redis, "sem:crash", limit=1, lease_seconds=0.2)
    assert await semaphore.acquire()
    assert await semaphore.acquire() is None
    await asyncio.sleep(0.3)
    assert await semaphore.acquire() is not None
