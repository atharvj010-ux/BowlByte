"""Authenticated WebSocket streams. Payloads carry ids and versions only."""

import asyncio
from uuid import UUID

from fastapi import APIRouter, WebSocket
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy import select

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.identity import KITCHEN_STAFF, STUDENT
from app.models.ordering import Order
from app.services.identity import load_principal
from app.services.ordering import kitchen_canteen_id

router = APIRouter(tags=["live"])


@router.websocket("/ws/kitchen")
async def kitchen_stream(websocket: WebSocket) -> None:
    await _stream(websocket, channel_for=_kitchen_channel)


@router.websocket("/ws/orders/{order_id}")
async def order_stream(websocket: WebSocket, order_id: UUID) -> None:
    await _stream(websocket, channel_for=lambda principal: _order_channel(principal, order_id))


async def _stream(websocket: WebSocket, channel_for) -> None:
    settings = get_settings()
    origin = websocket.headers.get("origin")
    if origin not in settings.allowed_origins:
        await websocket.close(code=1008)
        return
    principal = _principal(websocket)
    if principal is None:
        await websocket.close(code=4401)
        return
    try:
        channel = channel_for(principal)
    except Exception:
        await websocket.close(code=4403)
        return
    if channel is None:
        await websocket.close(code=4403)
        return
    await websocket.accept()
    await websocket.send_json({"type": "connected", "resource_id": channel, "version": 0, "at": ""})
    client = Redis.from_url(settings.redis_url, socket_connect_timeout=2, socket_timeout=2)
    pubsub = client.pubsub()
    try:
        await pubsub.subscribe(channel)
        while True:
            if _principal(websocket) is None:
                await websocket.close(code=4401)
                return
            try:
                message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=5.0)
            except RedisError:
                await websocket.send_json(
                    {"type": "degraded", "resource_id": channel, "version": 0, "at": ""}
                )
                await asyncio.sleep(5)
                continue
            if message and message.get("type") == "message":
                data = message.get("data")
                text = data.decode() if isinstance(data, bytes) else str(data)
                await websocket.send_text(text)
    except Exception:
        return
    finally:
        await pubsub.unsubscribe(channel)
        await pubsub.aclose()
        await client.aclose()


def _kitchen_channel(principal) -> str | None:
    if principal.user.role != KITCHEN_STAFF or principal.user.status != "ACTIVE":
        return None
    db = SessionLocal()
    try:
        canteen_id = kitchen_canteen_id(db, principal.user)
    finally:
        db.close()
    return f"bowlbyte:canteen:{canteen_id}"


def _order_channel(principal, order_id: UUID) -> str | None:
    if principal.user.role != STUDENT or principal.user.status != "ACTIVE":
        return None
    db = SessionLocal()
    try:
        order = db.scalar(
            select(Order).where(Order.id == order_id, Order.student_user_id == principal.user.id)
        )
    finally:
        db.close()
    if order is None:
        return None
    return f"bowlbyte:order:{order.id}"


def _principal(websocket: WebSocket):
    raw = websocket.cookies.get(get_settings().session_cookie_name)
    db = SessionLocal()
    try:
        return load_principal(db, raw)
    finally:
        db.close()
