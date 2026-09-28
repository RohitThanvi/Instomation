import asyncio
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from redis.asyncio import Redis

_RELEASE = """
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
"""
_EXTEND = """
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
return 0
"""
# Lease semaphore: holders are a sorted set scored by expiry (Redis clock), so crashed workers
# release their slot automatically when the lease lapses.
_ACQUIRE_SLOT = """
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZCARD', KEYS[1]) < tonumber(ARGV[1]) then
  redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[3])
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return 1
end
return 0
"""


class LockNotAcquiredError(Exception):
    pass


class ConcurrencyLimitReachedError(Exception):
    pass


class RedisLock:
    """Single-owner lock with TTL. Only the holder's token can release or extend it."""

    def __init__(self, redis: Redis, key: str, ttl_seconds: float) -> None:
        self._redis = redis
        self._key = key
        self._ttl_ms = int(ttl_seconds * 1000)
        self._token = uuid.uuid4().hex
        self._release = redis.register_script(_RELEASE)
        self._extend = redis.register_script(_EXTEND)

    async def acquire(self, wait_seconds: float = 0.0, retry_interval: float = 0.1) -> bool:
        deadline = time.monotonic() + wait_seconds
        while True:
            if await self._redis.set(self._key, self._token, nx=True, px=self._ttl_ms):
                return True
            if time.monotonic() >= deadline:
                return False
            await asyncio.sleep(retry_interval)

    async def extend(self) -> bool:
        return bool(await self._extend(keys=[self._key], args=[self._token, self._ttl_ms]))

    async def release(self) -> bool:
        return bool(await self._release(keys=[self._key], args=[self._token]))


@asynccontextmanager
async def locked(
    redis: Redis, key: str, ttl_seconds: float, wait_seconds: float = 0.0
) -> AsyncIterator[RedisLock]:
    """Hold `key` for the block, e.g. one lock per conversation to keep replies ordered."""
    lock = RedisLock(redis, key, ttl_seconds)
    if not await lock.acquire(wait_seconds=wait_seconds):
        raise LockNotAcquiredError(key)
    try:
        yield lock
    finally:
        await lock.release()


class LeaseSemaphore:
    """Caps concurrent work per key (per IG account, per provider, globally)."""

    def __init__(self, redis: Redis, key: str, limit: int, lease_seconds: float) -> None:
        self._redis = redis
        self._key = key
        self._limit = limit
        self._lease_ms = int(lease_seconds * 1000)
        self._acquire = redis.register_script(_ACQUIRE_SLOT)

    async def acquire(self) -> str | None:
        token = uuid.uuid4().hex
        granted = await self._acquire(keys=[self._key], args=[self._limit, self._lease_ms, token])
        return token if granted else None

    async def release(self, token: str) -> None:
        await self._redis.zrem(self._key, token)

    @asynccontextmanager
    async def slot(self) -> AsyncIterator[None]:
        token = await self.acquire()
        if token is None:
            raise ConcurrencyLimitReachedError(self._key)
        try:
            yield
        finally:
            await self.release(token)
