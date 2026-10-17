"""P005 integration tests on real PostgreSQL (database bowlbyte_test).

Covers cash confirmation, manager reversal, one-time pickup credentials,
the notification outbox, Web Push delivery with a controlled push-service
simulator, and the security rules around all of them.
"""

import base64
import threading
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text, update
from sqlalchemy.exc import DBAPIError

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.fulfillment import (
    CashReceipt,
    CashReversal,
    Notification,
    NotificationOutbox,
    PickupCredential,
    PickupEvent,
    PushDelivery,
    PushSubscription,
)
from app.models.identity import CASHIER, KITCHEN_STAFF, AuditLog, Canteen
from app.models.ordering import Order, OrderEvent, OrderPayment
from app.services.push import SIMULATOR_HOST
from app.services.push_delivery import drain_outbox
from app.services.rate_limit import clear_counters
from tests.test_kitchen_integration import _order
from tests.test_ordering_integration import (
    _add_user,
    _bootstrap,
    _csrf,
    _email,
    _login,
    _sellable,
    _student_email,
)

pytestmark = pytest.mark.integration

PRICE = 4000


@pytest.fixture(autouse=True)
def reset_tables():
    database = get_settings().database_url.rsplit("/", 1)[-1].split("?")[0]
    if database != "bowlbyte_test":
        pytest.fail("P005 integration tests must use the bowlbyte_test database.")
    db = SessionLocal()
    db.execute(
        text(
            "TRUNCATE push_deliveries, notification_outbox, notifications, push_subscriptions, "
            "order_hold_events, pickup_events, pickup_credentials, cash_reversals, cash_receipts, "
            "preparation_tasks, order_idempotency_records, inventory_adjustments, "
            "order_payments, order_events, order_items, orders, daily_stock, "
            "menu_item_station_assignments, menu_item_pairings, menu_items, kitchen_stations, menu_categories, "
            "audit_log, sessions, staff_invitations, email_verification_tokens, "
            "student_roster_entries, staff_memberships, student_profiles, "
            "users, canteens, colleges RESTART IDENTITY CASCADE"
        )
    )
    db.commit()
    db.close()
    clear_counters()
    settings = get_settings()
    saved = (
        settings.push_allow_test_endpoints,
        settings.vapid_public_key,
        settings.vapid_private_key,
    )
    settings.push_allow_test_endpoints = True
    settings.vapid_public_key = settings.vapid_public_key or "test-public-key"
    yield
    settings.push_allow_test_endpoints, settings.vapid_public_key, settings.vapid_private_key = (
        saved
    )
    clear_counters()


# --- helpers ---------------------------------------------------------------------------


def _world(client: TestClient, stock: int = 20) -> SimpleNamespace:
    manager_email, college_id, canteen_id = _bootstrap()
    world = SimpleNamespace(
        manager_email=manager_email,
        college_id=college_id,
        canteen_id=canteen_id,
        student=_add_user("STUDENT", _student_email(), None, college_id),
        other_student=_add_user("STUDENT", _student_email(), None, college_id),
        kitchen=_add_user(KITCHEN_STAFF, _email("kitchen"), canteen_id, college_id),
        cashier=_add_user(CASHIER, _email("cashier"), canteen_id, college_id),
    )
    _login(client, manager_email)
    world.item = _sellable(client, stock=stock)
    return world


def _second_canteen_cashier(world: SimpleNamespace):
    db = SessionLocal()
    canteen = Canteen(
        college_id=world.college_id, name="Other", slug=f"other-{uuid.uuid4().hex[:6]}"
    )
    db.add(canteen)
    db.flush()
    other_id = canteen.id
    db.commit()
    db.close()
    return _add_user(CASHIER, _email("cashier-b"), other_id, world.college_id)


def _extra_cashiers(world: SimpleNamespace, count: int):
    # One account holds one live session, so concurrent counters need their own accounts.
    return [
        _add_user(CASHIER, _email(f"cashier-{index}"), world.canteen_id, world.college_id)
        for index in range(count)
    ]


def _ready_order(client: TestClient, world: SimpleNamespace, quantity: int = 1, student=None):
    saved = _order(student or world.student, uuid.UUID(world.item["id"]), quantity)
    _login(client, world.kitchen.email)
    accepted = client.post(f"/api/v1/staff/orders/{saved['id']}/accept", headers=_csrf(client))
    assert accepted.status_code == 200, accepted.text
    for task in accepted.json()["tasks"]:
        started = client.post(
            f"/api/v1/staff/preparation-tasks/{task['id']}/start", headers=_csrf(client)
        )
        assert started.status_code == 200, started.text
        done = client.post(
            f"/api/v1/staff/preparation-tasks/{task['id']}/complete", headers=_csrf(client)
        )
        assert done.status_code == 200, done.text
    ready = client.post(
        f"/api/v1/staff/orders/{saved['id']}/ready", json={"packed": True}, headers=_csrf(client)
    )
    assert ready.status_code == 200, ready.text
    return str(saved["id"]), ready.json()["ticket_number"]


def _confirm(client: TestClient, order_id: str, amount: int = PRICE, key: str | None = None):
    return client.post(
        f"/api/v1/cashier/orders/{order_id}/confirm-cash",
        json={"amount_paise": amount, "idempotency_key": key or uuid.uuid4().hex},
        headers=_csrf(client),
    )


def _issue(client: TestClient, order_id: str):
    return client.post(f"/api/v1/orders/{order_id}/pickup-credential", headers=_csrf(client))


def _verify(client: TestClient, **body):
    return client.post("/api/v1/cashier/pickup/verify", json=body, headers=_csrf(client))


def _complete(client: TestClient, order_id: str, key: str | None = None, **credential):
    return client.post(
        f"/api/v1/cashier/orders/{order_id}/complete-pickup",
        json={**credential, "idempotency_key": key or uuid.uuid4().hex},
        headers=_csrf(client),
    )


def _reverse(client: TestClient, receipt_id: str, key: str | None = None, **overrides):
    body = {
        "reason": "Cash handed back to student",
        "kind": "CASH_RETURNED",
        "confirm": True,
        "idempotency_key": key or uuid.uuid4().hex,
    }
    body.update(overrides)
    return client.post(f"/api/v1/admin/cash/{receipt_id}/reverse", json=body, headers=_csrf(client))


