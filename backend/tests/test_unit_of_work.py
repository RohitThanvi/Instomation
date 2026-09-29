from typing import Any

import httpx
from fastapi import FastAPI

from app.api.deps import SessionDep
from app.core.errors import register_error_handlers


class _Session:
    def __init__(self, fail_commit: bool) -> None:
        self.fail_commit = fail_commit
        self.committed = False
        self.rolled_back = False

    async def commit(self) -> None:
        if self.fail_commit:
            raise RuntimeError("commit failed")
        self.committed = True

    async def rollback(self) -> None:
        self.rolled_back = True

    async def __aenter__(self) -> "_Session":
        return self

    async def __aexit__(self, *_: Any) -> bool:
        return False


def _app(session: _Session) -> FastAPI:
    app = FastAPI()
    register_error_handlers(app)
    app.state.session_factory = lambda: session

    @app.post("/create", status_code=201)
    async def create(_: SessionDep) -> dict[str, bool]:
        return {"created": True}

    return app


async def _post(app: FastAPI) -> httpx.Response:
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.post("/create")


async def test_failed_commit_is_reported_not_swallowed_as_success() -> None:
    session = _Session(fail_commit=True)
    response = await _post(_app(session))
    assert response.status_code == 500
    assert session.rolled_back


async def test_successful_request_commits() -> None:
    session = _Session(fail_commit=False)
    response = await _post(_app(session))
    assert response.status_code == 201 and session.committed
