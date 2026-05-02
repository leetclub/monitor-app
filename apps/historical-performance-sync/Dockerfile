FROM python:3.11-alpine

WORKDIR /app

RUN apk add --no-cache \
    gcc \
    musl-dev \
    postgresql-client \
    postgresql-dev

COPY requirements.txt .
RUN pip install --no-cache-dir --retries 10 --default-timeout=100 -r requirements.txt

COPY . .

RUN adduser -D -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

CMD ["python", "sync_service.py"]

