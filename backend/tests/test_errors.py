from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.errors import AppError, register_error_handlers


def test_app_error_uses_standard_envelope() -> None:
    app = FastAPI()
    register_error_handlers(app)

    @app.get("/boom")
    async def boom() -> None:
        raise AppError(
            "INSTAGRAM_CONNECTION_EXPIRED",
            "Your Instagram connection needs to be renewed.",
            401,
        )

    response = TestClient(app).get("/boom")
    assert response.status_code == 401
    assert response.json() == {
        "error": {
            "code": "INSTAGRAM_CONNECTION_EXPIRED",
            "message": "Your Instagram connection needs to be renewed.",
        }
    }