def _new_client(app, email: str) -> TestClient:
    local = TestClient(app)
    local.headers.update({"origin": "http://localhost:3000"})
    _login(local, email)
    return local


def _keys() -> dict:
    private = ec.generate_private_key(ec.SECP256R1())
    point = private.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    return {
        "p256dh": base64.urlsafe_b64encode(point).rstrip(b"=").decode(),
        "auth": base64.urlsafe_b64encode(uuid.uuid4().bytes).rstrip(b"=").decode(),
    }


def _endpoint(mode: str = "accept") -> str:
    return f"https://{SIMULATOR_HOST}/{mode}/{uuid.uuid4().hex}"


def _subscribe(client: TestClient, endpoint: str | None = None, expect: int = 201):
    response = client.post(
        "/api/v1/push/subscriptions",
        json={"endpoint": endpoint or _endpoint(), "keys": _keys(), "device_label": "Test phone"},
        headers=_csrf(client),
    )
    assert response.status_code == expect, response.text
    return response


def _db_one(query):
    db = SessionLocal()
    try:
        return db.scalar(query)
    finally:
        db.close()


def _drain(offset_seconds: int = 0) -> dict:
    return drain_outbox(clock=lambda: datetime.now(UTC) + timedelta(seconds=offset_seconds))


# --- cash confirmation -----------------------------------------------------------------


def test_only_cashier_can_record_cash(client: TestClient) -> None:
    world = _world(client)
    order_id, _ = _ready_order(client, world)
    for email in (world.student.email, world.kitchen.email, world.manager_email):
        _login(client, email)
        assert _confirm(client, order_id).status_code == 403
        assert client.get("/api/v1/cashier/orders").status_code == 403
    payment = _db_one(select(OrderPayment).where(OrderPayment.order_id == uuid.UUID(order_id)))
    assert payment.status == "PENDING"
    _login(client, world.cashier.email)
    assert (
        client.post(
            f"/api/v1/cashier/orders/{order_id}/confirm-cash",
            json={"amount_paise": PRICE, "idempotency_key": uuid.uuid4().hex},
        ).status_code
        == 403
    )  # missing CSRF token


def test_cash_requires_ready_order(client: TestClient) -> None:
    world = _world(client)
    saved = _order(world.student, uuid.UUID(world.item["id"]), 1)
    _login(client, world.cashier.email)
    placed = _confirm(client, str(saved["id"]))
    assert placed.status_code == 409
    assert placed.json()["error"]["code"] == "ORDER_NOT_READY"
    _login(client, world.kitchen.email)
    client.post(f"/api/v1/staff/orders/{saved['id']}/accept", headers=_csrf(client))
    _login(client, world.cashier.email)
    assert _confirm(client, str(saved["id"])).status_code == 409
    assert _db_one(select(func.count()).select_from(CashReceipt)) == 0


def test_confirm_cash_records_receipt_audit_and_keeps_order_ready(client: TestClient) -> None:
    world = _world(client)
    order_id, ticket = _ready_order(client, world, quantity=2)
    _login(client, world.cashier.email)
    response = _confirm(client, order_id, amount=2 * PRICE)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["replayed"] is False
    assert body["receipt"]["amount_paise"] == 2 * PRICE
    assert body["receipt"]["cashier_user_id"] == str(world.cashier.id)
    assert body["receipt"]["ticket_number"] == ticket
    assert body["order"]["status"] == "READY"
    assert body["order"]["payment"]["status"] == "PAID"
    assert body["order"]["payment"]["receipt_ref"].startswith("CR-")
    db = SessionLocal()
    payment = db.scalar(select(OrderPayment).where(OrderPayment.order_id == uuid.UUID(order_id)))
    assert payment.paid_by == world.cashier.id and payment.paid_at is not None
    order = db.get(Order, uuid.UUID(order_id))
    assert order.status == "READY" and order.picked_up_at is None
    assert (
        db.scalar(
            select(func.count()).select_from(AuditLog).where(AuditLog.action == "cash.confirmed")
        )
        == 1
    )
    event = db.scalar(
        select(OrderEvent).where(
            OrderEvent.order_id == order.id, OrderEvent.reason.like("cash_received:%")
        )
    )
    assert event is not None and event.from_status == event.to_status == "READY"
    db.close()


def test_amount_must_match_stored_total_in_integer_paise(client: TestClient) -> None:
    world = _world(client)
    order_id, _ = _ready_order(client, world)
    _login(client, world.cashier.email)
    wrong = _confirm(client, order_id, amount=PRICE - 1)
    assert wrong.status_code == 409
    assert wrong.json()["error"]["code"] == "AMOUNT_MISMATCH"
    fractional = client.post(
        f"/api/v1/cashier/orders/{order_id}/confirm-cash",
        json={"amount_paise": 40.5, "idempotency_key": uuid.uuid4().hex},
        headers=_csrf(client),
    )
    assert fractional.status_code == 422
    assert _db_one(select(func.count()).select_from(CashReceipt)) == 0


def test_cash_retry_is_idempotent_and_second_attempt_is_rejected(client: TestClient) -> None:
    world = _world(client)
    order_id, _ = _ready_order(client, world)
    _login(client, world.cashier.email)
    first = _confirm(client, order_id, key="retry-key-0001")
    again = _confirm(client, order_id, key="retry-key-0001")
    assert first.status_code == again.status_code == 200
    assert again.json()["replayed"] is True
    assert again.json()["receipt"]["id"] == first.json()["receipt"]["id"]
    other = _confirm(client, order_id, key="another-key-0002")
    assert other.status_code == 409
    assert other.json()["error"]["code"] == "ALREADY_PAID"
    assert _db_one(select(func.count()).select_from(CashReceipt)) == 1


