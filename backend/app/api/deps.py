import secrets
from collections.abc import Callable

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ApiError
from app.db.session import get_db
from app.services.identity import Principal, csrf_matches, load_principal


def client_key(request: Request) -> str:
    settings = get_settings()
    supplied = request.headers.get("x-bowlbyte-proxy", "")
    marked = request.headers.get("x-bowlbyte-client", "")
    if (
        settings.proxy_shared_secret
        and supplied
        and marked
        and secrets.compare_digest(supplied, settings.proxy_shared_secret)
    ):
        return marked[:80]
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def optional_principal(
    request: Request,
    db: Session = Depends(get_db),
) -> Principal | None:
    raw = request.cookies.get(get_settings().session_cookie_name)
    return load_principal(db, raw)


def require_principal(principal: Principal | None = Depends(optional_principal)) -> Principal:
    if principal is None:
        raise ApiError(code="AUTH_REQUIRED", message="Sign in to continue.", status_code=401)
    return principal


def require_csrf(
    request: Request,
    principal: Principal = Depends(require_principal),
) -> Principal:
    settings = get_settings()
    header = request.headers.get("x-csrf-token")
    cookie = request.cookies.get(settings.csrf_cookie_name)
    if not csrf_matches(principal, header, cookie):
        raise ApiError(code="CSRF_REJECTED", message="Request was rejected.", status_code=403)
    return principal


def require_roles(*roles: str) -> Callable[..., Principal]:
    def dependency(principal: Principal = Depends(require_principal)) -> Principal:
        if principal.user.role not in roles:
            raise ApiError(
                code="FORBIDDEN",
                message="You cannot open this area.",
                status_code=403,
            )
        return principal

    return dependency


def require_manager(principal: Principal = Depends(require_csrf)) -> Principal:
    if principal.user.role != "CANTEEN_MANAGER":
        raise ApiError(code="FORBIDDEN", message="You cannot manage staff.", status_code=403)
    return principal


def require_manager_session(principal: Principal = Depends(require_principal)) -> Principal:
    if principal.user.role != "CANTEEN_MANAGER":
        raise ApiError(code="FORBIDDEN", message="You cannot manage staff.", status_code=403)
    return principal
