"""Validate uploaded menu photos before they are stored.

Bytes are kept in PostgreSQL. The client never supplies a filesystem path.
"""

import base64
import binascii

from app.core.errors import ApiError

MAX_IMAGE_BYTES = 1_500_000
_SIGNATURES = {
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/webp": (b"RIFF",),
}


def decode_image(content_base64: str, content_type: str) -> bytes:
    if len(content_base64) > 2_100_000:
        raise ApiError(
            code="IMAGE_REJECTED",
            message="The image is too large.",
            status_code=422,
        )
    try:
        raw = base64.b64decode(content_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ApiError(
            code="IMAGE_REJECTED",
            message="The image could not be read.",
            status_code=422,
        ) from exc
    return validate_image(raw, content_type)


def validate_image(raw: bytes, content_type: str) -> bytes:
    if content_type not in _SIGNATURES:
        raise ApiError(
            code="IMAGE_REJECTED",
            message="Use a JPEG, PNG, or WebP image.",
            status_code=422,
        )
    if not raw or len(raw) > MAX_IMAGE_BYTES:
        raise ApiError(
            code="IMAGE_REJECTED",
            message="The image is too large.",
            status_code=422,
        )
    if content_type == "image/webp":
        if not (raw.startswith(b"RIFF") and raw[8:12] == b"WEBP"):
            raise ApiError(
                code="IMAGE_REJECTED",
                message="The file is not a valid image.",
                status_code=422,
            )
        return raw
    if not raw.startswith(_SIGNATURES[content_type][0]):
        raise ApiError(
            code="IMAGE_REJECTED",
            message="The file is not a valid image.",
            status_code=422,
        )
    return raw
