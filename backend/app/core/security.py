import hashlib
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

_hasher = PasswordHasher()
_dummy_hash: str | None = None


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def password_needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def dummy_password_hash() -> str:
    """A real Argon2 hash used when the account does not exist.

    Verifying against it keeps the failure path from returning faster than a
    wrong password for a real account.
    """

    global _dummy_hash
    if _dummy_hash is None:
        _dummy_hash = hash_password("bowlbyte-dummy-password")
    return _dummy_hash


def new_secret() -> str:
    return secrets.token_urlsafe(32)


def hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def secrets_match(supplied: str, stored_hash: str) -> bool:
    return secrets.compare_digest(hash_secret(supplied), stored_hash)
