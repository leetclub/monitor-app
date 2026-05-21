FROM python:3.11-bookworm

WORKDIR /app

RUN sed -i 's/deb.debian.org/prod.debian.map.fastly.net/g' /etc/apt/sources.list.d/debian.sources || \
    sed -i 's/deb.debian.org/cdn-fastly.deb.debian.org/g' /etc/apt/sources.list

RUN apt-get update && \
    for i in {1..5}; do apt-get install -y --no-install-recommends \
    gcc \
    libc6-dev \
    postgresql-client && break || sleep 5; done && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --retries 10 -r requirements.txt

# Build from this directory: docker build -t programmeradmin25/people-analytics-sync:latest .
COPY . /app

RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

CMD ["python", "sync_service.py"]
