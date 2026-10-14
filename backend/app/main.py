from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.errors import error_body, register_exception_handlers
from app.core.logging import configure_logging

_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title=settings.app_name,
        version="0.4.0",
        summary="Canteen operations API.",
        description=(
            "Authentication, menus, stock, cash-pending orders, kitchen "
            "preparation, and readiness estimates are implemented. Cash "
            "recording, QR pickup, phone push, and forecasting are not."
        ),
        docs_url="/docs" if settings.environment != "production" else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.environment != "production" else None,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "Accept", "X-CSRF-Token"],
    )

    @app.middleware("http")
    async def protect_origin_and_cache(request: Request, call_next):
        current = get_settings()
        if (
            request.method not in _SAFE_METHODS
            and request.url.path.startswith(current.api_v1_prefix)
            and request.headers.get("origin") not in current.allowed_origins
        ):
            return JSONResponse(
                status_code=403,
                content=error_body(
                    code="CSRF_REJECTED",
                    message="Request was rejected.",
                ),
            )
        response = await call_next(request)
        path = request.url.path
        prefix = current.api_v1_prefix
        if (
            path.startswith(f"{prefix}/auth")
            or path.startswith(f"{prefix}/orders")
            or path.startswith(f"{prefix}/menu")
            or path.startswith(f"{prefix}/admin")
            or path.startswith(f"{prefix}/staff")
            or path.endswith("/session")
        ):
            response.headers["Cache-Control"] = "private, no-store"
            response.headers["Pragma"] = "no-cache"
        return response

    register_exception_handlers(app)
    app.include_router(api_router, prefix=settings.api_v1_prefix)
    return app


app = create_app()
