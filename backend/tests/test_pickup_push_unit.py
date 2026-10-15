"""Unit tests that need no database: credential codes, endpoint safety, retry maths,
and a real VAPID/RFC 8291 transport run against a stubbed HTTP layer."""

import base64
import json
import socket

import http_ece
import pytest
import requests
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from app.cli.generate_vapid import generate
from app.core.config import Settings, get_settings
from app.core.errors import ApiError
from app.services import push_delivery
from app.services.pickup import (
    CODE_ALPHABET,
    TOKEN_PREFIX,
    keyed_hash,
    new_code,
    new_token,
    normalize_code,
)
from app.services.push import SIMULATOR_HOST, validate_endpoint, validate_keys
from app.services.push_delivery import (
    SimulatorTransport,
    TransportFailure,
    TransportResult,
    WebPushTransport,
    backoff_seconds,
    classify,
)


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def test_tokens_and_codes_are_high_entropy_and_unique() -> None:
    tokens = {new_token() for _ in range(500)}
    codes = {new_code() for _ in range(500)}
    assert len(tokens) == len(codes) == 500
    assert all(token.startswith(TOKEN_PREFIX) and len(token) >= 48 for token in tokens)
    for code in codes:
        parts = code.split("-")
        assert [len(part) for part in parts] == [4, 4, 4]
        assert set("".join(parts)) <= set(CODE_ALPHABET)
    assert not set("OILU") & set(CODE_ALPHABET)  # no look-alike characters


def test_code_normalisation_accepts_human_input_only() -> None:
    assert normalize_code("abcd-efgh-jkmn") == "ABCDEFGHJKMN"
    assert normalize_code(" abcd efgh jkmn ") == "ABCDEFGHJKMN"
    assert normalize_code("oooo-iiii-llll") == "000011111111"
    assert normalize_code("ABCD-EFGH") is None
    assert normalize_code("ABCD-EFGH-JKMN-PQRS") is None
    assert normalize_code("ABCD-EFGH-JK!N") is None
    assert normalize_code("") is None


def test_keyed_hash_is_deterministic_and_key_dependent() -> None:
    settings = get_settings()
    original = settings.pickup_hash_key
    try:
        first = keyed_hash("bbp1.secret")
        assert first == keyed_hash("bbp1.secret") and len(first) == 64
        assert first != keyed_hash("bbp1.secreT")
        settings.pickup_hash_key = original + "-rotated"
        assert keyed_hash("bbp1.secret") != first
    finally:
        settings.pickup_hash_key = original


@pytest.fixture
def allow_simulator():
    settings = get_settings()
    saved = settings.push_allow_test_endpoints
    settings.push_allow_test_endpoints = True
    yield
    settings.push_allow_test_endpoints = saved


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://fcm.googleapis.com/x",
        "https://127.0.0.1/x",
        "https://10.0.0.5/x",
        "https://[::1]/x",
        "https://localhost/x",
        "https://metadata.google.internal/x",
        "https://fcm.googleapis.com.attacker.test/x",
        "https://attacker.test/https://fcm.googleapis.com/x",
        "https://fcm.googleapis.com@attacker.test/x",
        "https://fcm.googleapis.com:444/x",
        "https://xfcm.googleapis.com/x",
        "https://push.services.mozilla.com/x",
        "https://fcm.googleapis.com/x y",
        "https://fcm.googleapis.com/x#frag",
        "file:///etc/passwd",
        "",
        " https://fcm.googleapis.com/x",
    ],
)
def test_endpoint_validation_rejects_unsafe_urls(endpoint: str, allow_simulator) -> None:
    with pytest.raises(ApiError) as caught:
        validate_endpoint(endpoint)
    assert caught.value.status_code == 422


def test_simulator_host_requires_explicit_opt_in() -> None:
    settings = get_settings()
    saved = settings.push_allow_test_endpoints
    try:
        settings.push_allow_test_endpoints = False
        with pytest.raises(ApiError):
            validate_endpoint(f"https://{SIMULATOR_HOST}/accept/1")
        settings.push_allow_test_endpoints = True
        assert validate_endpoint(f"https://{SIMULATOR_HOST}/accept/1")
    finally:
        settings.push_allow_test_endpoints = saved


def test_production_refuses_test_endpoints_and_default_secrets() -> None:
    with pytest.raises(ValueError):
        Settings(environment="production", push_allow_test_endpoints=True)
    with pytest.raises(ValueError):
        Settings(environment="production")


