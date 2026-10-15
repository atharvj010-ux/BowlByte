"""Outbox draining and Web Push delivery.

State vocabulary (never conflated):
  created   -> a NotificationOutbox row exists (written in the READY transaction)
  scheduled -> a PushDelivery row is PENDING with next_attempt_at
  accepted  -> the push service answered 2xx (this is NOT proof the device showed it)
  rejected / gone / failed -> terminal negative results
The service worker's display cannot be observed by the server, so nothing here
ever claims a notification was displayed.

Network calls happen with no database transaction open.
"""

import ipaddress
import json
import logging
import socket
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol
from urllib.parse import urlsplit
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.fulfillment import NotificationOutbox, PushDelivery, PushSubscription
from app.models.ordering import Order
from app.services.push import SIMULATOR_HOST, decrypt

logger = logging.getLogger(__name__)

Clock = Callable[[], datetime]
ACCEPTED_CODES = {200, 201, 202}
PERMANENT_CODES = {400, 401, 403, 413}
GONE_CODES = {404, 410}


def utcnow() -> datetime:
    return datetime.now(UTC)


@dataclass(frozen=True)
class TransportResult:
    status_code: int
    retry_after: int | None = None


class TransportFailure(Exception):
    """Network-level failure. `kind` is a short, secret-free label."""

    def __init__(self, kind: str) -> None:
        super().__init__(kind)
        self.kind = kind


class PushTransport(Protocol):
    name: str

    def send(
        self,
        *,
        endpoint: str,
        p256dh: str,
        auth: str,
        payload: bytes,
        ttl: int,
        timeout: float,
        attempt: int,
    ) -> TransportResult: ...


def _blocked_ip(value: str) -> bool:
    ip = ipaddress.ip_address(value)
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


