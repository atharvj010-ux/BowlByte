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
    worker_hijack_root_logger=False,
)


@celery_app.task(name="bowlbyte.worker_ping")
def worker_ping() -> str:
    """Infrastructure probe used to confirm the worker process can execute a task.

    This task does not send notifications, move orders, or record payments.
    """

    return "ok"
