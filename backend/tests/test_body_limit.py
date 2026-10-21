from collections.abc import AsyncIterator

import httpx
from fastapi import FastAPI, Request

from app.core.body_limit import BodySizeLimitMiddleware
from app.core.errors import register_error_handlers

LIMIT = 100


def _client() -> tuple[httpx.AsyncClient, list[int]]:
    app = FastAPI()
    register_error_handlers(app)
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=LIMIT)
    reached: list[int] = []

    @app.post("/echo")
    async def echo(request: Request) -> dict[str, int]:
        body = await request.body()
        reached.append(len(body))
        return {"bytes": len(body)}

    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    return httpx.AsyncClient(transport=transport, base_url="http://test"), reached


async def _chunks(*sizes: int) -> AsyncIterator[bytes]:
    for size in sizes:
        yield b"x" * size


async def test_a_body_at_the_limit_is_accepted() -> None:
    client, reached = _client()
    async with client:
        response = await client.post("/echo", content=b"x" * LIMIT)
    assert response.status_code == 200 and reached == [LIMIT]


async def test_a_declared_oversized_body_is_refused_before_the_handler_runs() -> None:
    client, reached = _client()
    async with client:
        response = await client.post("/echo", content=b"x" * (LIMIT + 1))
    assert response.status_code == 413
    assert response.json() == {
        "error": {"code": "PAYLOAD_TOO_LARGE", "message": "The request body is too large."}
    }
    assert reached == []


async def test_a_streamed_body_is_cut_off_when_it_crosses_the_limit() -> None:
    client, reached = _client()
    async with client:
        # No Content-Length: the size is only known by counting what arrives.
        response = await client.post("/echo", content=_chunks(60, 60))
    assert response.status_code == 413
    assert reached == []


async def test_a_streamed_body_within_the_limit_is_accepted() -> None:
    client, reached = _client()
    async with client:
        response = await client.post("/echo", content=_chunks(50, 50))
    assert response.status_code == 200 and reached == [LIMIT]


async def test_a_malformed_content_length_is_refused() -> None:
    client, reached = _client()
    async with client:
        response = await client.post("/echo", content=b"x", headers={"Content-Length": "abc"})
    assert response.status_code == 413 and reached == []
