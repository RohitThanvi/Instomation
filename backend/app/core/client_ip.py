import ipaddress

from starlette.datastructures import Headers
from starlette.types import Scope

UNKNOWN_CLIENT = "unknown"


def client_ip(scope: Scope, trusted_proxy_count: int) -> str:
    """The caller's address, trusting exactly `trusted_proxy_count` proxies and no more.

    Each trusted proxy appends the address it received the request from to X-Forwarded-For, so with
    N of them the real client is the Nth entry from the right; anything to its left was supplied
    by the client and is ignored. A header that is shorter than that, or whose entry is not an IP
    address, did not come through the expected proxies, so the TCP peer is used instead.
    """
    client = scope.get("client")
    peer = client[0] if client else UNKNOWN_CLIENT
    if trusted_proxy_count == 0:
        return peer
    forwarded = Headers(scope=scope).getlist("x-forwarded-for")
    hops = [hop.strip() for value in forwarded for hop in value.split(",") if hop.strip()]
    if len(hops) < trusted_proxy_count:
        return peer
    try:
        return str(ipaddress.ip_address(hops[-trusted_proxy_count]))
    except ValueError:
        return peer
