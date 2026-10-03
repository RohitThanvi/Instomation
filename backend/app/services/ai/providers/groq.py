import httpx

from app.services.ai.providers.openai_compatible import OpenAICompatibleProvider

_GROQ_BASE_URL = "https://api.groq.com/openai/v1"


class GroqProvider(OpenAICompatibleProvider):
    def __init__(self, client: httpx.AsyncClient, api_key: str, default_model: str) -> None:
        super().__init__(client, "groq", _GROQ_BASE_URL, api_key, default_model)