def test_concurrent_cash_confirmations_create_one_receipt(client: TestClient) -> None:
    world = _world(client)
    order_id, _ = _ready_order(client, world)
    clients = [_new_client(client.app, cashier.email) for cashier in _extra_cashiers(world, 4)]
    barrier = threading.Barrier(len(clients))
    statuses: list[int] = []

    def attempt(local: TestClient) -> None:
        barrier.wait()
        statuses.append(_confirm(local, order_id).status_code)

    threads = [threading.Thread(target=attempt, args=(local,)) for local in clients]
    [thread.start() for thread in threads]
    [thread.join() for thread in threads]
    assert sorted(statuses) == [200, 409, 409, 409]
    assert _db_one(select(func.count()).select_from(CashReceipt)) == 1


def test_cashier_is_limited_to_their_own_canteen(client: TestClient) -> None:
    world = _world(client)
    order_id, _ = _ready_order(client, world)
    outsider = _second_canteen_cashier(world)
    _login(client, outsider.email)
    assert _confirm(client, order_id).status_code == 404
    assert client.get(f"/api/v1/cashier/orders/{order_id}").status_code == 404
    board = client.get("/api/v1/cashier/orders").json()
    assert board["awaiting_payment"] == []
    assert _db_one(select(func.count()).select_from(CashReceipt)) == 0


def test_payment_cannot_be_set_through_order_or_student_endpoints(client: TestClient) -> None:
    world = _world(client)
    order_id, _ = _ready_order(client, world)
    _login(client, world.student.email)
    for path, method in (
        (f"/api/v1/orders/{order_id}", "patch"),
        (f"/api/v1/orders/{order_id}/pay", "post"),
        (f"/api/v1/orders/{order_id}/payment", "post"),
    ):
        response = getattr(client, method)(path, json={"status": "PAID"}, headers=_csrf(client))
        assert response.status_code in {404, 405, 422}
    payment = _db_one(select(OrderPayment).where(OrderPayment.order_id == uuid.UUID(order_id)))
    assert payment.status == "PENDING"


# --- manager correction ------------------------------------------------------------------


def test_only_manager_reverses_cash_and_receipt_is_preserved(client: TestClient) -> None:
    world = _world(client)
    order_id, _ = _ready_order(client, world)
    _login(client, world.cashier.email)
    receipt_id = _confirm(client, order_id).json()["receipt"]["id"]
    assert _reverse(client, receipt_id).status_code == 403
    _login(client, world.student.email)
    assert _reverse(client, receipt_id).status_code == 403
    _login(client, world.manager_email)
    assert _reverse(client, receipt_id, reason="no").status_code == 422
    assert _reverse(client, receipt_id, confirm=False).status_code == 422
    done = _reverse(client, receipt_id, key="reverse-key-001")
    assert done.status_code == 200, done.text
    assert done.json()["receipt"]["reversed"] is True
    again = _reverse(client, receipt_id, key="reverse-key-002")
    assert again.status_code == 200 and again.json()["replayed"] is True
    db = SessionLocal()
    assert db.scalar(select(func.count()).select_from(CashReceipt)) == 1
    reversal = db.scalar(select(CashReversal))
    assert reversal.manager_user_id is not None and len(reversal.reason) >= 5
    payment = db.scalar(select(OrderPayment).where(OrderPayment.order_id == uuid.UUID(order_id)))
    assert payment.status == "PENDING" and payment.paid_at is None
    assert db.scalar(select(func.count()).select_from(CashReversal)) == 1
    db.close()
    _login(client, world.cashier.email)
    reconfirm = _confirm(client, order_id)
    assert reconfirm.status_code == 200
    assert reconfirm.json()["receipt"]["id"] != receipt_id
    assert _db_one(select(func.count()).select_from(CashReceipt)) == 2


def test_reversal_is_blocked_after_pickup(client: TestClient) -> None:
    world = _world(client)
    order_id, _ = _ready_order(client, world)
    _login(client, world.cashier.email)
    receipt_id = _confirm(client, order_id).json()["receipt"]["id"]
    _login(client, world.student.email)
    token = _issue(client, order_id).json()["token"]
    _login(client, world.cashier.email)
    assert _complete(client, order_id, token=token).status_code == 200
    _login(client, world.manager_email)
    blocked = _reverse(client, receipt_id)
    assert blocked.status_code == 409
    assert _db_one(select(func.count()).select_from(CashReversal)) == 0


def test_cash_ledgers_and_pickup_events_are_append_only(client: TestClient) -> None:
    world = _world(client)
    order_id, _ = _ready_order(client, world)
    _login(client, world.cashier.email)
    receipt_id = _confirm(client, order_id).json()["receipt"]["id"]
    _login(client, world.student.email)
    _issue(client, order_id)
    for statement in (
        "UPDATE cash_receipts SET amount_paise = 1",
        "DELETE FROM cash_receipts",
        "UPDATE pickup_events SET outcome = 'x'",
        "DELETE FROM pickup_events",
    ):
        db = SessionLocal()
        with pytest.raises(DBAPIError):
            db.execute(text(statement))
        db.rollback()
        db.close()
    _login(client, world.manager_email)
    _reverse(client, receipt_id)
    db = SessionLocal()
    with pytest.raises(DBAPIError):
        db.execute(text("UPDATE cash_reversals SET reason = 'edited reason'"))
    db.rollback()
    db.close()


# --- pickup credentials --------------------------------------------------------------------


def test_credential_is_issued_only_for_own_ready_order(client: TestClient) -> None:
    world = _world(client)
    saved = _order(world.student, uuid.UUID(world.item["id"]), 1)
    _login(client, world.student.email)
    early = _issue(client, str(saved["id"]))
    assert early.status_code == 409
    assert early.json()["error"]["code"] == "ORDER_NOT_READY"
    order_id, _ = _ready_order(client, world)
    _login(client, world.other_student.email)
    assert _issue(client, order_id).status_code == 404
    assert client.get(f"/api/v1/orders/{order_id}/pickup-status").status_code == 404
    _login(client, world.cashier.email)
    assert _issue(client, order_id).status_code == 403
    _login(client, world.student.email)
    issued = _issue(client, order_id)
    assert issued.status_code == 200, issued.text
    assert issued.json()["token"].startswith("bbp1.")
    status = client.get(f"/api/v1/orders/{order_id}/pickup-status").json()
    assert status["state"] == "ACTIVE" and status["payment_status"] == "PENDING"


