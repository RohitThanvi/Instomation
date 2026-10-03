import time
from typing import Any

import httpx

from app.services.ai.provider import AICompletion, AIMessage, AIProviderError


class OpenAICompatibleProvider:
    """Base for any provider exposing an OpenAI-style `/chat/completions` endpoint (OpenAI itself,
    Groq, and most other inference hosts). Subclasses just set the name, base URL, key and model.
    """

    def __init__(
        self, client: httpx.AsyncClient, name: str, base_url: str, api_key: str, default_model: str
    ) -> None:
        self._client = client
        self.name = name
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self.default_model = default_model

    async def complete(
        self,
        messages: list[AIMessage],
        *,
        model: str | None = None,
        max_tokens: int,
        temperature: float,
        timeout_seconds: float,
    ) -> AICompletion:
        if not self._api_key:
            raise AIProviderError(f"{self.name} API key is not configured.", status_code=0)
        started = time.perf_counter()
        try:
            response = await self._client.post(
                f"{self._base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self._api_key}"},
                json={
                    "model": model or self.default_model,
                    "messages": [{"role": m.role, "content": m.content} for m in messages],
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                },
                timeout=timeout_seconds,
            )
        except httpx.TimeoutException as exc:
            raise AIProviderError(f"{self.name} request timed out.", status_code=0) from exc
        except httpx.TransportError as exc:
            raise AIProviderError(f"Could not reach {self.name}.", status_code=0) from exc

        try:
            body: dict[str, Any] = response.json()
        except ValueError:
            body = {}
        if not response.is_success:
            retry_header = response.headers.get("Retry-After")
            message = (body.get("error") or {}).get("message") or f"{self.name} request failed."
            raise AIProviderError(
                message,
                status_code=response.status_code,
                retry_after=float(retry_header)
                if retry_header and retry_header.isdigit()
                else None,
            )

        try:
            choice = body["choices"][0]["message"]["content"]
            usage = body.get("usage") or {}
        except (KeyError, IndexError, TypeError) as exc:
            raise AIProviderError(
                f"{self.name} returned an unexpected response.", status_code=502
            ) from exc

        return AICompletion(
            text=choice or "",
            provider=self.name,
            model=body.get("model", model or self.default_model),
            input_tokens=int(usage.get("prompt_tokens", 0)),
            output_tokens=int(usage.get("completion_tokens", 0)),
            latency_ms=int((time.perf_counter() - started) * 1000),
        )
