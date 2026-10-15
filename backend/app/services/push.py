"""Web Push subscription handling.

Endpoints and keys come from the browser, so they are untrusted. An endpoint
must be an https URL on a known public push service host. Endpoints and keys
are stored encrypted and never returned by the API or written to logs.
"""

import base64
import binascii
import hashlib
import ipaddress
import logging
from datetime import UTC, datetime
from urllib.parse import urlsplit
from uuid import UUID

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives.asymmetric import ec
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ApiError
from app.models.fulfillment import PushSubscription
from app.models.identity import User
from app.services.identity import _audit as audit

logger = logging.getLogger(__name__)

SIMULATOR_HOST = "push-test.bowlbyte.invalid"
MAX_ENDPOINT_LENGTH = 1024
INVALID_ENDPOINT = "That push endpoint is not accepted."


def _fernet() -> Fernet:
    digest = hashlib.sha256(get_settings().push_encryption_key.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode("utf-8")).decode("ascii")


def decrypt(value: str) -> str | None:
    try:
        return _fernet().decrypt(value.encode("ascii")).decode("utf-8")
    except InvalidToken:
        return None


def endpoint_hash(endpoint: str) -> str:
    return hashlib.sha256(endpoint.encode("utf-8")).hexdigest()


def host_allowed(host: str) -> bool:
    settings = get_settings()
    if host == SIMULATOR_HOST:
        return settings.push_allow_test_endpoints
    for pattern in settings.push_host_patterns:
        if pattern.startswith("*."):
            if host.endswith(pattern[1:]) and len(host) > len(pattern) - 1:
                return True
        elif host == pattern:
            return True
    return False


def validate_endpoint(endpoint: str) -> str:
    """Return the endpoint if it is safe to store and call, else raise 422.

    Rules: https only, no credentials, standard port, a DNS name (never an IP
    literal), and a host on the push-service allow list.
    """

    reject = ApiError(code="PUSH_ENDPOINT_REJECTED", message=INVALID_ENDPOINT, status_code=422)
    if not endpoint or len(endpoint) > MAX_ENDPOINT_LENGTH or endpoint != endpoint.strip():
        raise reject
    if any(ord(char) < 33 or ord(char) > 126 for char in endpoint):
        raise reject
    try:
        parts = urlsplit(endpoint)
        port = parts.port
    except ValueError as exc:
        raise reject from exc
    host = (parts.hostname or "").lower()
    if parts.scheme != "https" or not host or parts.username or parts.password or parts.fragment:
        raise reject
    if port not in (None, 443):
        raise reject
    try:
        ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        pass
    else:
        raise reject
    if "." not in host or host.endswith(".") or not host_allowed(host):
        raise reject
    return endpoint


def _b64(value: str) -> bytes:
    padded = value + "=" * (-len(value) % 4)
    try:
        return base64.urlsafe_b64decode(padded.encode("ascii"))
    except (binascii.Error, UnicodeEncodeError, ValueError) as exc:
        raise ApiError(
            code="PUSH_KEYS_INVALID",
            message="The subscription keys are not valid.",
            status_code=422,
        ) from exc


def validate_keys(p256dh: str, auth: str) -> None:
    bad = ApiError(
        code="PUSH_KEYS_INVALID", message="The subscription keys are not valid.", status_code=422
    )
    if len(p256dh) > 120 or len(auth) > 64:
        raise bad
    point = _b64(p256dh)
    secret = _b64(auth)
    if len(point) != 65 or point[0] != 4 or len(secret) != 16:
        raise bad
    try:
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), point)
    except ValueError as exc:
        raise bad from exc


def _clean_label(label: str | None) -> str | None:
    if not label:
        return None
    cleaned = "".join(char for char in label if char.isprintable()).strip()
    return cleaned[:60] or None


def register_subscription(
    db: Session,
    *,
    user: User,
    endpoint: str,
    p256dh: str,
    auth: str,
    expiration_time: datetime | None,
    device_label: str | None,
) -> tuple[PushSubscription, bool]:
    """Create or take over a subscription. Returns (row, created).

    A browser endpoint is unique. If another account registered it earlier on the
    same browser, the endpoint moves to the signed-in user, so the earlier account
    stops receiving notifications on that device.
    """

    endpoint = validate_endpoint(endpoint)
    validate_keys(p256dh, auth)
    settings = get_settings()
    digest = endpoint_hash(endpoint)
    now = datetime.now(UTC)
    row = db.scalar(
        select(PushSubscription).where(PushSubscription.endpoint_hash == digest).with_for_update()
    )
    if row is None:
        count = db.scalar(
            select(func.count())
            .select_from(PushSubscription)
            .where(PushSubscription.user_id == user.id, PushSubscription.enabled.is_(True))
        )
        if int(count or 0) >= settings.push_max_subscriptions_per_user:
            raise ApiError(
                code="CONFLICT",
                message="This account has too many notification devices. Remove one first.",
                status_code=409,
            )
        row = PushSubscription(user_id=user.id, endpoint_hash=digest)
        db.add(row)
        created = True
    else:
        created = False
        if row.user_id != user.id:
            audit(
                db,
                action="push.subscription_moved",
                actor_user_id=user.id,
                target_type="push_subscription",
                target_id=str(row.id),
            )
    row.user_id = user.id
    row.endpoint_enc = encrypt(endpoint)
    row.p256dh_enc = encrypt(p256dh)
    row.auth_enc = encrypt(auth)
    row.device_label = _clean_label(device_label)
    row.expiration_time = expiration_time
    row.enabled = True
    row.disabled_reason = None
    row.failure_count = 0
    row.updated_at = now
    db.commit()
    db.refresh(row)
    return row, created


def unregister_subscription(db: Session, *, user: User, endpoint: str) -> bool:
    """Delete the caller's own subscription for this endpoint. Unknown endpoints are a no-op."""

    digest = endpoint_hash(endpoint.strip())
    result = db.execute(
        delete(PushSubscription).where(
            PushSubscription.endpoint_hash == digest, PushSubscription.user_id == user.id
        )
    )
    db.commit()
    return bool(result.rowcount)


def list_my_subscriptions(db: Session, *, user: User) -> list[dict]:
    rows = db.scalars(
        select(PushSubscription)
        .where(PushSubscription.user_id == user.id)
        .order_by(PushSubscription.created_at.desc())
        .limit(20)
    )
    return [
        {
            "id": row.id,
            "device_label": row.device_label,
            "enabled": row.enabled,
            "disabled_reason": row.disabled_reason,
            "created_at": row.created_at,
            "last_success_at": row.last_success_at,
            "last_attempt_at": row.last_attempt_at,
        }
        for row in rows
    ]


def public_key_info() -> dict:
    settings = get_settings()
    return {
        "supported": settings.push_configured,
        "public_key": settings.vapid_public_key if settings.push_configured else None,
    }


def subscription_ids_for(db: Session, user_id: UUID) -> list[UUID]:
    return list(
        db.scalars(
            select(PushSubscription.id).where(
                PushSubscription.user_id == user_id, PushSubscription.enabled.is_(True)
            )
        )
    )