def test_key_validation_checks_curve_point_and_auth_length() -> None:
    private = ec.generate_private_key(ec.SECP256R1())
    point = private.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    validate_keys(_b64(point), _b64(b"a" * 16))
    for bad_point, auth in (
        (_b64(point[:-1]), _b64(b"a" * 16)),
        (_b64(b"\x04" + b"\x01" * 64), _b64(b"a" * 16)),  # not on the curve
        (_b64(point), _b64(b"a" * 15)),
    ):
        with pytest.raises(ApiError):
            validate_keys(bad_point, auth)


def test_backoff_grows_exponentially_and_is_capped() -> None:
    settings = get_settings()
    delays = [backoff_seconds(attempt) for attempt in range(1, 12)]
    assert delays[0] == settings.push_backoff_base_seconds
    assert delays[1] == 2 * delays[0] and delays[2] == 4 * delays[0]
    assert max(delays) == settings.push_backoff_max_seconds


def test_delivery_classification() -> None:
    max_attempts = get_settings().push_max_attempts
    assert classify(TransportResult(201), None, 1) == ("ACCEPTED", None, None)
    assert classify(TransportResult(410), None, 1)[0] == "GONE"
    assert classify(TransportResult(404), None, 1)[0] == "GONE"
    assert classify(TransportResult(400), None, 1)[0] == "REJECTED"
    assert classify(TransportResult(403), None, 1)[0] == "REJECTED"
    status, code, delay = classify(TransportResult(503), None, 1)
    assert (status, code) == ("PENDING", "http_503") and delay == backoff_seconds(1)
    assert classify(TransportResult(503), None, max_attempts)[0] == "FAILED"
    status, _, delay = classify(TransportResult(429, retry_after=900), None, 1)
    assert status == "PENDING" and delay == 900
    assert classify(None, TransportFailure("timeout"), 1)[0] == "PENDING"
    assert classify(None, TransportFailure("timeout"), max_attempts)[0] == "FAILED"
    assert classify(TransportResult(302), None, 1)[0] == "REJECTED"


def test_simulator_modes() -> None:
    transport = SimulatorTransport()
    base = {"p256dh": "", "auth": "", "payload": b"{}", "ttl": 1, "timeout": 1.0}
    assert transport.send(endpoint="https://x/accept/1", attempt=1, **base).status_code == 201
    assert transport.send(endpoint="https://x/gone/1", attempt=1, **base).status_code == 410
    assert transport.send(endpoint="https://x/flaky/1", attempt=1, **base).status_code == 503
    assert transport.send(endpoint="https://x/flaky/1", attempt=2, **base).status_code == 201
    with pytest.raises(TransportFailure):
        transport.send(endpoint="https://x/timeout/1", attempt=1, **base)


def test_simulator_is_never_selected_for_real_hosts(allow_simulator) -> None:
    assert isinstance(
        push_delivery.select_transport("https://fcm.googleapis.com/fcm/send/abc"), WebPushTransport
    )
    assert isinstance(
        push_delivery.select_transport(f"https://{SIMULATOR_HOST}/accept/1"), SimulatorTransport
    )


class _Capture:
    def __init__(self, status: int = 201) -> None:
        self.status = status
        self.calls: list[dict] = []

    def post(self, url, **kwargs):
        self.calls.append({"url": url, **kwargs})
        response = requests.Response()
        response.status_code = self.status
        response.headers["Retry-After"] = "30"
        return response


def _real_transport_setup(monkeypatch, capture: _Capture):
    keys = generate()
    settings = get_settings()
    monkeypatch.setattr(settings, "vapid_public_key", keys["VAPID_PUBLIC_KEY"])
    monkeypatch.setattr(settings, "vapid_private_key", keys["VAPID_PRIVATE_KEY"])
    monkeypatch.setattr(settings, "vapid_subject", "mailto:ops@bowlbyte.test")
    monkeypatch.setattr(
        socket, "getaddrinfo", lambda *a, **k: [(socket.AF_INET, 1, 6, "", ("142.250.1.1", 443))]
    )
    monkeypatch.setattr(requests.Session, "post", lambda self, url, **kw: capture.post(url, **kw))
    browser_key = ec.generate_private_key(ec.SECP256R1())
    point = browser_key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    auth = b"0123456789abcdef"
    return browser_key, _b64(point), _b64(auth), auth