def test_only_hashes_of_credentials_are_stored(client: TestClient) -> None:
    world = _world(client)
    order_id, _ = _ready_order(client, world)
    _login(client, world.student.email)
    issued = _issue(client, order_id).json()
    db = SessionLocal()
    row = db.scalar(select(PickupCredential))
    assert issued["token"] not in (row.token_hash, row.code_hash)
    assert len(row.token_hash) == 64 and len(row.code_hash) == 64
    raw = issued["code"].replace("-", "")
    dump = db.execute(text("SELECT row_to_json(c)::text FROM pickup_credentials c")).scalar()
    assert issued["token"] not in dump and raw not in dump and issued["code"] not in dump
    events = db.execute(
        text("SELECT string_agg(row_to_json(e)::text, ' ') FROM pickup_events e")
    ).scalar()
    assert issued["token"] not in (events or "") and raw not in (events or "")
    db.close()
    assert get_settings().pickup_hash_key != issued["token"]


def test_reissue_revokes_the_earlier_credential(client: TestClient) -> None:
    world = _world(client)
    order_id, _ = _ready_order(client, world)
    _login(client, world.student.email)
    first = _issue(client, order_id).json()
    second = _issue(client, order_id).json()
    assert second["replaced_previous"] is True and second["token"] != first["token"]
    _login(client, world.cashier.email)
    old = _verify(client, token=first["token"])
    assert old.status_code == 409 and old.json()["error"]["code"] == "PICKUP_REVOKED"
    assert _verify(client, token=second["token"]).status_code == 200
    assert (
        _db_one(
            select(func.count())
            .select_from(PickupCredential)
            .where(PickupCredential.revoked_at.is_(None))
        )
        == 1
    )


def test_issue_requests_are_rate_limited(client: TestClient) -> None:
    world = _world(client)
    order_id, _ = _ready_order(client, world)
    _login(client, world.student.email)
    limit = get_settings().pickup_issue_limit
    codes = [_issue(client, order_id).status_code for _ in range(limit + 2)]
    assert codes[:limit] == [200] * limit
    assert set(codes[limit:]) == {429}


def test_scanning_never_marks_paid_or_consumes_the_credential(client: TestClient) -> None:
    world = _world(client)
    order_id, _ = _ready_order(client, world)
    _login(client, world.student.email)
    token = _issue(client, order_id).json()["token"]
    _login(client, world.cashier.email)
    for _ in range(3):
        verified = _verify(client, token=token)
        assert verified.status_code == 200
        body = verified.json()
        assert body["can_confirm_cash"] is True and body["can_complete_pickup"] is False
        assert body["order"]["payment"]["status"] == "PENDING"
    db = SessionLocal()
    assert db.get(Order, uuid.UUID(order_id)).status == "READY"
    assert db.scalar(select(PickupCredential)).redeemed_at is None
    assert db.scalar(select(func.count()).select_from(CashReceipt)) == 0
    db.close()


def test_handover_requires_recorded_cash(client: TestClient) -> None:
    world = _world(client)
    order_id, _ = _ready_order(client, world)
    _login(client, world.student.email)
    token = _issue(client, order_id).json()["token"]
    _login(client, world.cashier.email)
    blocked = _complete(client, order_id, token=token)
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "PAYMENT_PENDING"
    assert _db_one(select(Order.status).where(Order.id == uuid.UUID(order_id))) == "READY"
    assert _db_one(select(PickupCredential.redeemed_at)) is None
    assert _confirm(client, order_id).status_code == 200
    done = _complete(client, order_id, token=token)
    assert done.status_code == 200, done.text
    assert done.json()["order"]["status"] == "PICKED_UP"


def test_full_pickup_records_cashier_events_and_completes_status(client: TestClient) -> None:
    world = _world(client)
    order_id, _ = _ready_order(client, world)
    _login(client, world.student.email)
    token = _issue(client, order_id).json()["token"]
    _login(client, world.cashier.email)
    assert _confirm(client, order_id).status_code == 200
    verified = _verify(client, token=token).json()
    assert verified["can_complete_pickup"] is True
    assert _complete(client, order_id, token=token).status_code == 200
    db = SessionLocal()
    order = db.get(Order, uuid.UUID(order_id))
    assert order.status == "PICKED_UP" and order.picked_up_by == world.cashier.id
    assert order.picked_up_at is not None
    credential = db.scalar(select(PickupCredential))
    assert credential.redeemed_by == world.cashier.id
    kinds = [
        row for row in db.scalars(select(PickupEvent.event_type).order_by(PickupEvent.created_at))
    ]
    assert kinds[0] == "ISSUED" and kinds[-1] == "REDEEMED" and "VERIFIED" in kinds
    transition = db.scalar(
        select(OrderEvent).where(
            OrderEvent.order_id == order.id, OrderEvent.to_status == "PICKED_UP"
        )
    )
    assert transition.from_status == "READY" and transition.actor_user_id == world.cashier.id
    db.close()
    _login(client, world.student.email)
    status = client.get(f"/api/v1/orders/{order_id}/pickup-status").json()
    assert status["state"] == "COLLECTED"
    assert _issue(client, order_id).status_code == 409


def test_credential_can_never_be_redeemed_twice(client: TestClient) -> None:
    world = _world(client)
    order_id, _ = _ready_order(client, world)
    _login(client, world.student.email)
    token = _issue(client, order_id).json()["token"]
    _login(client, world.cashier.email)
    _confirm(client, order_id)
    first = _complete(client, order_id, key="redeem-key-0001", token=token)
    assert first.status_code == 200 and first.json()["replayed"] is False
    replay = _complete(client, order_id, key="redeem-key-0001", token=token)
    assert replay.status_code == 200 and replay.json()["replayed"] is True
    second = _complete(client, order_id, key="redeem-key-0002", token=token)
    assert second.status_code == 409 and second.json()["error"]["code"] == "PICKUP_USED"
    reverify = _verify(client, token=token)
    assert reverify.status_code == 409
    assert (
        _db_one(
            select(func.count()).select_from(OrderEvent).where(OrderEvent.to_status == "PICKED_UP")
        )
        == 1
    )


