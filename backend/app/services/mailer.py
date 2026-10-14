import logging
import smtplib
from email.message import EmailMessage

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class EmailDeliveryError(Exception):
    """SMTP rejected the message or the server could not be reached."""


def send_email(*, recipient: str, subject: str, body: str) -> None:
    """Deliver one plain-text message. The body is not written to the log."""

    settings = get_settings()
    message = EmailMessage()
    message["From"] = settings.smtp_from
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(body)
    try:
        if settings.smtp_use_tls:
            with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
                _login_if_needed(smtp)
                smtp.send_message(message)
            return
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
            if settings.smtp_starttls:
                smtp.starttls()
            _login_if_needed(smtp)
            smtp.send_message(message)
    except (OSError, smtplib.SMTPException) as exc:
        logger.warning("email delivery failed: %s", type(exc).__name__)
        raise EmailDeliveryError from exc


def _login_if_needed(smtp: smtplib.SMTP) -> None:
    settings = get_settings()
    if settings.smtp_username:
        smtp.login(settings.smtp_username, settings.smtp_password)
