from fastapi import APIRouter, Request, Response, status
from sqlalchemy import text

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    """Liveness: the process is up. Performs no dependency checks."""
    return {"status": "ok"}


@router.get("/ready")
async def ready(request: Request, response: Response) -> dict[str, str]:
    """Readiness: reports database and Redis health without exposing diagnostics."""
    checks = {"database": "ok", "redis": "ok"}
    try:
        async with request.app.state.engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception:  # noqa: BLE001 - any failure means not ready
        checks["database"] = "unavailable"
    try:
        await request.app.state.redis.ping()
    except Exception:  # noqa: BLE001
        checks["redis"] = "unavailable"
    healthy = all(v == "ok" for v in checks.values())
    if not healthy:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {"status": "ready" if healthy else "degraded", **checks}
