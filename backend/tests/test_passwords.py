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
