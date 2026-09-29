import re
import time
import uuid

import structlog
from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.errors import internal_error_response

logger = structlog.get_logger(__name__)
REQUEST_ID_HEADER = "X-Request-ID"
_VALID_REQUEST_ID = re.compile(r"[A-Za-z0-9._-]{8,64}")
_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
}


class RequestContextMiddleware:
    """Request ID, structured access log and security headers on *every* response, including 500s.

    Implemented as pure ASGI (not BaseHTTPMiddleware) so unhandled errors are converted here,
    inside the middleware, and therefore still carry the headers. Client-supplied request IDs
    are accepted only if they are short and log-safe.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        supplied = Headers(scope=scope).get(REQUEST_ID_HEADER, "")
        request_id = supplied if _VALID_REQUEST_ID.fullmatch(supplied) else uuid.uuid4().hex
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=request_id)
        started = time.perf_counter()
        status_code = 500
        response_started = False

        async def send_with_headers(message: Message) -> None:
            nonlocal status_code, response_started
            if message["type"] == "http.response.start":
                response_started = True
                status_code = message["status"]
                headers = MutableHeaders(scope=message)
                headers[REQUEST_ID_HEADER] = request_id
                for name, value in _SECURITY_HEADERS.items():
                    headers[name] = value
            await send(message)

        try:
            await self.app(scope, receive, send_with_headers)
        except Exception:
            logger.exception("unhandled_exception")
            if response_started:
                raise
            await internal_error_response()(scope, receive, send_with_headers)
        finally:
            logger.info(
                "request_completed",
                method=scope["method"],
                path=scope["path"],
                status=status_code,
                duration_ms=round((time.perf_counter() - started) * 1000, 2),
            )
