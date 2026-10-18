from fastapi import Response

from app.core.config import get_settings


def apply_auth_cookies(
    response: Response,
    raw_session: str,
    raw_csrf: str,
    refresh: str | None = None,
) -> None:
    settings = get_settings()
    common = {
        "max_age": settings.session_absolute_seconds,
        "secure": settings.cookie_secure,
        "samesite": "lax",
        "path": "/",
    }
    response.set_cookie(settings.session_cookie_name, raw_session, httponly=True, **common)
    response.set_cookie(settings.csrf_cookie_name, raw_csrf, httponly=False, **common)
    if refresh:
        response.set_cookie(settings.refresh_cookie_name, refresh, httponly=True, **common)


def clear_auth_cookies(response: Response) -> None:
    settings = get_settings()
    flags = {"path": "/", "secure": settings.cookie_secure, "samesite": "lax"}
    response.delete_cookie(settings.session_cookie_name, **flags)
    response.delete_cookie(settings.csrf_cookie_name, **flags)
    response.delete_cookie(settings.refresh_cookie_name, **flags)
