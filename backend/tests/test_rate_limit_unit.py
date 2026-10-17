from app.core.errors import ApiError
from app.services import rate_limit
from app.services.email_templates import branded_message


class _FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, int] = {}
        self.ttl_seconds: dict[str, int] = {}

    def incr(self, key: str) -> int:
        self.values[key] = self.values.get(key, 0) + 1
        return self.values[key]

    def expire(self, key: str, seconds: int) -> bool:
        self.ttl_seconds[key] = seconds
        return True

    def ttl(self, key: str) -> int:
        return self.ttl_seconds.get(key, -1)

    def get(self, key: str) -> str | None:
        value = self.values.get(key)
        return None if value is None else str(value)


def test_consume_allowance_sets_retry_after(monkeypatch) -> None:
    fake = _FakeRedis()
    monkeypatch.setattr(rate_limit, "_client", lambda: fake)

    rate_limit.consume_allowance(bucket="order-user", value="student", limit=1, window_seconds=90)
    try:
        rate_limit.consume_allowance(
            bucket="order-user", value="student", limit=1, window_seconds=90
        )
    except ApiError as exc:
        assert exc.status_code == 429
        assert exc.headers["Retry-After"] == "90"
    else:
        raise AssertionError("the second attempt should be limited")


def test_branded_email_keeps_a_text_alternative() -> None:
    text, html = branded_message(
        heading="Confirm your email",
        intro="Hello student.",
        action_label="Confirm email",
        action_url="https://bowlbyte.example/student/verify-email#token=abc",
        note="The link works once.",
    )
    assert "Confirm email" in text
    assert "https://bowlbyte.example/student/verify-email#token=abc" in text
    assert "BOWLBYTE" in html
    assert "token=abc" in html
