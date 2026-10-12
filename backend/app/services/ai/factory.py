import httpx
from redis.asyncio import Redis

from app.config.settings import Settings
from app.services.ai.gateway import AIGateway
from app.services.ai.providers.groq import GroqProvider
from app.services.ai.providers.openai import OpenAIProvider


def build_ai_gateway(http_client: httpx.AsyncClient, redis: Redis, settings: Settings) -> AIGateway:
    """The one place providers are wired from settings, shared by the API and every worker."""
    return AIGateway(
        {
            "groq": GroqProvider(
                http_client,
                settings.groq_base_url,
                settings.groq_api_key.get_secret_value(),
                settings.groq_model,
            ),
            "openai": OpenAIProvider(
                http_client,
                settings.openai_base_url,
                settings.openai_api_key.get_secret_value(),
                settings.openai_model,
            ),
        },
        settings.ai_primary_provider,
        settings.ai_fallback_provider,
        redis,
        settings,
    )
