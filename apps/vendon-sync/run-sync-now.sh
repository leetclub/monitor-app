#!/bin/bash
# Run sync now using a simple Python one-liner approach
# This creates a job that runs the sync directly

set -e

echo "🚀 Creating one-off sync job..."

cat <<EOF | kubectl apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: vendon-sync-now-$(date +%s)
  namespace: leet-monitor
spec:
  template:
    metadata:
      labels:
        app: vendon-sales-sync
    spec:
      restartPolicy: OnFailure
      containers:
      - name: sync
        image: python:3.11-slim
        command:
        - sh
        - -c
        - |
          pip install -q psycopg2-binary requests sqlalchemy python-dotenv
          cat > /tmp/sync.py <<'PYEOF'
$(cat sync_service.py)
PYEOF
          cd /tmp && python sync.py
        env:
        - name: DB_HOST
          valueFrom:
            secretKeyRef:
              name: people-analytics-secrets
              key: db-host
        - name: DB_PORT
          valueFrom:
            secretKeyRef:
              name: people-analytics-secrets
              key: db-port
        - name: DB_NAME
          valueFrom:
            secretKeyRef:
              name: people-analytics-secrets
              key: db-name
        - name: DB_USER
          valueFrom:
            secretKeyRef:
              name: people-analytics-secrets
              key: db-user
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: people-analytics-secrets
              key: db-password
        - name: VENDON_API_KEY
          valueFrom:
            secretKeyRef:
              name: people-analytics-secrets
              key: vendon-api-key
        - name: VENDON_API_BASE
          value: "https://cloud.vendon.net/rest/v1.9.0"
        - name: VENDON_SYNC_DAYS_BACK
          value: "1"
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"
EOF

JOB_NAME=$(kubectl get jobs -n leet-monitor -l app=vendon-sales-sync --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1].metadata.name}')
echo "✅ Job created: $JOB_NAME"
echo "⏳ Waiting for job to start..."
sleep 10

echo ""
echo "📜 Job logs:"
kubectl logs -n leet-monitor job/$JOB_NAME --tail=100 -f



