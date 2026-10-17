import logging

from redis import Redis
from redis.exceptions import RedisError

from app.core.config import get_settings
from app.core.errors import ApiError
from app.core.security import hash_secret

logger = logging.getLogger(__name__)

SIGN_IN_UNAVAILABLE = "Sign-in is temporarily unavailable."


def _client() -> Redis:
    return Redis.from_url(get_settings().redis_url, socket_connect_timeout=2, socket_timeout=2)


def _key(bucket: str, value: str) -> str:
    return f"bowlbyte:rl:{bucket}:{hash_secret(value)}"


def assert_allowance(
    *,
    bucket: str,
    value: str,
    limit: int,
    unavailable_message: str = SIGN_IN_UNAVAILABLE,
) -> None:
    try:
        client = _client()
        key = _key(bucket, value)
        current = client.get(key)
        if current is not None and int(current) >= limit:
            raise ApiError(
                code="RATE_LIMITED",
                message="Too many attempts. Wait and try again.",
                status_code=429,
                headers={"Retry-After": str(_retry_after(client, key, fallback=60))},
            )
    except ApiError:
        raise
    except RedisError as exc:
        logger.warning("rate limit store unavailable: %s", type(exc).__name__)
        raise ApiError(
            code="RATE_LIMIT_UNAVAILABLE",
            message=unavailable_message,
            status_code=503,
        ) from exc


def record_attempt(
    *,
    bucket: str,
    value: str,
    window_seconds: int,
    unavailable_message: str = SIGN_IN_UNAVAILABLE,
) -> None:
    try:
        client = _client()
        key = _key(bucket, value)
        count = client.incr(key)
        if count == 1:
            client.expire(key, window_seconds)
    except RedisError as exc:
        logger.warning("rate limit store unavailable: %s", type(exc).__name__)
        raise ApiError(
            code="RATE_LIMIT_UNAVAILABLE",
            message=unavailable_message,
            status_code=503,
        ) from exc


def _retry_after(client: Redis, key: str, *, fallback: int) -> int:
    try:
        ttl = int(client.ttl(key))
    except (RedisError, TypeError, ValueError):
        return fallback
    if ttl > 0:
        return ttl
    return fallback


def consume_allowance(
    *,
    bucket: str,
    value: str,
    limit: int,
    window_seconds: int,
    unavailable_message: str = SIGN_IN_UNAVAILABLE,
    limited_message: str = "Too many attempts. Wait and try again.",
) -> None:
    """Atomically count one attempt and reject when the window is exhausted."""

    try:
        client = _client()
        key = _key(bucket, value)
        count = int(client.incr(key))
        if count == 1:
            client.expire(key, window_seconds)
        if count > limit:
            raise ApiError(
                code="RATE_LIMITED",
                message=limited_message,
                status_code=429,
                headers={"Retry-After": str(_retry_after(client, key, fallback=window_seconds))},
            )
    except ApiError:
        raise
    except RedisError as exc:
        logger.warning("rate limit store unavailable: %s", type(exc).__name__)
        raise ApiError(
            code="RATE_LIMIT_UNAVAILABLE",
            message=unavailable_message,
            status_code=503,
        ) from exc


def clear_counters() -> None:
    client = _client()
    keys = list(client.scan_iter("bowlbyte:rl:*"))
    if keys:
        client.delete(*keys)
