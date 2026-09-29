import httpx
import pytest
from fastapi import FastAPI

from app.core.errors import register_error_handlers
from app.core.middleware import REQUEST_ID_HEADER, RequestContextMiddleware


def _client() -> httpx.AsyncClient:
    app = FastAPI()
    register_error_handlers(app)
    app.add_middleware(RequestContextMiddleware)

    @app.get("/ok")
    async def ok() -> dict[str, bool]:
        return {"ok": True}

    @app.get("/boom")
    async def boom() -> None:
        raise RuntimeError("internal detail that must not leak")

    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


async def test_unhandled_error_returns_envelope_with_request_id_and_security_headers() -> None:
    async with _client() as client:
        response = await client.get("/boom", headers={REQUEST_ID_HEADER: "trace-abc-12345"})
    assert response.status_code == 500
    assert response.json() == {
        "error": {"code": "INTERNAL_ERROR", "message": "Something went wrong on our side."}
    }
    assert response.headers[REQUEST_ID_HEADER] == "trace-abc-12345"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert "internal detail" not in response.text


@pytest.mark.parametrize("supplied", ["short", "has space in it", "x" * 65, "inj\\r\\nected-id"])
async def test_unsafe_client_request_ids_are_replaced(supplied: str) -> None:
    async with _client() as client:
        response = await client.get("/ok", headers={REQUEST_ID_HEADER: supplied})
    assert response.headers[REQUEST_ID_HEADER] != supplied
    assert len(response.headers[REQUEST_ID_HEADER]) == 32


async def test_safe_client_request_id_is_preserved() -> None:
    async with _client() as client:
        response = await client.get("/ok", headers={REQUEST_ID_HEADER: "abc-123_DEF.456"})
    assert response.headers[REQUEST_ID_HEADER] == "abc-123_DEF.456"
