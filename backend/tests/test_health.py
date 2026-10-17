from fastapi.testclient import TestClient

from app.core.errors import ApiError
from app.main import create_app


def test_health_is_live(client) -> None:
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert "frame-ancestors 'none'" in response.headers["content-security-policy"]
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "bowlbyte-api"
    assert body["environment"] in {"development", "test", "production"}


def test_unknown_route_uses_error_envelope(client) -> None:
    response = client.get("/api/v1/missing")

    assert response.status_code == 404
    body = response.json()
    assert body["error"]["code"] == "HTTP_ERROR"
    assert "details" in body["error"]


def test_api_error_uses_error_envelope() -> None:
    app = create_app()

    @app.get("/api/v1/_test/conflict")
    def conflict() -> None:
        raise ApiError(
            code="EXAMPLE_CONFLICT",
            message="Example failure.",
            status_code=409,
            details={"scope": "test"},
        )

    with TestClient(app) as client:
        response = client.get("/api/v1/_test/conflict")

    assert response.status_code == 409
    assert response.json() == {
        "error": {
            "code": "EXAMPLE_CONFLICT",
            "message": "Example failure.",
            "details": {"scope": "test"},
        }
    }


def test_ready_reports_down_when_dependencies_fail(client, monkeypatch) -> None:
    def fail_postgres() -> None:
        raise ConnectionError("postgres unavailable")

    def fail_redis() -> None:
        raise TimeoutError("redis unavailable")

    monkeypatch.setattr("app.api.v1.endpoints.health.check_postgres", fail_postgres)
    monkeypatch.setattr("app.api.v1.endpoints.health.check_redis", fail_redis)

    response = client.get("/api/v1/ready")

    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "not_ready"
    assert body["checks"]["postgres"]["status"] == "down"
    assert body["checks"]["postgres"]["detail"] == "ConnectionError"
    assert body["checks"]["redis"]["status"] == "down"
    assert "postgres unavailable" not in response.text
    assert "redis unavailable" not in response.text
