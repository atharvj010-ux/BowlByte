"""Supabase Auth token checks for BowlByte sessions.

Roles stay on BowlByte user rows. This module never reads user_metadata or
app_metadata for authorization, and it never logs tokens or passwords.
"""

from __future__ import annotations

import base64
import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Protocol

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

from app.core.config import Settings
from app.services.supabase_identity import (
    credentials_rotation_acknowledged,
    secret_key_usable,
)

_JWKS_TTL_SECONDS = 600
_CLOCK_SKEW_SECONDS = 30
_jwks_cache: tuple[float, dict[str, Any]] | None = None


class SupabaseAuthError(RuntimeError):
    def __init__(self, status: int) -> None:
        super().__init__(f"Supabase Auth request failed with HTTP {status}.")
        self.status = status


class TokenRejected(RuntimeError):
    pass


class HttpTransport(Protocol):
    def __call__(
        self,
        method: str,
        url: str,
        headers: dict[str, str],
        body: dict[str, Any] | None,
    ) -> tuple[int, dict[str, Any]]: ...


@dataclass(frozen=True)
class VerifiedTokens:
    access_token: str
    refresh_token: str
    subject: str


def supabase_auth_enabled(settings: Settings) -> bool:
    """True only after rotation is acknowledged and Auth settings are present."""

    publishable = settings.supabase_publishable_key.strip()
    return bool(
        credentials_rotation_acknowledged(settings.supabase_credentials_rotated)
        and settings.supabase_url.strip()
        and publishable
        and not publishable.startswith("sb_secret")
        and secret_key_usable(settings.supabase_secret_key)
    )


def identity_subject(claims: dict[str, Any]) -> str:
    """Return the Auth user id. Metadata roles are ignored."""

    subject = claims.get("sub")
    if not isinstance(subject, str) or not subject.strip():
        raise TokenRejected("missing subject")
    return subject


def verify_access_token(
    token: str,
    *,
    jwks: dict[str, Any],
    issuer: str,
    audience: str = "authenticated",
    now: float | None = None,
) -> dict[str, Any]:
    parts = token.split(".")
    if len(parts) != 3 or any(not part for part in parts):
        raise TokenRejected("malformed")
    try:
        header = json.loads(_b64json(parts[0]))
        payload = json.loads(_b64json(parts[1]))
    except (json.JSONDecodeError, ValueError, UnicodeDecodeError) as exc:
        raise TokenRejected("malformed") from exc
    if not isinstance(header, dict) or not isinstance(payload, dict):
        raise TokenRejected("malformed")
    if header.get("alg") != "ES256":
        raise TokenRejected("algorithm")
    signature = _b64bytes(parts[2])
    if len(signature) != 64:
        raise TokenRejected("signature")
    key = _public_key(jwks, header.get("kid"))
    try:
        raw_r = int.from_bytes(signature[:32], "big")
        raw_s = int.from_bytes(signature[32:], "big")
        key.verify(
            encode_dss_signature(raw_r, raw_s),
            f"{parts[0]}.{parts[1]}".encode(),
            ec.ECDSA(hashes.SHA256()),
        )
    except (InvalidSignature, ValueError) as exc:
        raise TokenRejected("signature") from exc
    current = time.time() if now is None else now
    if payload.get("iss") != issuer:
        raise TokenRejected("issuer")
    aud = payload.get("aud")
    audiences = aud if isinstance(aud, list) else [aud]
    if audience not in audiences:
        raise TokenRejected("audience")
    exp = payload.get("exp")
    expired = (
        isinstance(exp, bool)
        or not isinstance(exp, (int, float))
        or exp <= current - _CLOCK_SKEW_SECONDS
    )
    if expired:
        raise TokenRejected("expired")
    nbf = payload.get("nbf")
    too_early = nbf is not None and (
        isinstance(nbf, bool)
        or not isinstance(nbf, (int, float))
        or nbf > current + _CLOCK_SKEW_SECONDS
    )
    if too_early:
        raise TokenRejected("not before")
    identity_subject(payload)
    return payload


