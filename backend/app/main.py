from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from arq import create_pool
from arq.connections import RedisSettings
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from redis.asyncio import Redis

from app.api.v1 import api_router, health
from app.config.settings import get_settings
from app.core.errors import register_error_handlers
from app.core.logging import configure_logging
from app.core.middleware import RequestContextMiddleware
from app.core.security import ClerkTokenVerifier, http_jwks_fetcher
from app.db.session import create_engine, create_session_factory
from app.workers.queue import JobQueue


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    app.state.engine = create_engine(settings)
    app.state.session_factory = create_session_factory(app.state.engine)
    app.state.redis = Redis.from_url(settings.redis_url, decode_responses=True)
    arq_pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    app.state.job_queue = JobQueue(arq_pool, app.state.session_factory)
    http_client = httpx.AsyncClient()
    app.state.token_verifier = ClerkTokenVerifier(
        fetch_jwks=http_jwks_fetcher(settings.clerk_jwks_url, http_client),
        issuer=settings.clerk_issuer,
        authorized_parties=settings.clerk_authorized_parties,
        cache_seconds=settings.clerk_jwks_cache_seconds,
        min_refetch_seconds=settings.clerk_jwks_min_refetch_seconds,
    )
    try:
        yield
    finally:
        await http_client.aclose()
        await arq_pool.aclose()
        await app.state.redis.aclose()
        await app.state.engine.dispose()


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)
    app = FastAPI(
        title="Instomation API",
        lifespan=lifespan,
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID", "X-Organization-ID"],
    )
    app.add_middleware(RequestContextMiddleware)
    register_error_handlers(app)
    app.include_router(health.router)
    app.include_router(api_router)
    return app


app = create_app()
