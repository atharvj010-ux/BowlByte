"""Identity checks for destructive tests.

A boolean flag cannot choose the database. The URL host, port, and name must
match the disposable localhost cluster, and Redis must not be the live database.
"""

from __future__ import annotations

import os
from urllib.parse import urlparse

import pytest

from app.core.config import get_settings

DISPOSABLE_DATABASE = "bowlbyte_e2e"
DISPOSABLE_PORT = 55432
LOCAL_HOSTS = {"127.0.0.1", "localhost"}
REFUSED_DATABASES = {"bowlbyte", "postgres", "bowlbyte_test"}
BOOLEAN_FLAGS = {"1", "true", "yes", "on"}


def require_disposable_database() -> None:
    flag = os.environ.get("E2E_DATABASE", "").strip()
    if flag.lower() in BOOLEAN_FLAGS:
        pytest.fail("E2E_DATABASE=true cannot override the database identity check.")
    if flag and flag != DISPOSABLE_DATABASE:
        pytest.fail("E2E_DATABASE does not name the disposable test database.")

    settings = get_settings()
    parsed = urlparse(settings.database_url.replace("postgresql+psycopg", "postgresql", 1))
    host = (parsed.hostname or "").lower()
    name = parsed.path.strip("/").split("/")[-1]
    if host.endswith("supabase.com") or host.endswith("supabase.co") or "pooler" in host:
        pytest.fail("Refusing a destructive test against Supabase.")
    if name in REFUSED_DATABASES or name != DISPOSABLE_DATABASE:
        pytest.fail("Refusing a destructive test against an unexpected database.")
    if host not in LOCAL_HOSTS or parsed.port != DISPOSABLE_PORT:
        pytest.fail("Refusing a destructive test against an unexpected database server.")

    redis = urlparse(settings.redis_url)
    redis_host = (redis.hostname or "").lower()
    redis_db = redis.path.strip("/") or "0"
    if redis_host not in LOCAL_HOSTS or redis_db == "0":
        pytest.fail("Refusing a destructive test against the live Redis database.")
