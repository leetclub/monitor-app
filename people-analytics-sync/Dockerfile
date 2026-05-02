FROM python:3.11-bookworm

WORKDIR /app

# 1. Switch to a more reliable mirror and implement retry logic
RUN sed -i 's/deb.debian.org/prod.debian.map.fastly.net/g' /etc/apt/sources.list.d/debian.sources || \
    sed -i 's/deb.debian.org/cdn-fastly.deb.debian.org/g' /etc/apt/sources.list

RUN apt-get update && \
    for i in {1..5}; do apt-get install -y --no-install-recommends \
    gcc \
    libc6-dev \
    postgresql-client && break || sleep 5; done && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY people-analytics-sync/requirements.txt .
# Adding --retries here helps with pip connection issues too
RUN pip install --no-cache-dir --retries 10 -r requirements.txt

# Copy application code
COPY people-analytics-sync /app

# Copy vendon-sync code from parent directory
# Note: This requires building from parent directory with: docker build -f people-analytics-sync/Dockerfile .
COPY vendon-sync /app/vendon-sync

# Create non-root user
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

CMD ["python", "sync_service.py"]

