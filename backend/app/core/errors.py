import structlog
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DBAPIError
from sqlalchemy.exc import TimeoutError as PoolTimeoutError
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = structlog.get_logger(__name__)
# PostgreSQL SQLSTATE for a cancelled query, which is also how a statement timeout surfaces.
_QUERY_CANCELED = "57014"


class AppError(Exception):
    """Domain error rendered as the standard `{"error": {...}}` envelope."""

    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = 400,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.headers = headers


def error_response(
    code: str, message: str, status_code: int, headers: dict[str, str] | None = None
) -> JSONResponse:
    body = {"error": {"code": code, "message": message}}
    return JSONResponse(status_code=status_code, content=body, headers=headers)


def busy_response() -> JSONResponse:
    return error_response(
        "SERVICE_BUSY", "The service is busy. Try again in a moment.", 503, {"Retry-After": "1"}
    )


def internal_error_response() -> JSONResponse:
    return error_response("INTERNAL_ERROR", "Something went wrong on our side.", 500)


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return error_response(exc.code, exc.message, exc.status_code, exc.headers)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, __: RequestValidationError) -> JSONResponse:
        return error_response("VALIDATION_ERROR", "The request contains invalid data.", 422)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        return error_response("HTTP_ERROR", str(exc.detail), exc.status_code)

    @app.exception_handler(PoolTimeoutError)
    async def _pool_exhausted(_: Request, __: PoolTimeoutError) -> JSONResponse:
        # Every pooled connection is in use and the wait ran out: turn the request away quickly
        # rather than queueing it behind the rest.
        logger.warning("database_pool_exhausted")
        return busy_response()

    @app.exception_handler(DBAPIError)
    async def _database_error(_: Request, exc: DBAPIError) -> JSONResponse:
        if getattr(exc.orig, "pgcode", None) == _QUERY_CANCELED:
            logger.warning("database_statement_timeout")
            return busy_response()
        logger.error("unhandled_exception", exc_info=exc)
        return internal_error_response()

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        logger.error("unhandled_exception", exc_info=exc)
        return internal_error_response()
