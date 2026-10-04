import httpx
import pytest

from app.services.ai.pricing import estimate_cost
from app.services.ai.provider import AIMessage, AIProviderError
from app.services.ai.providers.groq import GroqProvider
from app.services.ai.providers.openai import OpenAIProvider

MESSAGES = [AIMessage(role="user", content="hi")]


def _provider(handler: httpx.MockTransport, cls: type = GroqProvider) -> GroqProvider:
    return cls(
        httpx.AsyncClient(transport=handler), "https://provider.test/v1", "test-key", "test-model"
    )


async def test_successful_completion_parses_text_and_usage() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer test-key"
        return httpx.Response(
            200,
            json={
                "model": "test-model",
                "choices": [{"message": {"content": "hello there"}}],
                "usage": {"prompt_tokens": 5, "completion_tokens": 3},
            },
        )

    provider = _provider(httpx.MockTransport(handler))
    result = await provider.complete(MESSAGES, max_tokens=50, temperature=0.4, timeout_seconds=5)
    assert result.text == "hello there"
    assert (result.input_tokens, result.output_tokens) == (5, 3)
    assert result.provider == "groq" and result.model == "test-model"


async def test_missing_api_key_fails_without_a_request() -> None:
    called = False

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(200, json={})

    provider = GroqProvider(
        httpx.AsyncClient(transport=httpx.MockTransport(handler)), "https://groq.test/v1", "", "m"
    )
    with pytest.raises(AIProviderError):
        await provider.complete(MESSAGES, max_tokens=10, temperature=0, timeout_seconds=5)
    assert not called


@pytest.mark.parametrize(
    ("status", "headers", "retryable", "rate_limited"),
    [
        (429, {"Retry-After": "7"}, True, True),
        (500, {}, True, False),
        (400, {}, False, False),
        (401, {}, False, False),
    ],
)
async def test_http_errors_are_classified(
    status: int, headers: dict[str, str], retryable: bool, rate_limited: bool
) -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json={"error": {"message": "nope"}}, headers=headers)

    provider = _provider(httpx.MockTransport(handler))
    with pytest.raises(AIProviderError) as exc:
        await provider.complete(MESSAGES, max_tokens=10, temperature=0, timeout_seconds=5)
    assert exc.value.is_retryable is retryable
    assert exc.value.is_rate_limited is rate_limited
    if status == 429:
        assert exc.value.retry_after == 7.0


async def test_timeout_is_retryable() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("slow")

    provider = _provider(httpx.MockTransport(handler))
    with pytest.raises(AIProviderError) as exc:
        await provider.complete(MESSAGES, max_tokens=10, temperature=0, timeout_seconds=5)
    assert exc.value.is_retryable


async def test_malformed_response_body_is_a_clean_error_not_a_crash() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"unexpected": "shape"})

    provider = _provider(httpx.MockTransport(handler))
    with pytest.raises(AIProviderError):
        await provider.complete(MESSAGES, max_tokens=10, temperature=0, timeout_seconds=5)


async def test_openai_provider_uses_its_own_base_url() -> None:
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(200, json={"choices": [{"message": {"content": "hi"}}], "usage": {}})

    provider = OpenAIProvider(
        httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        "https://api.openai.com/v1",
        "k",
        "gpt-4o-mini",
    )
    await provider.complete(MESSAGES, max_tokens=10, temperature=0, timeout_seconds=5)
    assert seen == ["https://api.openai.com/v1/chat/completions"]


def test_pricing_known_model() -> None:
    cost = estimate_cost("openai", "gpt-4o-mini", input_tokens=1000, output_tokens=1000)
    assert cost > 0


def test_pricing_unknown_model_is_zero_not_an_error() -> None:
    assert estimate_cost("groq", "some-future-model", 1000, 1000) == 0