def test_real_webpush_transport_signs_vapid_and_encrypts_payload(monkeypatch) -> None:
    capture = _Capture(201)
    browser_key, p256dh, auth, raw_auth = _real_transport_setup(monkeypatch, capture)
    payload = json.dumps({"title": "BowlByte — Order Ready!", "tag": "order-1"}).encode()
    result = WebPushTransport().send(
        endpoint="https://fcm.googleapis.com/fcm/send/abc",
        p256dh=p256dh,
        auth=auth,
        payload=payload,
        ttl=900,
        timeout=3.0,
        attempt=1,
    )
    assert result.status_code == 201
    call = capture.calls[0]
    headers = {key.lower(): value for key, value in call["headers"].items()}
    assert headers["authorization"].lower().startswith("vapid ") or headers[
        "authorization"
    ].startswith("WebPush ")
    assert headers["content-encoding"] == "aes128gcm"
    assert headers["ttl"] == "900" and call["timeout"] == 3.0
    assert payload not in call["data"]  # ciphertext on the wire, not plaintext
    clear = http_ece.decrypt(
        call["data"], private_key=browser_key, auth_secret=raw_auth, version="aes128gcm"
    )
    assert json.loads(clear)["tag"] == "order-1"


def test_real_webpush_transport_surfaces_status_and_retry_after(monkeypatch) -> None:
    capture = _Capture(429)
    _, p256dh, auth, _ = _real_transport_setup(monkeypatch, capture)
    result = WebPushTransport().send(
        endpoint="https://fcm.googleapis.com/fcm/send/abc",
        p256dh=p256dh,
        auth=auth,
        payload=b"{}",
        ttl=60,
        timeout=3.0,
        attempt=1,
    )
    assert result.status_code == 429 and result.retry_after == 30


def test_real_transport_refuses_private_addresses_and_missing_keys(monkeypatch) -> None:
    capture = _Capture(201)
    _, p256dh, auth, _ = _real_transport_setup(monkeypatch, capture)
    monkeypatch.setattr(
        socket, "getaddrinfo", lambda *a, **k: [(socket.AF_INET, 1, 6, "", ("10.1.2.3", 443))]
    )
    with pytest.raises(TransportFailure) as blocked:
        WebPushTransport().send(
            endpoint="https://fcm.googleapis.com/x",
            p256dh=p256dh,
            auth=auth,
            payload=b"{}",
            ttl=60,
            timeout=3.0,
            attempt=1,
        )
    assert blocked.value.kind == "blocked_address" and capture.calls == []
    monkeypatch.setattr(get_settings(), "vapid_private_key", "")
    with pytest.raises(TransportFailure) as missing:
        WebPushTransport().send(
            endpoint="https://fcm.googleapis.com/x",
            p256dh=p256dh,
            auth=auth,
            payload=b"{}",
            ttl=60,
            timeout=3.0,
            attempt=1,
        )
    assert missing.value.kind == "not_configured"


def test_real_transport_maps_network_errors(monkeypatch) -> None:
    capture = _Capture(201)
    _, p256dh, auth, _ = _real_transport_setup(monkeypatch, capture)

    def boom(self, url, **kwargs):
        raise requests.Timeout("slow")

    monkeypatch.setattr(requests.Session, "post", boom)
    with pytest.raises(TransportFailure) as caught:
        WebPushTransport().send(
            endpoint="https://fcm.googleapis.com/x",
            p256dh=p256dh,
            auth=auth,
            payload=b"{}",
            ttl=60,
            timeout=1.0,
            attempt=1,
        )
    assert caught.value.kind == "timeout"


def test_generated_vapid_keys_have_expected_shape() -> None:
    keys = generate()
    public = base64.urlsafe_b64decode(keys["VAPID_PUBLIC_KEY"] + "==")
    private = base64.urlsafe_b64decode(keys["VAPID_PRIVATE_KEY"] + "==")
    assert len(public) == 65 and public[0] == 4 and len(private) == 32
    assert len(keys["PICKUP_HASH_KEY"]) >= 48 and len(keys["PUSH_ENCRYPTION_KEY"]) >= 48
    assert generate()["VAPID_PRIVATE_KEY"] != keys["VAPID_PRIVATE_KEY"]
