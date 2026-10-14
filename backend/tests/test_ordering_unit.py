from uuid import UUID

import pytest

from app.core.errors import ApiError
from app.services.images import validate_image
from app.services.ordering import request_hash


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


def test_image_magic_accepts_a_jpeg_header() -> None:
    raw = b"\xff\xd8\xff" + b"\x00" * 32
    assert validate_image(raw, "image/jpeg") == raw
