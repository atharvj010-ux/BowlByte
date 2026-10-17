"""Email password recovery for the local BowlByte session.

The HTTP response never says whether the address has an account. The recovery
token is stored as a hash in Redis and is not written to logs.
"""

from uuid import UUID

from redis.exceptions import RedisError
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ApiError
from app.core.security import hash_password, hash_secret, new_secret
from app.models.identity import ACTIVE, User
from app.models.identity import Session as SessionRow
from app.services.email_templates import branded_message
from app.services.identity import _audit, normalize_email
from app.services.mailer import EmailDeliveryError, send_email
from app.services.rate_limit import _client, consume_allowance

RESET_ACCEPTED = "If an account can be recovered, a message has been sent."
RESET_REJECTED = "This recovery link is invalid or has expired."
RESET_WINDOW_SECONDS = 30 * 60
_FORGOT_WINDOW = 15 * 60


def request_password_reset(db: Session, *, email: str, client_key: str) -> None:
    normalized = normalize_email(email)
    consume_allowance(
        bucket="forgot-ip",
        value=client_key,
        limit=5,
        window_seconds=_FORGOT_WINDOW,
        unavailable_message="Password recovery is temporarily unavailable.",
        limited_message="Too many recovery requests. Wait and try again.",
    )
    consume_allowance(
        bucket="forgot-email",
        value=normalized,
        limit=3,
        window_seconds=_FORGOT_WINDOW,
        unavailable_message="Password recovery is temporarily unavailable.",
        limited_message="Too many recovery requests. Wait and try again.",
    )
    user = db.scalar(select(User).where(User.email == normalized))
    if user is None or user.status != ACTIVE:
        return
    raw = new_secret()
    _store_token(raw, user.id)
    link = f"{get_settings().public_app_url.rstrip('/')}/reset-password#token={raw}"
    text, html = branded_message(
        heading="Choose a new password",
        intro="A password reset was requested for your BowlByte account.",
        action_label="Reset password",
        action_url=link,
        note=(
            "This link expires in 30 minutes and works once. "
            "If you did not ask for it, ignore this message."
        ),
    )
    try:
        send_email(
            recipient=user.email,
            subject="Reset your BowlByte password",
            body=text,
            html=html,
        )
    except EmailDeliveryError as exc:
        _delete_token(raw)
        raise ApiError(
            code="EMAIL_DELIVERY_FAILED",
            message="The message could not be sent. Try again shortly.",
            status_code=503,
        ) from exc


def reset_password(db: Session, *, token: str, password: str, client_key: str) -> None:
    consume_allowance(
        bucket="reset-ip",
        value=client_key,
        limit=10,
        window_seconds=_FORGOT_WINDOW,
        unavailable_message="Password recovery is temporarily unavailable.",
        limited_message="Too many recovery attempts. Wait and try again.",
    )
    if len(password) < 12 or len(password) > 128:
        raise ApiError(
            code="VALIDATION_ERROR",
            message="Use a password between 12 and 128 characters.",
            status_code=422,
        )
    user_id = _take_token(token)
    parsed_id: UUID | None = None
    if user_id:
        try:
            parsed_id = UUID(user_id)
        except ValueError:
            parsed_id = None
    user = db.get(User, parsed_id) if parsed_id else None
    if user is None or user.status != ACTIVE:
        raise ApiError(code="RESET_REJECTED", message=RESET_REJECTED, status_code=400)
    user.password_hash = hash_password(password)
    db.execute(delete(SessionRow).where(SessionRow.user_id == user.id))
    _audit(
        db,
        action="auth.password_reset",
        actor_user_id=user.id,
        target_type="user",
        target_id=str(user.id),
    )
    db.commit()


def _token_key(raw: str) -> str:
    return f"bowlbyte:pwreset:{hash_secret(raw)}"


def _store_token(raw: str, user_id: UUID) -> None:
    try:
        _client().set(_token_key(raw), str(user_id), ex=RESET_WINDOW_SECONDS)
    except RedisError as exc:
        raise ApiError(
            code="RATE_LIMIT_UNAVAILABLE",
            message="Password recovery is temporarily unavailable.",
            status_code=503,
        ) from exc


def _delete_token(raw: str) -> None:
    try:
        _client().delete(_token_key(raw))
    except RedisError:
        return


def _take_token(raw: str) -> str | None:
    if len(raw) < 20 or len(raw) > 200:
        return None
    try:
        stored = _client().getdel(_token_key(raw))
    except RedisError as exc:
        raise ApiError(
            code="RATE_LIMIT_UNAVAILABLE",
            message="Password recovery is temporarily unavailable.",
            status_code=503,
        ) from exc
    if stored is None:
        return None
    text = stored.decode() if isinstance(stored, bytes) else str(stored)
    return text or None
