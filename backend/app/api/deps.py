import ipaddress
import secrets
from collections.abc import Callable

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ApiError
from app.db.session import get_db
from app.services.identity import Principal, csrf_matches, load_principal


def _canonical_ip(value: str) -> str | None:
    """Return a canonical IPv4 or IPv6 address, or None when the value is not an IP.

    Zone identifiers and brackets are stripped. X-Forwarded-For is never read here.
    """

    text = value.strip().strip("[]")
    if "%" in text:
        text = text.split("%", 1)[0]
    try:
        return str(ipaddress.ip_address(text))
    except ValueError:
        return None


def client_key(request: Request) -> str:
    """Rate-limit label for the caller.

    A browser cannot set this label. The same-origin Next.js proxy strips any
    incoming ``x-bowlbyte-*`` header and, when ``PROXY_SHARED_SECRET`` matches,
    supplies ``x-bowlbyte-client`` as an IP it observed itself. A spoofed
    ``X-Forwarded-For`` is ignored. If the proxy secret is absent or the label
    is not an IP, the TCP peer address is used.
    """

    settings = get_settings()
    supplied = request.headers.get("x-bowlbyte-proxy", "")
    marked = request.headers.get("x-bowlbyte-client", "")
    if (
        settings.proxy_shared_secret
        and supplied
        and marked
        and secrets.compare_digest(supplied, settings.proxy_shared_secret)
    ):
        parsed = _canonical_ip(marked)
        if parsed is not None:
            return parsed
    if request.client and request.client.host:
        parsed = _canonical_ip(request.client.host)
        if parsed is not None:
            return parsed
        return request.client.host[:80]
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
