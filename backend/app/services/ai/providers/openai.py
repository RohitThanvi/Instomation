import httpx

from app.services.ai.providers.openai_compatible import OpenAICompatibleProvider

_OPENAI_BASE_URL = "https://api.openai.com/v1"


class OpenAIProvider(OpenAICompatibleProvider):
    def __init__(self, client: httpx.AsyncClient, api_key: str, default_model: str) -> None:
        super().__init__(client, "openai", _OPENAI_BASE_URL, api_key, default_model)
