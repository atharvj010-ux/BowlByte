import logging
import smtplib
import ssl
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.core.config import get_settings
from app.core.errors import ApiError
from app.models.identity import ACTIVE
from app.services import rate_limit
from app.services.email_templates import branded_message
from app.services.identity import _send_verification
from app.services.mailer import EmailDeliveryError, send_email
from app.services.password_recovery import request_password_reset, reset_password

SECRET = "xsmtpsib-unit-test-secret"


class _FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, int] = {}
        self.ttl_seconds: dict[str, int] = {}
        self.stored: dict[str, str] = {}

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

    def set(self, key: str, value: str, ex: int | None = None) -> bool:
        self.stored[key] = value
        if ex is not None:
            self.ttl_seconds[key] = ex
        return True

    def getdel(self, key: str) -> str | None:
        return self.stored.pop(key, None)

    def delete(self, key: str) -> int:
        return 1 if self.stored.pop(key, None) is not None else 0


class _FakeSMTP:
    fail = ""

    def __init__(self, host: str, port: int, timeout: int | None = None, context=None) -> None:
        if self.fail == "timeout":
            raise TimeoutError("timed out")
        if self.fail == "network":
            raise OSError("network down")
        self.host = host
        self.port = port
        self.timeout = timeout
        self.ssl_context = context
        self.starttls_context = None
        self.login_args = None
        self.message = None

    def __enter__(self) -> "_FakeSMTP":
        return self

    def __exit__(self, *_args: object) -> bool:
        return False

    def starttls(self, context=None) -> None:
        if self.fail == "starttls":
            raise smtplib.SMTPException("tls failed")
        self.starttls_context = context

    def login(self, username: str, password: str) -> None:
        if self.fail == "auth":
            raise smtplib.SMTPAuthenticationError(535, b"535 authentication failed")
        self.login_args = (username, password)

    def send_message(self, message) -> dict:
        if self.fail == "sender":
            raise smtplib.SMTPSenderRefused(550, b"550 sender rejected", "sender")
        self.message = message
        return {}


def _clear_settings() -> None:
    get_settings.cache_clear()


@pytest.fixture(autouse=True)
def _reset_mail_settings(monkeypatch: pytest.MonkeyPatch):
    _FakeSMTP.fail = ""
    monkeypatch.setenv("SMTP_HOST", "smtp-relay.brevo.com")
    monkeypatch.setenv("SMTP_PORT", "587")
    monkeypatch.setenv("SMTP_USERNAME", "unit@smtp-brevo.com")
    monkeypatch.setenv("SMTP_PASSWORD", SECRET)
    monkeypatch.setenv("SMTP_FROM_EMAIL", "kitchen@example.edu")
    monkeypatch.setenv("SMTP_FROM_NAME", "BowlByte")
    monkeypatch.setenv("SMTP_USE_STARTTLS", "true")
    monkeypatch.delenv("SMTP_FROM", raising=False)
    monkeypatch.delenv("SMTP_STARTTLS", raising=False)
    _clear_settings()
    yield
    _clear_settings()


def test_smtp_settings_use_the_verified_sender_and_starttls() -> None:
    settings = get_settings()
    assert settings.smtp_host == "smtp-relay.brevo.com"
    assert settings.smtp_port == 587
    assert settings.smtp_starttls is True
    assert settings.smtp_from == "BowlByte <kitchen@example.edu>"


