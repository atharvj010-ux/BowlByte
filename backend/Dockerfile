FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN addgroup --system bowlbyte && adduser --system --ingroup bowlbyte bowlbyte

COPY pyproject.toml README.md requirements.lock ./
RUN pip install --upgrade pip && pip install -r requirements.lock

COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./
RUN pip install --no-deps .

USER bowlbyte

EXPOSE 8000

CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000"]