class WebPushTransport:
    """Real RFC 8030/8291/8292 delivery through pywebpush."""

    name = "webpush"

    def send(
        self,
        *,
        endpoint: str,
        p256dh: str,
        auth: str,
        payload: bytes,
        ttl: int,
        timeout: float,
        attempt: int,
    ) -> TransportResult:
        import requests
        from pywebpush import WebPushException, webpush

        settings = get_settings()
        if not settings.can_sign_push:
            raise TransportFailure("not_configured")
        host = urlsplit(endpoint).hostname or ""
        try:
            addresses = {
                item[4][0] for item in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
            }
        except OSError as exc:
            raise TransportFailure("dns") from exc
        if not addresses or any(_blocked_ip(address) for address in addresses):
            raise TransportFailure("blocked_address")
        session = requests.Session()
        session.trust_env = False  # ignore proxy environment variables
        session.max_redirects = 0
        try:
            response = webpush(
                subscription_info={"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth}},
                data=payload.decode("utf-8"),
                vapid_private_key=settings.vapid_private_key,
                vapid_claims={"sub": settings.vapid_subject},
                ttl=ttl,
                timeout=timeout,
                requests_session=session,
            )
            return TransportResult(status_code=response.status_code)
        except WebPushException as exc:
            response = getattr(exc, "response", None)
            if response is None:
                raise TransportFailure("protocol") from exc
            retry = response.headers.get("Retry-After", "")
            return TransportResult(
                status_code=response.status_code,
                retry_after=int(retry) if retry.isdigit() else None,
            )
        except requests.Timeout as exc:
            raise TransportFailure("timeout") from exc
        except requests.RequestException as exc:
            raise TransportFailure("network") from exc
        finally:
            session.close()


class SimulatorTransport:
    """Controlled stand-in for a push service. Only usable for the reserved test host.

    The path selects the outcome: /accept, /gone, /throttle, /fail, /reject, /timeout and
    /flaky (fails on the first attempt, then accepts).
    """

    name = "simulator"

    def send(
        self,
        *,
        endpoint: str,
        p256dh: str,
        auth: str,
        payload: bytes,
        ttl: int,
        timeout: float,
        attempt: int,
    ) -> TransportResult:
        mode = urlsplit(endpoint).path.strip("/").split("/")[0]
        if mode == "gone":
            return TransportResult(410)
        if mode == "throttle":
            return TransportResult(429, retry_after=1)
        if mode == "fail":
            return TransportResult(503)
        if mode == "reject":
            return TransportResult(400)
        if mode == "timeout":
            raise TransportFailure("timeout")
        if mode == "flaky" and attempt <= 1:
            return TransportResult(503)
        return TransportResult(201)


def select_transport(endpoint: str) -> PushTransport:
    settings = get_settings()
    if (urlsplit(endpoint).hostname or "") == SIMULATOR_HOST and settings.push_allow_test_endpoints:
        return SimulatorTransport()
    return WebPushTransport()


def backoff_seconds(attempt: int) -> int:
    settings = get_settings()
    exponent = max(attempt - 1, 0)
    return int(
        min(settings.push_backoff_base_seconds * (2**exponent), settings.push_backoff_max_seconds)
    )


def classify(
    result: TransportResult | None, failure: TransportFailure | None, attempt: int
) -> tuple[str, str | None, int | None]:
    """Return (status, error_code, retry_delay_seconds)."""

    settings = get_settings()
    if failure is not None:
        code = f"net_{failure.kind}"
        if attempt >= settings.push_max_attempts:
            return "FAILED", code, None
        return "PENDING", code, backoff_seconds(attempt)
    assert result is not None
    status = result.status_code
    if status in ACCEPTED_CODES:
        return "ACCEPTED", None, None
    if status in GONE_CODES:
        return "GONE", f"http_{status}", None
    if status in PERMANENT_CODES:
        return "REJECTED", f"http_{status}", None
    if status == 429 or status >= 500:
        if attempt >= settings.push_max_attempts:
            return "FAILED", f"http_{status}", None
        delay = max(backoff_seconds(attempt), result.retry_after or 0)
        return "PENDING", f"http_{status}", min(delay, settings.push_backoff_max_seconds)
    return "REJECTED", f"http_{status}", None


def _claim_events(db: Session, now: datetime, limit: int) -> list[UUID]:
    settings = get_settings()
    rows = list(
        db.scalars(
            select(NotificationOutbox)
            .where(
                NotificationOutbox.status == "PENDING",
                NotificationOutbox.next_attempt_at <= now,
                (NotificationOutbox.locked_until.is_(None))
                | (NotificationOutbox.locked_until < now),
            )
            .order_by(NotificationOutbox.next_attempt_at)
            .limit(limit)
            .with_for_update(skip_locked=True)
        )
    )
    for row in rows:
        row.locked_until = now + timedelta(seconds=settings.push_claim_seconds)
        row.attempt_count += 1
    db.commit()
    return [row.id for row in rows]


def _finish_event(db: Session, event: NotificationOutbox, now: datetime) -> None:
    deliveries = list(db.scalars(select(PushDelivery).where(PushDelivery.outbox_id == event.id)))
    pending = [item for item in deliveries if item.status == "PENDING"]
    event.locked_until = None
    if pending:
        event.next_attempt_at = min(item.next_attempt_at for item in pending)
        return
    accepted = sum(1 for item in deliveries if item.status == "ACCEPTED")
    event.status = "DONE"
    event.completed_at = now
    if accepted == len(deliveries):
        event.result = "ACCEPTED"
    elif accepted:
        event.result = "PARTIAL"
    else:
        event.result = "FAILED"


def _process_event(
    event_id: UUID, *, clock: Clock, transport: PushTransport | None, stats: dict
) -> None:
    settings = get_settings()
    db = SessionLocal()
    try:
        event = db.get(NotificationOutbox, event_id)
        if event is None or event.status != "PENDING":
            return
        now = clock()
        if now - event.created_at > timedelta(seconds=settings.push_event_max_age_seconds):
            event.status, event.result, event.completed_at = "DONE", "EXPIRED", now
            event.locked_until = None
            db.commit()
            stats["expired"] += 1
            return
        if event.event_type == "ORDER_READY" and event.order_id is not None:
            order = db.get(Order, event.order_id)
            if order is None or order.status != "READY":
                event.status, event.result, event.completed_at = "DONE", "STALE", now
                event.locked_until = None
                db.commit()
                stats["stale"] += 1
                return
        subscription_ids = list(
            db.scalars(
                select(PushSubscription.id).where(
                    PushSubscription.user_id == event.recipient_user_id,
                    PushSubscription.enabled.is_(True),
                )
            )
        )
        if subscription_ids:
            db.execute(
                pg_insert(PushDelivery)
                .values(
                    [
                        {"outbox_id": event.id, "subscription_id": sid, "next_attempt_at": now}
                        for sid in subscription_ids
                    ]
                )
                .on_conflict_do_nothing(constraint="uq_push_deliveries_event_device")
            )
        elif not db.scalar(
            select(PushDelivery.id).where(PushDelivery.outbox_id == event.id).limit(1)
        ):
            event.status, event.result, event.completed_at = "DONE", "NO_SUBSCRIPTION", now
            event.locked_until = None
            db.commit()
            stats["no_subscription"] += 1
            return
        due = list(
            db.scalars(
                select(PushDelivery)
                .where(
                    PushDelivery.outbox_id == event.id,
                    PushDelivery.status == "PENDING",
                    PushDelivery.next_attempt_at <= now,
                    (PushDelivery.locked_until.is_(None)) | (PushDelivery.locked_until < now),
                )
                .with_for_update(skip_locked=True)
            )
        )
        work: list[tuple[UUID, int, str, str, str, UUID]] = []
        for delivery in due:
            subscription = db.get(PushSubscription, delivery.subscription_id)
            skip: str | None = None
            if subscription is None or not subscription.enabled:
                skip = "subscription_disabled"
            elif subscription.user_id != event.recipient_user_id:
                skip = "recipient_changed"
            elif subscription.expiration_time and subscription.expiration_time <= now:
                skip = "subscription_expired"
                subscription.enabled = False
                subscription.disabled_reason = "expired"
            if skip:
                delivery.status, delivery.error_code, delivery.locked_until = "SKIPPED", skip, None
                continue
            assert subscription is not None
            endpoint = decrypt(subscription.endpoint_enc)
            p256dh = decrypt(subscription.p256dh_enc)
            auth = decrypt(subscription.auth_enc)
            if not (endpoint and p256dh and auth):
                delivery.status, delivery.error_code, delivery.locked_until = (
                    "FAILED",
                    "undecryptable",
                    None,
                )
                continue
            delivery.attempt_count += 1
            delivery.locked_until = now + timedelta(seconds=settings.push_claim_seconds)
            work.append(
                (delivery.id, delivery.attempt_count, endpoint, p256dh, auth, subscription.id)
            )
        payload = json.dumps(event.payload, separators=(",", ":")).encode("utf-8")
        db.commit()  # claims are durable and no transaction stays open during network I/O

        results: list[
            tuple[UUID, UUID, int, str, TransportResult | None, TransportFailure | None, int]
        ] = []
        for delivery_id, attempt, endpoint, p256dh, auth, subscription_id in work:
            active = transport or select_transport(endpoint)
            started = time.perf_counter()
            result: TransportResult | None = None
            failure: TransportFailure | None = None
            try:
                result = active.send(
                    endpoint=endpoint,
                    p256dh=p256dh,
                    auth=auth,
                    payload=payload,
                    ttl=settings.push_ttl_seconds,
                    timeout=settings.push_timeout_seconds,
                    attempt=attempt,
                )
            except TransportFailure as exc:
                failure = exc
            except Exception as exc:  # never let one device stop the others
                logger.warning("push transport error: %s", type(exc).__name__)
                failure = TransportFailure("internal")
            elapsed = int((time.perf_counter() - started) * 1000)
            results.append(
                (delivery_id, subscription_id, attempt, active.name, result, failure, elapsed)
            )

        event = db.get(NotificationOutbox, event_id)
        assert event is not None
        done = clock()
        for delivery_id, subscription_id, attempt, name, result, failure, elapsed in results:
            delivery = db.get(PushDelivery, delivery_id)
            subscription = db.get(PushSubscription, subscription_id)
            if delivery is None:
                continue
            status, error_code, delay = classify(result, failure, attempt)
            delivery.status = status
            delivery.error_code = error_code
            delivery.transport = name
            delivery.latency_ms = elapsed
            delivery.last_attempt_at = done
            delivery.response_status = result.status_code if result else None
            delivery.locked_until = None
            if status == "PENDING" and delay is not None:
                delivery.next_attempt_at = done + timedelta(seconds=delay)
                stats["retried"] += 1
            if status == "ACCEPTED":
                delivery.accepted_at = done
                stats["accepted"] += 1
            elif status != "PENDING":
                stats["failed"] += 1
            if subscription is not None:
                subscription.last_attempt_at = done
                subscription.last_status_code = result.status_code if result else None
                if status == "ACCEPTED":
                    subscription.last_success_at = done
                    subscription.failure_count = 0
                else:
                    subscription.failure_count += 1
                if status == "GONE":
                    subscription.enabled = False
                    subscription.disabled_reason = "gone"
        db.flush()
        _finish_event(db, event, done)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("outbox event processing failed")
        stats["errors"] += 1
    finally:
        db.close()


def drain_outbox(
    *, clock: Clock = utcnow, transport: PushTransport | None = None, limit: int = 25
) -> dict:
    """Process due outbox events once. Safe to run from several workers at the same time."""

    stats = {
        "claimed": 0,
        "accepted": 0,
        "retried": 0,
        "failed": 0,
        "expired": 0,
        "stale": 0,
        "no_subscription": 0,
        "errors": 0,
    }
    db = SessionLocal()
    try:
        event_ids = _claim_events(db, clock(), limit)
    finally:
        db.close()
    stats["claimed"] = len(event_ids)
    for event_id in event_ids:
        _process_event(event_id, clock=clock, transport=transport, stats=stats)
    return stats


def outbox_metrics(db: Session) -> dict:
    """Counts and latency figures for the protected status endpoint."""

    by_status = dict(
        db.execute(select(PushDelivery.status, func.count()).group_by(PushDelivery.status)).all()
    )
    pending_events = db.scalar(
        select(func.count())
        .select_from(NotificationOutbox)
        .where(NotificationOutbox.status == "PENDING")
    )
    latency = db.execute(
        select(
            func.avg(PushDelivery.latency_ms),
            func.max(PushDelivery.latency_ms),
            func.avg(PushDelivery.attempt_count),
        ).where(PushDelivery.last_attempt_at.is_not(None))
    ).one()
    return {
        "deliveries_by_status": {key: int(value) for key, value in by_status.items()},
        "pending_events": int(pending_events or 0),
        "avg_latency_ms": float(latency[0]) if latency[0] is not None else None,
        "max_latency_ms": int(latency[1]) if latency[1] is not None else None,
        "avg_attempts": float(latency[2]) if latency[2] is not None else None,
    }
