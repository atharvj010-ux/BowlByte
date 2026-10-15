from starlette.requests import Request

from app.api.deps import client_key
from app.core.config import get_settings
from app.core.security import hash_password, hash_secret, verify_password


def test_password_hash_uses_argon2id_and_verifies() -> None:
    stored = hash_password("correct-horse-battery")

    assert stored != "correct-horse-battery"
    assert stored.startswith("$argon2id$")
    assert verify_password("correct-horse-battery", stored)
    assert not verify_password("wrong-horse-battery", stored)


def test_secret_hash_does_not_keep_the_raw_value() -> None:
    raw = "session-token-value"
    stored = hash_secret(raw)

    assert raw not in stored
    assert len(stored) == 64


def test_forwarded_client_header_is_ignored_without_the_proxy_secret() -> None:
    settings = get_settings()
    settings.proxy_shared_secret = ""
    request = Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": "/",
            "raw_path": b"/",
            "query_string": b"",
            "headers": [
                (b"x-bowlbyte-proxy", b"dev-proxy-secret"),
                (b"x-bowlbyte-client", b"203.0.113.8"),
            ],
            "client": ("127.0.0.1", 1234),
            "server": ("test", 80),
        }
    )

    assert client_key(request) == "127.0.0.1"


def _request(headers: list[tuple[bytes, bytes]], peer: str = "10.0.0.8") -> Request:
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": "/",
            "raw_path": b"/",
            "query_string": b"",
            "headers": headers,
            "client": (peer, 1234),
            "server": ("test", 80),
        }
    )


def test_trusted_proxy_label_is_a_canonical_ip() -> None:
    settings = get_settings()
    settings.proxy_shared_secret = "dev-proxy-secret"
    request = _request(
        [
            (b"x-bowlbyte-proxy", b"dev-proxy-secret"),
            (b"x-bowlbyte-client", b"2001:db8::1"),
            (b"x-forwarded-for", b"198.51.100.9"),
        ]
    )

    assert client_key(request) == "2001:db8::1"


def test_spoofed_forwarded_header_does_not_change_the_peer() -> None:
    settings = get_settings()
    settings.proxy_shared_secret = "dev-proxy-secret"
    request = _request([(b"x-forwarded-for", b"203.0.113.50, 198.51.100.2")], peer="172.18.0.4")

    assert client_key(request) == "172.18.0.4"


def test_proxy_label_that_is_not_an_ip_is_ignored() -> None:
    settings = get_settings()
    settings.proxy_shared_secret = "dev-proxy-secret"
    request = _request(
        [
            (b"x-bowlbyte-proxy", b"dev-proxy-secret"),
            (b"x-bowlbyte-client", b"web"),
        ],
        peer="127.0.0.1",
    )

    assert client_key(request) == "127.0.0.1"
