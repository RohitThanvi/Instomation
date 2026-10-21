import pytest
from starlette.types import Scope

from app.core.client_ip import UNKNOWN_CLIENT, client_ip


def _scope(peer: str | None, *forwarded: str) -> Scope:
    return {
        "type": "http",
        "client": (peer, 5000) if peer is not None else None,
        "headers": [(b"x-forwarded-for", value.encode()) for value in forwarded],
    }


def test_without_a_trusted_proxy_the_peer_is_the_client_whatever_the_header_says() -> None:
    assert client_ip(_scope("203.0.113.9", "198.51.100.1"), 0) == "203.0.113.9"


def test_with_one_proxy_the_client_is_the_entry_that_proxy_appended() -> None:
    assert client_ip(_scope("10.0.0.2", "198.51.100.1"), 1) == "198.51.100.1"


def test_entries_the_client_put_on_the_left_are_ignored() -> None:
    # The client claims to be 1.1.1.1; the trusted proxy then appended the real address.
    assert client_ip(_scope("10.0.0.2", "1.1.1.1, 198.51.100.1"), 1) == "198.51.100.1"


def test_with_two_proxies_the_client_is_second_from_the_right() -> None:
    assert client_ip(_scope("10.0.0.3", "1.1.1.1, 198.51.100.1, 10.0.0.2"), 2) == "198.51.100.1"


def test_repeated_header_lines_are_read_as_one_list() -> None:
    assert client_ip(_scope("10.0.0.3", "1.1.1.1", "198.51.100.1, 10.0.0.2"), 2) == "198.51.100.1"


def test_a_header_shorter_than_the_proxy_chain_is_not_trusted() -> None:
    assert client_ip(_scope("203.0.113.9", "198.51.100.1"), 2) == "203.0.113.9"
    assert client_ip(_scope("203.0.113.9"), 1) == "203.0.113.9"


def test_an_entry_that_is_not_an_address_is_not_trusted() -> None:
    assert client_ip(_scope("203.0.113.9", "not-an-ip"), 1) == "203.0.113.9"


def test_ipv6_is_normalised_so_one_client_has_one_identity() -> None:
    assert client_ip(_scope("10.0.0.2", "2001:DB8:0:0:0:0:0:1"), 1) == "2001:db8::1"


@pytest.mark.parametrize("trusted", [0, 1])
def test_a_missing_peer_is_named_rather_than_crashing(trusted: int) -> None:
    assert client_ip(_scope(None), trusted) == UNKNOWN_CLIENT
