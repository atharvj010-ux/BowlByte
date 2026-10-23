import os
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.core.config import get_settings

settings = get_settings()

# Vercel (and other serverless hosts) create many short-lived processes. A
# QueuePool of 5+10 per process exhausts Supabase session pooler (often 15).
# NullPool opens one connection per request and closes it immediately.
_serverless = os.environ.get("VERCEL") == "1" or bool(
    os.environ.get("AWS_LAMBDA_FUNCTION_NAME")
)

if _serverless:
    engine = create_engine(
        settings.database_url,
        poolclass=NullPool,
        connect_args={"prepare_threshold": None},
    )
else:
    engine = create_engine(
        settings.database_url,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
        connect_args={"prepare_threshold": None},
    )

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    """Yield a request-scoped session.

    Callers that later mutate orders or payments must commit explicitly
    inside the service transaction. This dependency only closes the session.
    """

    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
