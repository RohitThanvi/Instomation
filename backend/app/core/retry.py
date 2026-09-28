import random
from collections.abc import Callable
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class RetryPolicy:
    """Bounded exponential backoff with jitter; honors provider `Retry-After`."""

    max_attempts: int
    base_seconds: float
    cap_seconds: float

    def should_retry(self, attempt: int) -> bool:
        return attempt < self.max_attempts

    def delay(
        self,
        attempt: int,
        retry_after: float | None = None,
        rng: Callable[[], float] = random.random,
    ) -> float:
        """Seconds to wait after the given 1-based failed attempt.

        Delay is base * 2^(attempt-1), capped, then scaled by a jitter factor in [0.5, 1.0] so
        concurrent retries do not synchronize. A larger server-provided Retry-After always wins.
        """
        exponential = min(self.cap_seconds, self.base_seconds * 2 ** (attempt - 1))
        jittered = exponential * (0.5 + 0.5 * rng())
        if retry_after is None:
            return jittered
        return float(max(jittered, retry_after))
