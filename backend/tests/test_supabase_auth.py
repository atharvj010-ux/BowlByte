"""Supabase token checks. No network and no live credentials."""

import base64
import json
import time

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

from app.cli.reconcile_snapshot import assert_endpoints
from app.core.config import Settings
from app.services.supabase_auth import (
    SupabaseAuthClient,
    TokenRejected,
    identity_subject,
    supabase_auth_enabled,
    verify_access_token,
)

_PRIVATE = ec.generate_private_key(ec.SECP256R1())


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _jwks() -> dict:
    numbers = _PRIVATE.public_key().public_numbers()
    return {
        "keys": [
            {
                "kty": "EC",
                "crv": "P-256",
                "kid": "test",
                "alg": "ES256",
                "use": "sig",
                "x": _b64(numbers.x.to_bytes(32, "big")),
                "y": _b64(numbers.y.to_bytes(32, "big")),
            }
        ]
    }


def _token(payload: dict, *, alg: str = "ES256") -> str:
    header = _b64(json.dumps({"alg": alg, "kid": "test", "typ": "JWT"}).encode())
    body = _b64(json.dumps(payload).encode())
    signature = _PRIVATE.sign(f"{header}.{body}".encode(), ec.ECDSA(hashes.SHA256()))
    raw_r, raw_s = decode_dss_signature(signature)
    signed = _b64(raw_r.to_bytes(32, "big") + raw_s.to_bytes(32, "big"))
    return f"{header}.{body}.{signed}"


def _claims(**extra: object) -> dict:
    now = int(time.time())
    payload = {
        "iss": "https://example.supabase.co/auth/v1",
        "aud": "authenticated",
        "sub": "auth-user",
        "exp": now + 600,
        "user_metadata": {"role": "CANTEEN_MANAGER"},
    }
    payload.update(extra)
    return payload


def test_access_token_verifies_signature_issuer_audience_and_ignores_metadata() -> None:
    payload = _claims()
    claims = verify_access_token(
        _token(payload),
        jwks=_jwks(),
        issuer="https://example.supabase.co/auth/v1",
    )
    assert identity_subject(claims) == "auth-user"
    assert claims["user_metadata"]["role"] == "CANTEEN_MANAGER"


def test_access_token_rejects_bad_issuer_expiry_and_algorithm() -> None:
    jwks = _jwks()
    issuer = "https://example.supabase.co/auth/v1"
    try:
        verify_access_token(
            _token(_claims(iss="https://other.example/auth/v1")),
            jwks=jwks,
            issuer=issuer,
        )
        raise AssertionError("issuer")
    except TokenRejected as error:
        assert str(error) == "issuer"
    try:
        verify_access_token(_token(_claims(exp=int(time.time()) - 120)), jwks=jwks, issuer=issuer)
        raise AssertionError("expired")
    except TokenRejected as error:
        assert str(error) == "expired"
    try:
        verify_access_token(_token(_claims(), alg="none"), jwks=jwks, issuer=issuer)
        raise AssertionError("algorithm")
    except TokenRejected as error:
        assert str(error) == "algorithm"


def test_email_otp_does_not_create_a_user() -> None:
    seen: dict = {}

    def transport(method, url, headers, body):
        seen["body"] = body
        seen["url"] = url
        return 200, {}

    settings = Settings(
        supabase_url="https://example.supabase.co",
        supabase_publishable_key="sb_publishable_example",
        supabase_secret_key="sb_secret_example_value",
        supabase_credentials_rotated="yes",
    )
    SupabaseAuthClient(settings, transport=transport, jwks=_jwks()).request_email_otp(
        "student@college.edu"
    )
    assert seen["body"] == {"email": "student@college.edu", "create_user": False}
    assert seen["url"].endswith("/auth/v1/otp")
    assert supabase_auth_enabled(settings) is True
    assert supabase_auth_enabled(Settings()) is False


def test_reconciliation_refuses_unintended_targets() -> None:
    source = "postgresql://bowlbyte:bowlbyte@127.0.0.1:5433/bowlbyte"
    stage = "postgresql://bowlbyte:bowlbyte@127.0.0.1:5433/bowlbyte_p014_stage"
    cloud = (
        "postgresql://user:secret@aws-0-example.pooler.supabase.com:5432/postgres"
        "?sslmode=verify-full"
    )
    assert_endpoints(source, stage, apply=True)
    assert_endpoints(source, cloud, apply=False)
    try:
        assert_endpoints(
            source,
            "postgresql://bowlbyte:bowlbyte@127.0.0.1:5433/bowlbyte",
            apply=True,
        )
        raise AssertionError("same database")
    except SystemExit:
        pass