def test_concurrent_redemptions_allow_exactly_one(client: TestClient) -> None:
    world = _world(client)
    order_id, _ = _ready_order(client, world)
    _login(client, world.student.email)
    token = _issue(client, order_id).json()["token"]
    _login(client, world.cashier.email)
    _confirm(client, order_id)
    clients = [_new_client(client.app, cashier.email) for cashier in _extra_cashiers(world, 4)]
    barrier = threading.Barrier(len(clients))
    results: list[tuple[int, bool | None]] = []

    def attempt(local: TestClient) -> None:
        barrier.wait()
        response = _complete(local, order_id, token=token)
        replayed = response.json().get("replayed") if response.status_code == 200 else None
        results.append((response.status_code, replayed))

    threads = [threading.Thread(target=attempt, args=(local,)) for local in clients]
    [thread.start() for thread in threads]
    [thread.join() for thread in threads]
    assert sorted(code for code, _ in results) == [200, 409, 409, 409]
    assert (
        _db_one(
            select(func.count())
            .select_from(PickupCredential)
            .where(PickupCredential.redeemed_at.is_not(None))
        )
        == 1
    )


def test_expired_credential_is_rejected(client: TestClient) -> None:
    world = _world(client)
    order_id, _ = _ready_order(client, world)
    _login(client, world.student.email)
    token = _issue(client, order_id).json()["token"]
    db = SessionLocal()
    db.execute(
        update(PickupCredential).values(
            created_at=datetime.now(UTC) - timedelta(minutes=10),
            expires_at=datetime.now(UTC) - timedelta(seconds=1),
        )
    )
    db.commit()
    db.close()
    _login(client, world.student.email)
    assert client.get(f"/api/v1/orders/{order_id}/pickup-status").json()["state"] == "EXPIRED"
    _login(client, world.cashier.email)
    _confirm(client, order_id)
    expired = _verify(client, token=token)
    assert expired.status_code == 410 and expired.json()["error"]["code"] == "PICKUP_EXPIRED"
    assert _complete(client, order_id, token=token).status_code == 410
    _login(client, world.student.email)
    fresh = _issue(client, order_id)
    assert fresh.status_code == 200
    _login(client, world.cashier.email)
    assert _complete(client, order_id, token=fresh.json()["token"]).status_code == 200


def test_manual_code_works_with_ticket_and_is_normalised(client: TestClient) -> None:
    world = _world(client)
    order_id, ticket = _ready_order(client, world)
    _login(client, world.student.email)
    code = _issue(client, order_id).json()["code"]
    assert len(code.replace("-", "")) == 12
    _login(client, world.cashier.email)
    sloppy = code.lower().replace("-", " ")
    assert _verify(client, ticket_number=ticket, code=sloppy).status_code == 200
    assert _verify(client, ticket_number=ticket.lower(), code=code).status_code == 200
    assert _verify(client, code=code).status_code == 422
    assert _verify(client, token="x", code=code, ticket_number=ticket).status_code == 422
    _confirm(client, order_id)
    done = _complete(client, order_id, code=code)
    assert done.status_code == 200, done.text


def test_wrong_manual_codes_are_rate_limited(client: TestClient) -> None:
    world = _world(client)
    order_id, ticket = _ready_order(client, world)
    _login(client, world.student.email)
    code = _issue(client, order_id).json()["code"]
    _login(client, world.cashier.email)
    limit = get_settings().pickup_ticket_failure_limit
    outcomes = [
        _verify(client, ticket_number=ticket, code="AAAA-BBBB-CCCC").status_code
        for _ in range(limit)
    ]
    assert outcomes == [404] * limit
    locked = _verify(client, ticket_number=ticket, code=code)
    assert locked.status_code == 429
    assert _db_one(select(PickupCredential.redeemed_at)) is None


def test_other_canteen_credentials_look_unknown(client: TestClient) -> None:
    world = _world(client)
    order_id, ticket = _ready_order(client, world)
    _login(client, world.student.email)
    issued = _issue(client, order_id).json()
    outsider = _second_canteen_cashier(world)
    _login(client, outsider.email)
    by_token = _verify(client, token=issued["token"])
    by_code = _verify(client, ticket_number=ticket, code=issued["code"])
    assert by_token.status_code == by_code.status_code == 404
    assert by_token.json()["error"]["message"] == by_code.json()["error"]["message"]
    assert _complete(client, order_id, token=issued["token"]).status_code == 404
    garbage = _verify(client, token="bbp1.not-a-real-token")
    assert garbage.status_code == 404
    assert garbage.json()["error"]["message"] == by_token.json()["error"]["message"]


# --- notifications and outbox --------------------------------------------------------------


def test_ready_creates_exactly_one_notification_and_outbox_row(client: TestClient) -> None:
    world = _world(client)
    order_id, ticket = _ready_order(client, world)
    _login(client, world.kitchen.email)
    again = client.post(
        f"/api/v1/staff/orders/{order_id}/ready", json={"packed": True}, headers=_csrf(client)
    )
    assert again.status_code == 200
    db = SessionLocal()
    notes = list(db.scalars(select(Notification)))
    assert len(notes) == 1 and notes[0].user_id == world.student.id
    assert notes[0].title == "BowlByte — Your Food Is Ready!"
    assert notes[0].body == (
        f"Order #{ticket} is ready. Please pay cash at the canteen counter and collect your food."
    )
    outbox = list(db.scalars(select(NotificationOutbox)))
    assert len(outbox) == 1 and outbox[0].status == "PENDING"
    assert outbox[0].payload["tag"] == f"order-{order_id}"
    assert outbox[0].payload["url"] == f"/student/orders/{order_id}"
    assert "email" not in str(outbox[0].payload).lower()
    db.close()


