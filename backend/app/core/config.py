from functools import lru_cache
from typing import Literal, Self

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

EligibilityMode = Literal["disabled", "institutional_domain", "roster"]


class Settings(BaseSettings):
    """Typed runtime settings.

    Defaults are local development placeholders. They are not production secrets.
    Override them through the environment in every shared or deployed environment.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "BowlByte"
    environment: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"
    api_v1_prefix: str = "/api/v1"
    database_url: str = Field(
        default="postgresql+psycopg://bowlbyte:bowlbyte@localhost:5432/bowlbyte",
    )
    redis_url: str = "redis://localhost:6379/0"
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    public_app_url: str = "http://127.0.0.1:3000"
    cookie_secure: bool = False
    trust_proxy_headers: bool = False
    proxy_shared_secret: str = ""

    college_eligibility_mode: EligibilityMode = "disabled"
    college_name: str = "Pilot College"
    college_slug: str = "pilot"
    college_email_domain: str = ""
    canteen_name: str = "Pilot Canteen"
    canteen_slug: str = "pilot"

    smtp_host: str = "127.0.0.1"
    smtp_port: int = 1025
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from: str = "BowlByte <noreply@bowlbyte.local>"
    smtp_starttls: bool = False
    smtp_use_tls: bool = False

    verification_ttl_seconds: int = 15 * 60
    invitation_ttl_seconds: int = 48 * 60 * 60
    session_idle_seconds: int = 30 * 60
    session_absolute_seconds: int = 12 * 60 * 60
    login_email_rate_limit: int = 5
    login_ip_rate_limit: int = 50
    login_rate_window_seconds: int = 15 * 60
    resend_rate_limit: int = 3
    resend_rate_window_seconds: int = 15 * 60
    enrollment_code_min_length: int = 20
    kitchen_packing_buffer_seconds: int = 120
    kitchen_eta_uncertainty_ratio: float = 0.2
    kitchen_eta_min_uncertainty_seconds: int = 60
    kitchen_overdue_remainder_seconds: int = 60
    kitchen_max_tasks_per_order: int = 40

    # P005: cash, pickup credentials, and notifications.
    pickup_hash_key: str = "dev-only-pickup-hash-key-change-me"
    pickup_credential_ttl_seconds: int = 600
    pickup_issue_limit: int = 6
    pickup_issue_window_seconds: int = 600
    pickup_verify_failure_limit: int = 10
    pickup_ticket_failure_limit: int = 5
    pickup_failure_window_seconds: int = 900

    # Web Push. The private key is read from the environment only.
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_subject: str = "mailto:admin@bowlbyte.local"
    push_encryption_key: str = "dev-only-push-encryption-key-change-me"
    push_allowed_hosts: str = (
        "fcm.googleapis.com,updates.push.services.mozilla.com,"
        "*.push.services.mozilla.com,*.notify.windows.com,"
        "web.push.apple.com,*.push.apple.com"
    )
    # Non-production only. Lets controlled tests use the simulator host below.
    push_allow_test_endpoints: bool = False
    push_test_endpoint_enabled: bool = True
    push_max_subscriptions_per_user: int = 10
    push_max_attempts: int = 5
    push_backoff_base_seconds: int = 30
    push_backoff_max_seconds: int = 3600
    push_timeout_seconds: float = 8.0
    push_ttl_seconds: int = 1800
    push_event_max_age_seconds: int = 1800
    push_claim_seconds: int = 90
    push_test_limit: int = 3
    push_test_window_seconds: int = 600
    notification_beat_seconds: int = 15
    pickup_hold_default_minutes: int = 30
    pickup_hold_warn_lead_minutes: int = 10
    unclaimed_beat_seconds: int = 60
    push_backlog_warn_events: int = 25
    push_oldest_pending_warn_seconds: int = 300

    # P006 food intelligence. Dates for new records use this timezone.
    # Order service_date is still the UTC date stored by P003.
    canteen_timezone: str = "Asia/Kolkata"
    forecast_min_baseline_days: int = 7
    forecast_min_ml_days: int = 28
    forecast_holdout_days: int = 7
    forecast_seed: int = 7
    forecast_artifact_dir: str = "var/forecast_artifacts"
    planning_shortage_weight: int = 3
    planning_overproduction_weight: int = 1
    planning_window_seconds: int = 3 * 60 * 60
    planning_buffer_ratio: float = 0.0
    intelligence_job_limit: int = 4
    intelligence_job_window_seconds: int = 600

    @model_validator(mode="after")
    def _production_guards(self) -> Self:
        if self.environment == "production":
            if not self.cookie_secure:
                raise ValueError("COOKIE_SECURE must be true in production.")
            if self.push_allow_test_endpoints:
                raise ValueError("PUSH_ALLOW_TEST_ENDPOINTS must be false in production.")
            if len(self.proxy_shared_secret) < 24 or self.proxy_shared_secret.startswith(
                ("change-me", "replace-with")
            ):
                raise ValueError("Set a long PROXY_SHARED_SECRET in production.")
            if self.pickup_hash_key.startswith(
                "replace-with"
            ) or self.push_encryption_key.startswith("replace-with"):
                raise ValueError("Replace the staging placeholder keys before production.")
            if ":bowlbyte@" in self.database_url:
                raise ValueError("Replace the default database password in production.")
            if self.pickup_hash_key.startswith("dev-only") or self.push_encryption_key.startswith(
                "dev-only"
            ):
                raise ValueError("Set PICKUP_HASH_KEY and PUSH_ENCRYPTION_KEY in production.")
            if not self.vapid_public_key or self.vapid_public_key.startswith("replace-with"):
                raise ValueError("Set VAPID_PUBLIC_KEY in production.")
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def allowed_origins(self) -> set[str]:
        origins = set(self.cors_origin_list)
        public = self.public_app_url.rstrip("/")
        if public:
            origins.add(public)
        return origins

    @property
    def push_host_patterns(self) -> list[str]:
        return [item.strip().lower() for item in self.push_allowed_hosts.split(",") if item.strip()]

    @property
    def push_configured(self) -> bool:
        # The API only needs the public key. The private key lives in the worker alone.
        return bool(self.vapid_public_key)

    @property
    def can_sign_push(self) -> bool:
        return bool(self.vapid_public_key and self.vapid_private_key)

    @property
    def session_cookie_name(self) -> str:
        if self.cookie_secure:
            return "__Host-bowlbyte_session"
        return "bowlbyte_session"

    @property
    def csrf_cookie_name(self) -> str:
        if self.cookie_secure:
            return "__Host-bowlbyte_csrf"
        return "bowlbyte_csrf"


@lru_cache
def get_settings() -> Settings:
    return Settings()
