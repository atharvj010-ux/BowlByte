import redis
from sqlalchemy import text

from app.core.config import get_settings
from app.db.session import engine


def check_postgres() -> None:
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))


def check_redis() -> None:
    client = redis.Redis.from_url(
        get_settings().redis_url,
        socket_connect_timeout=2,
        socket_timeout=2,
    )
    try:
        if client.ping() is not True:
            raise RuntimeError("Redis ping returned a negative result")
    finally:
        client.close()
