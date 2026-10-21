from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.client_ip import client_ip
from app.core.errors import error_response
from app.core.rate_limit import (
    WINDOW_SECONDS,
    RateLimitRule,
    rate_limited_error,
    retry_after_if_limited,
)


class IpRateLimitMiddleware:
    """A flood guard per client address, applied before authentication.

    Probes and Meta's signed webhook deliveries are exempt (many accounts' events arrive from a
    few addresses, and the webhook has its own signature gate); CORS preflights never reach here.
    """

    def __init__(
        self,
        app: ASGIApp,
        *,
        limit_per_minute: int,
        trusted_proxy_count: int,
        exempt_prefixes: tuple[str, ...],
    ) -> None:
        self.app = app
        self.limit_per_minute = limit_per_minute
        self.trusted_proxy_count = trusted_proxy_count
        self.exempt_prefixes = exempt_prefixes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["path"].startswith(self.exempt_prefixes):
            await self.app(scope, receive, send)
            return
        rule = RateLimitRule(
            "http_ip",
            client_ip(scope, self.trusted_proxy_count),
            self.limit_per_minute,
            WINDOW_SECONDS,
        )
        retry_after = await retry_after_if_limited(scope["app"].state, rule)
        if retry_after is not None:
            error = rate_limited_error(retry_after)
            response = error_response(error.code, error.message, error.status_code, error.headers)
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)