class SupabaseAuthClient:
    def __init__(
        self,
        settings: Settings,
        transport: HttpTransport | None = None,
        jwks: dict[str, Any] | None = None,
    ) -> None:
        self._settings = settings
        self._transport = transport or _urllib_transport
        self._jwks = jwks

    def password_grant(self, email: str, password: str) -> VerifiedTokens | None:
        status, body = self._public(
            "POST",
            "/auth/v1/token?grant_type=password",
            {"email": email, "password": password},
        )
        if status != 200:
            return None
        return self._verified(body)

    def refresh_grant(self, refresh_token: str) -> VerifiedTokens | None:
        status, body = self._public(
            "POST",
            "/auth/v1/token?grant_type=refresh_token",
            {"refresh_token": refresh_token},
        )
        if status != 200:
            return None
        return self._verified(body)

    def request_email_otp(self, email: str) -> None:
        status, _body = self._public(
            "POST",
            "/auth/v1/otp",
            {"email": email, "create_user": False},
        )
        if status != 200:
            raise SupabaseAuthError(status)

    def verify_email_otp(self, email: str, code: str) -> VerifiedTokens | None:
        status, body = self._public(
            "POST",
            "/auth/v1/verify",
            {"type": "email", "email": email, "token": code},
        )
        if status != 200:
            return None
        return self._verified(body)

    def request_recovery(self, email: str, redirect_to: str) -> None:
        status, _body = self._public(
            "POST",
            "/auth/v1/recover",
            {"email": email, "redirect_to": redirect_to},
        )
        if status != 200:
            raise SupabaseAuthError(status)

    def confirm_email(self, auth_user_id: str) -> None:
        status, _body = self._admin(
            "PUT",
            f"/auth/v1/admin/users/{auth_user_id}",
            {"email_confirm": True},
        )
        if status not in {200, 201}:
            raise SupabaseAuthError(status)

    def send_signup_confirmation(self, email: str, redirect_to: str) -> None:
        status, _body = self._public(
            "POST",
            "/auth/v1/resend",
            {"type": "signup", "email": email, "options": {"email_redirect_to": redirect_to}},
        )
        if status != 200:
            raise SupabaseAuthError(status)

    def create_user(self, email: str, password: str, *, email_confirm: bool) -> str:
        status, body = self._admin(
            "POST",
            "/auth/v1/admin/users",
            {"email": email, "password": password, "email_confirm": email_confirm},
        )
        if status not in {200, 201}:
            raise SupabaseAuthError(status)
        user_id = str(body.get("id") or "")
        if not user_id:
            raise SupabaseAuthError(status)
        return user_id

    def update_password(self, auth_user_id: str, password: str) -> None:
        status, _body = self._admin(
            "PUT",
            f"/auth/v1/admin/users/{auth_user_id}",
            {"password": password},
        )
        if status not in {200, 201}:
            raise SupabaseAuthError(status)

    def logout(self, access_token: str) -> None:
        status, _body = self._transport(
            "POST",
            self._url("/auth/v1/logout"),
            {
                "apikey": self._settings.supabase_publishable_key,
                "authorization": f"Bearer {access_token}",
                "content-type": "application/json",
            },
            {},
        )
        if status not in {200, 204}:
            raise SupabaseAuthError(status)

    def _verified(self, body: dict[str, Any]) -> VerifiedTokens:
        access = body.get("access_token")
        refresh = body.get("refresh_token")
        if not isinstance(access, str) or not isinstance(refresh, str):
            raise TokenRejected("missing token")
        claims = verify_access_token(
            access,
            jwks=self._current_jwks(),
            issuer=self._issuer(),
        )
        return VerifiedTokens(access, refresh, identity_subject(claims))

    def _current_jwks(self) -> dict[str, Any]:
        if self._jwks is not None:
            return self._jwks
        return fetch_jwks(self._settings, self._transport)

    def _issuer(self) -> str:
        return self._settings.supabase_url.rstrip("/") + "/auth/v1"

    def _public(self, method: str, path: str, body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        return self._transport(
            method,
            self._url(path),
            {
                "apikey": self._settings.supabase_publishable_key,
                "content-type": "application/json",
            },
            body,
        )

    def _admin(self, method: str, path: str, body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        return self._transport(
            method,
            self._url(path),
            {
                "apikey": self._settings.supabase_secret_key,
                "authorization": f"Bearer {self._settings.supabase_secret_key}",
                "content-type": "application/json",
            },
            body,
        )

    def _url(self, path: str) -> str:
        return self._settings.supabase_url.rstrip("/") + path


def fetch_jwks(settings: Settings, transport: HttpTransport | None = None) -> dict[str, Any]:
    global _jwks_cache
    now = time.monotonic()
    if _jwks_cache is not None and now - _jwks_cache[0] < _JWKS_TTL_SECONDS:
        return _jwks_cache[1]
    call = transport or _urllib_transport
    status, body = call(
        "GET",
        settings.supabase_url.rstrip("/") + "/auth/v1/.well-known/jwks.json",
        {"apikey": settings.supabase_publishable_key, "accept": "application/json"},
        None,
    )
    if status != 200 or "keys" not in body:
        raise SupabaseAuthError(status)
    _jwks_cache = (now, body)
    return body


def _public_key(jwks: dict[str, Any], kid: object) -> ec.EllipticCurvePublicKey:
    keys = jwks.get("keys")
    if not isinstance(keys, list) or not keys:
        raise TokenRejected("jwks")
    chosen = None
    for item in keys:
        if not isinstance(item, dict):
            continue
        if kid is None or item.get("kid") == kid:
            chosen = item
            break
    if chosen is None or chosen.get("kty") != "EC" or chosen.get("crv") != "P-256":
        raise TokenRejected("jwks")
    x = chosen.get("x")
    y = chosen.get("y")
    if not isinstance(x, str) or not isinstance(y, str):
        raise TokenRejected("jwks")
    numbers = ec.EllipticCurvePublicNumbers(
        int.from_bytes(_b64bytes(x), "big"),
        int.from_bytes(_b64bytes(y), "big"),
        ec.SECP256R1(),
    )
    return numbers.public_key()


def _b64bytes(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _b64json(value: str) -> str:
    return _b64bytes(value).decode("utf-8")


def _urllib_transport(
    method: str,
    url: str,
    headers: dict[str, str],
    body: dict[str, Any] | None,
) -> tuple[int, dict[str, Any]]:
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read().decode()
            parsed = json.loads(raw) if raw else {}
            return response.status, parsed if isinstance(parsed, dict) else {}
    except urllib.error.HTTPError as error:
        raw = error.read().decode()
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = {}
        return error.code, parsed if isinstance(parsed, dict) else {}
