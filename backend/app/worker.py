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
        },
        "sweep-pickup-holds": {
            "task": "bowlbyte.sweep_pickup_holds",
            "schedule": float(settings.unclaimed_beat_seconds),
        },
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


@celery_app.task(name="bowlbyte.sweep_pickup_holds")
def sweep_pickup_holds_task() -> dict:
    """Mark overdue READY orders unclaimed. Idempotent and payment-neutral."""

    from datetime import UTC, datetime

    from app.db.session import SessionLocal
    from app.services.unclaimed import sweep_pickup_holds

    db = SessionLocal()
    try:
        return sweep_pickup_holds(db, datetime.now(UTC))
    finally:
        db.close()


@celery_app.task(name="bowlbyte.train_forecast", soft_time_limit=90, time_limit=120)
def train_forecast_task(job_id: str) -> None:
    """Train a forecast model outside the request that queued it.

    The task only reads the job row and writes model metadata. It does not
    change orders, payments, stock, or production batches.
    """

    from uuid import UUID

    from app.services.forecasting import execute_training_job

    execute_training_job(UUID(job_id))
