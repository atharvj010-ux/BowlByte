"""Best-effort Redis fan-out. PostgreSQL remains the source of truth."""

import json
import logging
from datetime import UTC, datetime
from uuid import UUID

from redis import Redis
from redis.exceptions import RedisError

from app.core.config import get_settings

logger = logging.getLogger(__name__)


def publish_user_event(*, user_id: UUID, event_type: str, resource_id: UUID, version: int) -> None:
    """Signal one student's notification stream. Carries ids only."""

    payload = json.dumps(
        {
            "type": event_type,
            "resource_id": str(resource_id),
            "version": version,
            "at": datetime.now(UTC).isoformat(),
        }
    )
    try:
        client = Redis.from_url(
            get_settings().redis_url, socket_connect_timeout=0.5, socket_timeout=0.5
        )
        client.publish(f"bowlbyte:user:{user_id}", payload)
    except RedisError as exc:
        logger.warning("user event was not published: %s", type(exc).__name__)


def publish_kitchen_event(
    *,
    canteen_id: UUID,
    order_id: UUID,
    event_type: str,
    version: int,
) -> None:
    payload = json.dumps(
        {
            "type": event_type,
            "resource_id": str(order_id),
            "version": version,
            "at": datetime.now(UTC).isoformat(),
        }
    )
    settings = get_settings()
    try:
        client = Redis.from_url(
            settings.redis_url,
            socket_connect_timeout=0.5,
            socket_timeout=0.5,
        )
        client.publish(f"bowlbyte:canteen:{canteen_id}", payload)
        client.publish(f"bowlbyte:order:{order_id}", payload)
    except RedisError as exc:
        logger.warning("kitchen event was not published: %s", type(exc).__name__)
