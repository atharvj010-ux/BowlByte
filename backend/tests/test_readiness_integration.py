import pytest

pytestmark = pytest.mark.integration


def test_ready_reports_live_postgres_and_redis(client) -> None:
    response = client.get("/api/v1/ready")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "ready"
    assert body["checks"]["postgres"]["status"] == "up"
    assert body["checks"]["redis"]["status"] == "up"
    assert body["checks"]["postgres"]["detail"] is None
    assert body["checks"]["redis"]["detail"] is None
