from app.core.config import get_settings


def test_cors_origins_are_split_and_trimmed(monkeypatch) -> None:
    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:3000, http://127.0.0.1:3000")
    get_settings.cache_clear()
    try:
        settings = get_settings()
        assert settings.cors_origin_list == [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ]
    finally:
        get_settings.cache_clear()


def test_allowed_origins_include_vercel_deployment_hosts(monkeypatch) -> None:
    monkeypatch.setenv("CORS_ORIGINS", "http://127.0.0.1:3010")
    monkeypatch.setenv("PUBLIC_APP_URL", "http://127.0.0.1:3010")
    monkeypatch.setenv("VERCEL_URL", "bowlbyte.vercel.app")
    monkeypatch.setenv("VERCEL_PROJECT_PRODUCTION_URL", "bowlbyte.vercel.app")
    monkeypatch.setenv("VERCEL_BRANCH_URL", "bowlbyte-git-main-user.vercel.app")
    get_settings.cache_clear()
    try:
        origins = get_settings().allowed_origins
        assert "http://127.0.0.1:3010" in origins
        assert "https://bowlbyte.vercel.app" in origins
        assert "https://bowlbyte-git-main-user.vercel.app" in origins
    finally:
        get_settings.cache_clear()


def test_supabase_db_url_becomes_database_url_when_database_url_unset(monkeypatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv(
        "SUPABASE_DB_URL",
        "postgresql://user:secret@aws-0.pooler.supabase.com:5432/postgres?sslmode=verify-full",
    )
    get_settings.cache_clear()
    try:
        settings = get_settings()
        assert settings.database_url.startswith("postgresql+psycopg://user:secret@")
        assert "aws-0.pooler.supabase.com" in settings.database_url
    finally:
        get_settings.cache_clear()


def test_explicit_database_url_wins_over_supabase_db_url(monkeypatch) -> None:
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql+psycopg://app:pass@db.example:5432/bowlbyte",
    )
    monkeypatch.setenv(
        "SUPABASE_DB_URL",
        "postgresql://user:secret@aws-0.pooler.supabase.com:5432/postgres",
    )
    get_settings.cache_clear()
    try:
        assert get_settings().database_url == "postgresql+psycopg://app:pass@db.example:5432/bowlbyte"
    finally:
        get_settings.cache_clear()
