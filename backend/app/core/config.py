from functools import lru_cache
from typing import Literal

from pydantic import Field
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
