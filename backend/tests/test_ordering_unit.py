from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from sqlalchemy.exc import OperationalError

from app.core.errors import ApiError
from app.services.images import validate_image
from app.services.ordering import _payload_after_commit, request_hash


def test_request_hash_ignores_input_order() -> None:
    first = UUID("00000000-0000-0000-0000-000000000001")
    second = UUID("00000000-0000-0000-0000-000000000002")
    left = request_hash([(second, 1), (first, 2)], "no onion")
    right = request_hash([(first, 2), (second, 1)], "no onion")
    assert left == right
    assert left != request_hash([(first, 2), (second, 1)], "extra sauce")


def test_image_magic_rejects_a_text_file() -> None:
    with pytest.raises(ApiError) as caught:
        validate_image(b"not an image", "image/jpeg")
    assert caught.value.status_code == 422


def test_committed_order_is_reloaded_when_the_pooler_drops_the_connection() -> None:
    order_id = uuid4()
    order = SimpleNamespace(
        id=order_id,
        ticket_number="B00003",
        status="PLACED",
        total_paise=4000,
        note=None,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
        canteen_id=uuid4(),
        student_user_id=uuid4(),
        picked_up_at=None,
        ready_at=None,
    )
    payment = SimpleNamespace(method="CASH", status="PENDING", amount_paise=4000, paid_at=None)

    class Session:
        def __init__(self) -> None:
            self.rolled_back = False

        def refresh(self, _order) -> None:
            raise OperationalError("SELECT", {}, Exception("connection closed"))

        def rollback(self) -> None:
            self.rolled_back = True

        def get(self, _model, key):
            assert key == order_id
            return order

        def scalars(self, _query):
            return []

        def scalar(self, _query):
            return payment

    session = Session()
    payload = _payload_after_commit(session, order)
    assert session.rolled_back is True
    assert payload["id"] == order_id
    assert payload["status"] == "PLACED"
    assert payload["payment"]["status"] == "PENDING"


def test_image_magic_accepts_a_jpeg_header() -> None:
    raw = b"\xff\xd8\xff" + b"\x00" * 32
    assert validate_image(raw, "image/jpeg") == raw