def test_in_app_notifications_are_private_and_markable(client: TestClient) -> None:
    world = _world(client)
    _ready_order(client, world)
    _login(client, world.other_student.email)
    assert client.get("/api/v1/notifications").json()["items"] == []
    _login(client, world.student.email)
    listing = client.get("/api/v1/notifications").json()
    assert listing["unread_count"] == 1 and len(listing["items"]) == 1
    note_id = listing["items"][0]["id"]
    _login(client, world.other_student.email)
    assert (
        client.post(f"/api/v1/notifications/{note_id}/read", headers=_csrf(client)).status_code
        == 404
    )
    _login(client, world.student.email)
    assert client.post(f"/api/v1/notifications/{note_id}/read").status_code == 403
    done = client.post(f"/api/v1/notifications/{note_id}/read", headers=_csrf(client))
    assert done.status_code == 200 and done.json()["unread_count"] == 0
    assert (
        client.post(f"/api/v1/notifications/{note_id}/read", headers=_csrf(client)).status_code
        == 200
    )
    _login(client, world.cashier.email)
    assert client.get("/api/v1/notifications").status_code == 403


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://fcm.googleapis.com/fcm/send/abc",
        "https://127.0.0.1/push/abc",
        "https://localhost/push",
        "https://169.254.169.254/latest/meta-data",
        "https://[::1]/push",
        "https://evil.example.com/fcm/send/abc",
        "https://fcm.googleapis.com.evil.example.com/fcm/send/abc",
        "https://fcm.googleapis.com@evil.example.com/fcm/send/abc",
        "https://user:pass@fcm.googleapis.com/fcm/send/abc",
        "https://fcm.googleapis.com:8443/fcm/send/abc",
        "https://notify.windows.com/x",
        "ftp://fcm.googleapis.com/x",
        "https://fcm.googleapis.com/" + "a" * 1100,
        "https://push-test.bowlbyte.invalid/ok\nHost: evil",
    ],
)
def test_unsafe_push_endpoints_are_rejected(client: TestClient, endpoint: str) -> None:
    world = _world(client)
    _login(client, world.student.email)
    response = client.post(
        "/api/v1/push/subscriptions",
        json={"endpoint": endpoint, "keys": _keys()},
        headers=_csrf(client),
    )
    assert response.status_code in {422}, response.text
    assert _db_one(select(func.count()).select_from(PushSubscription)) == 0


def test_real_push_hosts_are_accepted_by_validation() -> None:
    from app.services.push import validate_endpoint

    for url in (
        "https://fcm.googleapis.com/fcm/send/abc",
        "https://updates.push.services.mozilla.com/wpush/v2/abc",
        "https://web.push.apple.com/QabC",
        "https://wns2-par02p.notify.windows.com/w/?token=abc",
    ):
        assert validate_endpoint(url) == url


def test_test_hosts_are_blocked_unless_explicitly_enabled(client: TestClient) -> None:
    world = _world(client)
    _login(client, world.student.email)
    get_settings().push_allow_test_endpoints = False
    response = client.post(
        "/api/v1/push/subscriptions",
        json={"endpoint": _endpoint(), "keys": _keys()},
        headers=_csrf(client),
    )
    assert response.status_code == 422


def test_invalid_subscription_keys_are_rejected(client: TestClient) -> None:
    world = _world(client)
    _login(client, world.student.email)
    for keys in (
        {"p256dh": "AAAA", "auth": "AAAAAAAAAAAAAAAAAAAAAA"},
        {"p256dh": _keys()["p256dh"], "auth": "short"},
        {"p256dh": "!!!", "auth": "!!!"},
    ):
        response = client.post(
            "/api/v1/push/subscriptions",
            json={"endpoint": _endpoint(), "keys": keys},
            headers=_csrf(client),
        )
        assert response.status_code == 422


def test_subscriptions_are_encrypted_owned_and_movable(client: TestClient) -> None:
    world = _world(client)
    endpoint = _endpoint()
    _login(client, world.student.email)
    assert client.get("/api/v1/push/public-key").json()["supported"] is True
    assert _subscribe(client, endpoint).json()["created"] is True
    assert _subscribe(client, endpoint, expect=200).json()["created"] is False
    db = SessionLocal()
    dump = db.execute(text("SELECT row_to_json(s)::text FROM push_subscriptions s")).scalar()
    assert endpoint not in dump and SIMULATOR_HOST not in dump
    db.close()
    listing = client.get("/api/v1/push/subscriptions").json()
    assert len(listing) == 1 and "endpoint" not in str(listing)
    _login(client, world.other_student.email)
    removed = client.request(
        "DELETE",
        "/api/v1/push/subscriptions",
        json={"endpoint": endpoint},
        headers=_csrf(client),
    )
    assert removed.status_code == 204
    assert _db_one(select(func.count()).select_from(PushSubscription)) == 1  # not theirs
    _subscribe(client, endpoint, expect=200)  # same browser, new account: it moves
    assert _db_one(select(PushSubscription.user_id)) == world.other_student.id
    _login(client, world.student.email)
    assert client.get("/api/v1/push/subscriptions").json() == []
    _login(client, world.other_student.email)
    gone = client.request(
        "DELETE", "/api/v1/push/subscriptions", json={"endpoint": endpoint}, headers=_csrf(client)
    )
    assert gone.status_code == 204
    assert _db_one(select(func.count()).select_from(PushSubscription)) == 0


def test_subscription_endpoints_require_student_session_and_csrf(client: TestClient) -> None:
    world = _world(client)
    _login(client, world.cashier.email)
    assert client.get("/api/v1/push/public-key").status_code == 403
    assert (
        client.post(
            "/api/v1/push/subscriptions",
            json={"endpoint": _endpoint(), "keys": _keys()},
            headers=_csrf(client),
        ).status_code
        == 403
    )
    _login(client, world.student.email)
    assert (
        client.post(
            "/api/v1/push/subscriptions", json={"endpoint": _endpoint(), "keys": _keys()}
        ).status_code
        == 403
    )
    client.cookies.clear()
    assert client.get("/api/v1/push/public-key").status_code == 401


