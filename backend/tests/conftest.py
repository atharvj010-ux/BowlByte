from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

_TEST_ORIGIN = "http://127.0.0.1:3011"


@pytest.fixture
def client() -> Iterator[TestClient]:
    app = create_app()
    with TestClient(app) as test_client:
        test_client.headers.update({"origin": _TEST_ORIGIN})
        yield test_client