def test_plaintext_login_is_refused(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setenv("SMTP_USE_STARTTLS", "false")
    _clear_settings()
    with caplog.at_level(logging.WARNING), pytest.raises(EmailDeliveryError):
        send_email(recipient="student@example.edu", subject="Hello", body="Body")
    assert "plaintext_auth_refused" in caplog.text
    assert SECRET not in caplog.text


def test_wrong_password_is_not_logged(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    _FakeSMTP.fail = "auth"
    monkeypatch.setattr("app.services.mailer.smtplib.SMTP", _FakeSMTP)
    with caplog.at_level(logging.WARNING), pytest.raises(EmailDeliveryError):
        send_email(recipient="student@example.edu", subject="Hello", body="Body")
    assert "SMTPAuthenticationError" in caplog.text
    assert SECRET not in caplog.text
    assert "535" not in caplog.text


def test_network_timeout_becomes_delivery_error(monkeypatch: pytest.MonkeyPatch) -> None:
    _FakeSMTP.fail = "timeout"
    monkeypatch.setattr("app.services.mailer.smtplib.SMTP", _FakeSMTP)
    with pytest.raises(EmailDeliveryError):
        send_email(recipient="student@example.edu", subject="Hello", body="Body")


def test_starttls_failure_does_not_send_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    _FakeSMTP.fail = "starttls"
    monkeypatch.setattr("app.services.mailer.smtplib.SMTP", _FakeSMTP)
    with pytest.raises(EmailDeliveryError):
        send_email(recipient="student@example.edu", subject="Hello", body="Body")


def test_sender_rejection_becomes_delivery_error(monkeypatch: pytest.MonkeyPatch) -> None:
    _FakeSMTP.fail = "sender"
    monkeypatch.setattr("app.services.mailer.smtplib.SMTP", _FakeSMTP)
    with pytest.raises(EmailDeliveryError):
        send_email(recipient="student@example.edu", subject="Hello", body="Body")


def test_successful_submission_sends_text_and_html_over_verified_tls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created: list[_FakeSMTP] = []
    original = _FakeSMTP.__init__

    def init(self, *args, **kwargs):
        original(self, *args, **kwargs)
        created.append(self)

    monkeypatch.setattr(_FakeSMTP, "__init__", init)
    monkeypatch.setattr("app.services.mailer.smtplib.SMTP", _FakeSMTP)
    text, html = branded_message(
        heading="Confirm your email",
        intro="Hello Asha.",
        action_label="Confirm email",
        action_url="https://bowlbyte.example/student/verify-email#token=one-time",
        note="The link works once.",
    )
    send_email(recipient="student@example.edu", subject="Confirm", body=text, html=html)
    client = created[0]
    assert client.starttls_context is not None
    assert client.starttls_context.verify_mode == ssl.CERT_REQUIRED
    assert client.starttls_context.check_hostname is True
    assert client.login_args == ("unit@smtp-brevo.com", SECRET)
    assert client.message is not None
    assert client.message.get_content_type() == "multipart/alternative"
    assert "Confirm email" in client.message.get_body(preferencelist=("plain",)).get_content()
    assert "BOWLBYTE" in client.message.get_body(preferencelist=("html",)).get_content()


def test_verification_email_uses_the_app_origin_and_escapes_the_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("PUBLIC_APP_URL", "https://bowlbyte.example")
    _clear_settings()
    sent: dict[str, str] = {}

    def capture(**kwargs: str) -> None:
        sent.update(kwargs)

    monkeypatch.setattr("app.services.identity.send_email", capture)
    _send_verification(
        SimpleNamespace(full_name="Asha <Rao>", email="asha@example.edu"),
        "123456",
    )
    assert sent["recipient"] == "asha@example.edu"
    assert sent["subject"] == "Your BowlByte confirmation code"
    assert sent["body"].startswith("Confirm your email")
    assert "registration page: 123456" in sent["body"]
    assert "verify-email" not in sent["body"]
    assert "Asha &lt;Rao&gt;" in sent["html"]
    assert "https://" not in sent["body"]


def test_password_reset_hides_missing_accounts_and_uses_a_fixed_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("PUBLIC_APP_URL", "https://bowlbyte.example")
    _clear_settings()
    sent: list[dict[str, str]] = []
    monkeypatch.setattr(
        "app.services.password_recovery.send_email",
        lambda **kwargs: sent.append(kwargs),
    )
    monkeypatch.setattr("app.services.password_recovery.consume_allowance", lambda **_kwargs: None)
    monkeypatch.setattr("app.services.password_recovery._store_token", lambda *_args: None)
    missing = SimpleNamespace(scalar=lambda _query: None)
    request_password_reset(missing, email="missing@example.edu", client_key="203.0.113.8")
    assert sent == []
    user = SimpleNamespace(id=uuid4(), email="student@example.edu", status=ACTIVE)
    request_password_reset(
        SimpleNamespace(scalar=lambda _query: user),
        email="Student@Example.edu",
        client_key="203.0.113.8",
    )
    assert sent[0]["recipient"] == "student@example.edu"
    assert sent[0]["subject"] == "Reset your BowlByte password"
    assert sent[0]["body"].count("https://bowlbyte.example/reset-password#token=") == 1
    assert "https://bowlbyte.example/reset-password#token=" in sent[0]["html"]
    assert "https://evil.example" not in sent[0]["body"]


def test_email_otp_is_skipped_when_supabase_auth_is_off(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api.v1.endpoints.auth import router
    from app.services.identity import request_email_otp

    sent: list[dict[str, str]] = []
    monkeypatch.setenv("SUPABASE_CREDENTIALS_ROTATED", "")
    get_settings.cache_clear()
    monkeypatch.setattr("app.services.identity.send_email", lambda **kwargs: sent.append(kwargs))
    request_email_otp(SimpleNamespace(), "student@example.edu", "203.0.113.8")
    assert sent == []
    paths = {getattr(route, "path", "") for route in router.routes}
    assert "/auth/email-otp" in paths
    assert "/auth/email-otp/verify" in paths


def test_email_otp_is_dispatched_by_the_local_mailer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.services.identity import request_email_otp

    sent: list[dict[str, object]] = []
    user = SimpleNamespace(id=uuid4(), email="student@example.edu", status=ACTIVE)
    db = SimpleNamespace(
        scalar=lambda _query: user,
        execute=lambda *_args, **_kwargs: SimpleNamespace(scalar=lambda: "auth-user-1"),
    )
    monkeypatch.setenv("SUPABASE_CREDENTIALS_ROTATED", "yes")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_example")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "sb_secret_example_value")
    get_settings.cache_clear()
    monkeypatch.setattr("app.services.identity.assert_allowance", lambda **_kwargs: None)
    monkeypatch.setattr("app.services.identity.record_attempt", lambda **_kwargs: None)
    monkeypatch.setattr(
        "app.services.identity.SupabaseAuthClient",
        lambda _settings: SimpleNamespace(create_email_login_otp=lambda _email: "482917"),
    )
    monkeypatch.setattr("app.services.identity.send_email", lambda **kwargs: sent.append(kwargs))
    request_email_otp(db, "Student@Example.edu", "203.0.113.8")
    assert len(sent) == 1
    assert sent[0]["recipient"] == "student@example.edu"
    assert sent[0]["subject"] == "Your BowlByte sign-in code"
    assert "482917" in str(sent[0]["body"])
    assert "482917" in str(sent[0]["html"])
    get_settings.cache_clear()


def test_verification_and_recovery_requests_are_rate_limited(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = _FakeRedis()
    monkeypatch.setattr(rate_limit, "_client", lambda: fake)
    for _ in range(3):
        rate_limit.record_attempt(
            bucket="resend-email", value="asha@example.edu", window_seconds=900
        )
    with pytest.raises(ApiError) as resend_error:
        rate_limit.assert_allowance(bucket="resend-email", value="asha@example.edu", limit=3)
    assert resend_error.value.status_code == 429
    for _ in range(3):
        rate_limit.consume_allowance(
            bucket="forgot-email",
            value="asha@example.edu",
            limit=3,
            window_seconds=900,
        )
    with pytest.raises(ApiError) as reset_error:
        rate_limit.consume_allowance(
            bucket="forgot-email",
            value="asha@example.edu",
            limit=3,
            window_seconds=900,
        )
    assert reset_error.value.status_code == 429
    assert reset_error.value.headers["Retry-After"] == "900"


def test_recovery_token_is_single_use(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeRedis()
    monkeypatch.setattr(rate_limit, "_client", lambda: fake)
    monkeypatch.setattr("app.services.password_recovery._client", lambda: fake)
    monkeypatch.setattr("app.services.password_recovery.consume_allowance", lambda **_kwargs: None)
    user = SimpleNamespace(
        id=uuid4(), status=ACTIVE, password_hash="old", email="student@example.edu"
    )
    committed: list[bool] = []

    class _DB:
        def get(self, _model, user_id):
            return user if user_id == user.id else None

        def execute(self, _statement):
            return None

        def add(self, _row) -> None:
            return None

        def commit(self):
            committed.append(True)

    from app.services.password_recovery import _store_token

    raw = "a" * 32
    _store_token(raw, user.id)
    reset_password(_DB(), token=raw, password="a-new-password-value", client_key="203.0.113.9")
    assert user.password_hash != "old"
    assert committed == [True]
    with pytest.raises(ApiError) as reused:
        reset_password(
            _DB(), token=raw, password="another-password-value", client_key="203.0.113.9"
        )
    assert reused.value.status_code == 400
