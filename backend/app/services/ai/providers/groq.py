import httpx

from app.services.ai.providers.openai_compatible import OpenAICompatibleProvider


class GroqProvider(OpenAICompatibleProvider):
    def __init__(
        self, client: httpx.AsyncClient, base_url: str, api_key: str, default_model: str
    ) -> None:
        super().__init__(client, "groq", base_url, api_key, default_model)
