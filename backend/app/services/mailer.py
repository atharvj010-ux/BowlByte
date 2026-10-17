import logging
import smtplib
import ssl
from email.message import EmailMessage

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class EmailDeliveryError(Exception):
    """SMTP rejected the message or the server could not be reached."""


def verified_tls_context() -> ssl.SSLContext:
    """Certificate and hostname checks stay on. Callers cannot turn them off."""

    context = ssl.create_default_context()
    context.check_hostname = True
    context.verify_mode = ssl.CERT_REQUIRED
    return context


def send_email(*, recipient: str, subject: str, body: str, html: str | None = None) -> None:
    """Deliver one message. Credentials, body, and SMTP replies are not logged."""

    settings = get_settings()
    if settings.smtp_username and not (settings.smtp_use_tls or settings.smtp_starttls):
        logger.warning("email delivery failed: plaintext_auth_refused")
        raise EmailDeliveryError
    message = EmailMessage()
    message["From"] = settings.smtp_from
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(body)
    if html:
        message.add_alternative(html, subtype="html")
    try:
        if settings.smtp_use_tls:
            with smtplib.SMTP_SSL(
                settings.smtp_host,
                settings.smtp_port,
                timeout=10,
                context=verified_tls_context(),
            ) as smtp:
                _login_if_needed(smtp)
                smtp.send_message(message)
            return
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
            if settings.smtp_starttls:
                smtp.starttls(context=verified_tls_context())
            _login_if_needed(smtp)
            smtp.send_message(message)
    except (OSError, smtplib.SMTPException) as exc:
        logger.warning("email delivery failed: %s", type(exc).__name__)
        raise EmailDeliveryError from None


def _login_if_needed(smtp: smtplib.SMTP) -> None:
    settings = get_settings()
    if settings.smtp_username:
        smtp.login(settings.smtp_username, settings.smtp_password)
