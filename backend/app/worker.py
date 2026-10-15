from celery import Celery

from app.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "bowlbyte",
    broker=settings.redis_url,
    backend=settings.redis_url,
)
celery_app.conf.update(
    task_ignore_result=True,
    task_default_queue="bowlbyte",
    broker_connection_retry_on_startup=True,
    broker_transport_options={"socket_connect_timeout": 1, "socket_timeout": 2},
    worker_hijack_root_logger=False,
    beat_schedule={
        "drain-notification-outbox": {
            "task": "bowlbyte.drain_outbox",
            "schedule": float(settings.notification_beat_seconds),
        }
    },
)


@celery_app.task(name="bowlbyte.worker_ping")
def worker_ping() -> str:
    """Infrastructure probe used to confirm the worker process can execute a task.

    This task does not send notifications, move orders, or record payments.
    """

    return "ok"


@celery_app.task(name="bowlbyte.drain_outbox")
def drain_outbox_task() -> dict:
    """Deliver due notification outbox events.

    Reads PostgreSQL for work, so a lost message or a restart loses nothing.
    It never changes order or payment state.
    """

    from app.services.push_delivery import drain_outbox

    return drain_outbox()