def test_push_delivery_is_accepted_but_never_claimed_displayed(client: TestClient) -> None:
    world = _world(client)
    _login(client, world.student.email)
    _subscribe(client, _endpoint("accept"))
    order_id, _ = _ready_order(client, world)
    stats = _drain()
    assert stats["accepted"] == 1 and stats["failed"] == 0
    db = SessionLocal()
    event = db.scalar(select(NotificationOutbox))
    delivery = db.scalar(select(PushDelivery))
    assert event.status == "DONE" and event.result == "ACCEPTED"
    assert delivery.status == "ACCEPTED" and delivery.transport == "simulator"
    assert delivery.response_status == 201 and delivery.latency_ms is not None
    assert not hasattr(delivery, "displayed_at")
    assert db.get(Order, uuid.UUID(order_id)).status == "READY"
    assert (
        db.scalar(select(OrderPayment.status).where(OrderPayment.order_id == uuid.UUID(order_id)))
        == "PENDING"
    )
    db.close()
    assert _drain()["claimed"] == 0  # nothing is delivered twice


def test_gone_subscription_is_disabled_and_not_retried(client: TestClient) -> None:
    world = _world(client)
    _login(client, world.student.email)
    _subscribe(client, _endpoint("gone"))
    _ready_order(client, world)
    stats = _drain()
    assert stats["failed"] == 1
    db = SessionLocal()
    subscription = db.scalar(select(PushSubscription))
    assert subscription.enabled is False and subscription.disabled_reason == "gone"
    assert db.scalar(select(PushDelivery.status)) == "GONE"
    assert db.scalar(select(NotificationOutbox.result)) == "FAILED"
    db.close()


def test_failed_push_never_reverses_ready_and_retries_with_backoff(client: TestClient) -> None:
    world = _world(client)
    _login(client, world.student.email)
    _subscribe(client, _endpoint("fail"))
    order_id, _ = _ready_order(client, world)
    settings = get_settings()
    first = _drain()
    assert first["retried"] == 1
    db = SessionLocal()
    delivery = db.scalar(select(PushDelivery))
    assert delivery.status == "PENDING" and delivery.attempt_count == 1
    assert delivery.error_code == "http_503"
    first_wait = delivery.next_attempt_at - delivery.last_attempt_at
    assert first_wait.total_seconds() == pytest.approx(settings.push_backoff_base_seconds, abs=1)
    assert db.get(Order, uuid.UUID(order_id)).status == "READY"
    db.close()
    assert _drain()["claimed"] == 0  # not due yet
    offset = 0
    waits = [first_wait.total_seconds()]
    for attempt in range(2, settings.push_max_attempts + 1):
        offset += 300
        _drain(offset)
        db = SessionLocal()
        delivery = db.scalar(select(PushDelivery))
        db.close()
        assert delivery.attempt_count == attempt
        if delivery.status == "PENDING":
            waits.append((delivery.next_attempt_at - delivery.last_attempt_at).total_seconds())
    assert waits == sorted(waits) and waits[-1] > waits[0]  # exponential growth
    assert delivery.status == "FAILED" and delivery.error_code == "http_503"
    assert _db_one(select(NotificationOutbox.result)) == "FAILED"
    assert _db_one(select(Order.status).where(Order.id == uuid.UUID(order_id))) == "READY"
    _drain(offset + 300)
    assert _db_one(select(PushDelivery.attempt_count)) == settings.push_max_attempts


def test_flaky_push_service_succeeds_on_retry(client: TestClient) -> None:
    world = _world(client)
    _login(client, world.student.email)
    _subscribe(client, _endpoint("flaky"))
    _ready_order(client, world)
    assert _drain()["retried"] == 1
    assert _drain(600)["accepted"] == 1
    assert _db_one(select(PushDelivery.attempt_count)) == 2
    assert _db_one(select(NotificationOutbox.result)) == "ACCEPTED"


def test_throttled_push_honours_retry_after_and_timeouts_are_retried(client: TestClient) -> None:
    world = _world(client)
    _login(client, world.student.email)
    _subscribe(client, _endpoint("throttle"))
    _subscribe(client, _endpoint("timeout"))
    _ready_order(client, world)
    assert _drain()["retried"] == 2
    db = SessionLocal()
    codes = sorted(db.scalars(select(PushDelivery.error_code)))
    db.close()
    assert codes == ["http_429", "net_timeout"]


def test_outbox_survives_restart_and_stale_claims_expire(client: TestClient) -> None:
    world = _world(client)
    _login(client, world.student.email)
    _subscribe(client, _endpoint("accept"))
    _ready_order(client, world)
    # A worker claimed the event and died: the claim blocks others until it expires.
    db = SessionLocal()
    db.execute(
        update(NotificationOutbox).values(locked_until=datetime.now(UTC) + timedelta(seconds=60))
    )
    db.commit()
    db.close()
    assert _drain()["claimed"] == 0
    assert _drain(120)["accepted"] == 1
    assert _db_one(select(NotificationOutbox.result)) == "ACCEPTED"


def test_two_workers_do_not_double_deliver(client: TestClient) -> None:
    world = _world(client)
    _login(client, world.student.email)
    _subscribe(client, _endpoint("accept"))
    _subscribe(client, _endpoint("accept"))
    _ready_order(client, world)
    results: list[dict] = []
    barrier = threading.Barrier(3)

    def work() -> None:
        barrier.wait()
        results.append(_drain())

    threads = [threading.Thread(target=work) for _ in range(3)]
    [thread.start() for thread in threads]
    [thread.join() for thread in threads]
    assert sum(item["accepted"] for item in results) == 2
    db = SessionLocal()
    assert db.scalar(select(func.count()).select_from(PushDelivery)) == 2
    assert sorted(db.scalars(select(PushDelivery.attempt_count))) == [1, 1]
    db.close()


def test_stale_ready_event_is_skipped_after_pickup(client: TestClient) -> None:
    world = _world(client)
    _login(client, world.student.email)
    _subscribe(client, _endpoint("accept"))
    order_id, _ = _ready_order(client, world)
    _login(client, world.student.email)
    token = _issue(client, order_id).json()["token"]
    _login(client, world.cashier.email)
    _confirm(client, order_id)
    assert _complete(client, order_id, token=token).status_code == 200
    stats = _drain()
    assert stats["stale"] == 1 and stats["accepted"] == 0
    assert _db_one(select(NotificationOutbox.result)) == "STALE"


def test_no_subscription_still_leaves_in_app_notification(client: TestClient) -> None:
    world = _world(client)
    _ready_order(client, world)
    assert _drain()["no_subscription"] == 1
    assert _db_one(select(NotificationOutbox.result)) == "NO_SUBSCRIPTION"
    _login(client, world.student.email)
    assert client.get("/api/v1/notifications").json()["unread_count"] == 1


