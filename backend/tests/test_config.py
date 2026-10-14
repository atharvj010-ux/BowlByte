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
