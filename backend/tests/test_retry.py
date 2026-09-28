import pytest

from app.core.retry import RetryPolicy

POLICY = RetryPolicy(max_attempts=5, base_seconds=1.0, cap_seconds=8.0)


@pytest.mark.parametrize(
    ("attempt", "expected"), [(1, 1.0), (2, 2.0), (3, 4.0), (4, 8.0), (5, 8.0)]
)
def test_delay_doubles_and_is_capped(attempt: int, expected: float) -> None:
    assert POLICY.delay(attempt, rng=lambda: 1.0) == expected


def test_jitter_stays_within_half_to_full_delay() -> None:
    assert POLICY.delay(3, rng=lambda: 0.0) == 2.0
    assert POLICY.delay(3, rng=lambda: 1.0) == 4.0


def test_retry_after_from_provider_wins_when_larger() -> None:
    assert POLICY.delay(1, retry_after=30.0, rng=lambda: 1.0) == 30.0
    assert POLICY.delay(4, retry_after=1.0, rng=lambda: 1.0) == 8.0


def test_retries_are_bounded() -> None:
    assert POLICY.should_retry(4)
    assert not POLICY.should_retry(5)
