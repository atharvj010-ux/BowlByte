"""Print a fresh VAPID key pair and random secrets for Web Push.

Usage:  python -m app.cli.generate_vapid

Output goes to stdout only. Put the values in protected environment
configuration (the git-ignored .env file or your host's secret store).
The private key must never be committed or logged.
"""

import base64
import secrets

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def generate() -> dict[str, str]:
    key = ec.generate_private_key(ec.SECP256R1())
    private = key.private_numbers().private_value.to_bytes(32, "big")
    public = key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    return {
        "VAPID_PUBLIC_KEY": _b64(public),
        "VAPID_PRIVATE_KEY": _b64(private),
        "PICKUP_HASH_KEY": secrets.token_urlsafe(48),
        "PUSH_ENCRYPTION_KEY": secrets.token_urlsafe(48),
    }


def main() -> None:
    for name, value in generate().items():
        print(f"{name}={value}")


if __name__ == "__main__":
    main()