def test_account_switch_does_not_leak_notifications_to_the_next_user(client: TestClient) -> None:
    world = _world(client)
    endpoint = _endpoint("accept")
    _login(client, world.student.email)
    _subscribe(client, endpoint)
    _ready_order(client, world)
    _login(client, world.other_student.email)
    _subscribe(client, endpoint, expect=200)  # same browser, second account
    stats = _drain()
    assert stats["accepted"] == 0  # the first student's READY event is not sent to the second
    assert _db_one(select(func.count()).select_from(PushDelivery)) == 0
    assert _db_one(select(NotificationOutbox.result)) == "NO_SUBSCRIPTION"


def test_takeover_after_scheduling_skips_the_pending_delivery(client: TestClient) -> None:
    world = _world(client)
    endpoint = _endpoint("flaky")
    _login(client, world.student.email)
    _subscribe(client, endpoint)
    _ready_order(client, world)
    assert _drain()["retried"] == 1  # a retry for the first student is now scheduled
    _login(client, world.other_student.email)
    _subscribe(client, endpoint, expect=200)
    assert _drain(600)["accepted"] == 0
    db = SessionLocal()
    delivery = db.scalar(select(PushDelivery))
    assert delivery.status == "SKIPPED" and delivery.error_code == "recipient_changed"
    db.close()


def test_push_test_endpoint_is_protected_and_rate_limited(client: TestClient) -> None:
    world = _world(client)
    _login(client, world.student.email)
    assert client.post("/api/v1/push/test").status_code == 403  # no CSRF
    _subscribe(client, _endpoint("accept"))
    limit = get_settings().push_test_limit
    codes = [
        client.post("/api/v1/push/test", headers=_csrf(client)).status_code
        for _ in range(limit + 1)
    ]
    assert codes == [202] * limit + [429]
    assert _drain()["accepted"] == limit
    _login(client, world.cashier.email)
    assert client.post("/api/v1/push/test", headers=_csrf(client)).status_code == 403


def test_push_test_status_is_private_and_needs_a_subscription(client: TestClient) -> None:
    world = _world(client)
    _login(client, world.student.email)
    missing = client.post("/api/v1/push/test", headers=_csrf(client))
    assert missing.status_code == 409
    endpoint = _endpoint("accept")
    _subscribe(client, endpoint)
    confirmed = client.post(
        "/api/v1/push/subscriptions/confirm",
        json={"endpoint": endpoint},
        headers=_csrf(client),
    )
    assert confirmed.status_code == 200 and confirmed.json() == {"active": True}
    stranger = client.post(
        "/api/v1/push/subscriptions/confirm",
        json={"endpoint": "https://fcm.googleapis.com/fcm/send/not-this-device"},
        headers=_csrf(client),
    )
    assert stranger.json()["active"] is False
    queued = client.post("/api/v1/push/test", headers=_csrf(client))
    assert queued.status_code == 202
    assert "endpoint" not in queued.text and "p256dh" not in queued.text
    event_id = queued.json()["event_id"]
    _login(client, world.other_student.email)
    assert client.get(f"/api/v1/push/test/{event_id}").status_code == 404
    _login(client, world.student.email)
    status = client.get(f"/api/v1/push/test/{event_id}")
    assert status.status_code == 200
    assert status.json()["push_service"] in {"accepted", "rejected", "unknown"}
    assert "endpoint" not in status.text


# --- manager analytics and cashier board -----------------------------------------------------


def test_cashier_board_and_manager_summary_separate_value_cash_and_reversals(
    client: TestClient,
) -> None:
    world = _world(client)
    first, _ = _ready_order(client, world)
    second, _ = _ready_order(client, world, quantity=2)
    third, _ = _ready_order(client, world)
    _login(client, world.cashier.email)
    board = client.get("/api/v1/cashier/orders").json()
    assert len(board["awaiting_payment"]) == 3 and board["awaiting_handover"] == []
    assert board["totals"]["awaiting_payment_paise"] == 4 * PRICE
    assert board["totals"]["recorded_today_paise"] == 0
    first_receipt = _confirm(client, first).json()["receipt"]["id"]
    _confirm(client, second, amount=2 * PRICE)
    board = client.get("/api/v1/cashier/orders").json()
    assert len(board["awaiting_payment"]) == 1 and len(board["awaiting_handover"]) == 2
    assert board["totals"]["recorded_today_paise"] == 3 * PRICE
    assert "email" not in str(board).lower() and "roll" not in str(board).lower()
    _login(client, world.manager_email)
    _reverse(client, first_receipt)
    summary = client.get("/api/v1/admin/cash/summary").json()
    assert summary["gross_receipts_paise"] == 3 * PRICE
    assert summary["reversed_paise"] == PRICE
    assert summary["net_cash_paise"] == 2 * PRICE
    assert summary["paid_orders"] == 1
    assert summary["ready_awaiting_payment"] == 2
    assert summary["ready_awaiting_payment_paise"] == 2 * PRICE
    assert summary["paid_awaiting_pickup"] == 1 and summary["picked_up_orders"] == 0
    assert summary["orders_placed_value_paise"] == 4 * PRICE
    transactions = client.get("/api/v1/admin/cash/transactions").json()
    assert transactions["total"] == 2
    bad = client.get("/api/v1/admin/cash/summary?date_from=2026-02-01&date_to=2026-01-01")
    assert bad.status_code == 422
    _login(client, world.cashier.email)
    assert client.get("/api/v1/admin/cash/summary").status_code == 403
    assert third
    history = client.get("/api/v1/cashier/history").json()
    assert history["total"] == 2


def test_cash_endpoints_are_not_cacheable(client: TestClient) -> None:
    world = _world(client)
    _login(client, world.cashier.email)
    response = client.get("/api/v1/cashier/orders")
    assert "no-store" in response.headers["cache-control"]
    _login(client, world.student.email)
    assert "no-store" in client.get("/api/v1/notifications").headers["cache-control"]
    assert "no-store" in client.get("/api/v1/push/public-key").headers["cache-control"]
