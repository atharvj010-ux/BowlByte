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
