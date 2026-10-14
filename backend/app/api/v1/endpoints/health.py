import logging

from fastapi import APIRouter, Response

from app.core.config import get_settings
from app.schemas.health import DependencyCheck, HealthResponse, ReadyResponse
from app.services.readiness import check_postgres, check_redis

logger = logging.getLogger(__name__)
router = APIRouter(tags=["operations"])


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Liveness probe. Does not check PostgreSQL or Redis."""

    settings = get_settings()
    return HealthResponse(
        status="ok",
        service="bowlbyte-api",
        environment=settings.environment,
    )


@router.get(
    "/ready",
    response_model=ReadyResponse,
    responses={503: {"model": ReadyResponse}},
)
def ready(response: Response) -> ReadyResponse:
    """Readiness probe. Reports live PostgreSQL and Redis connectivity."""

    checks: dict[str, DependencyCheck] = {}
    probes = (("postgres", check_postgres), ("redis", check_redis))
    for name, probe in probes:
        try:
            probe()
        except Exception as exc:
            logger.warning("readiness check failed for %s: %s", name, type(exc).__name__)
            checks[name] = DependencyCheck(status="down", detail=type(exc).__name__)
        else:
            checks[name] = DependencyCheck(status="up")

    ready_ok = all(check.status == "up" for check in checks.values())
    response.status_code = 200 if ready_ok else 503
    return ReadyResponse(
        status="ready" if ready_ok else "not_ready",
        checks=checks,
    )
