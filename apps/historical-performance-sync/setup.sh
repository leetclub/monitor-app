#!/bin/bash
set -euo pipefail

echo "🔧 Setting up Historical Performance Sync..."

# Get DB credentials from Kubernetes secrets
echo "📡 Getting database connection details from Kubernetes..."
DB_HOST=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-host}' | base64 -d)
DB_PORT=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-port}' | base64 -d)
DB_NAME=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-name}' | base64 -d)
DB_USER=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-user}' | base64 -d)
export PGPASSWORD=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-password}' | base64 -d)

echo "✅ Database: $DB_USER@$DB_HOST:$DB_PORT/$DB_NAME"

# Step 1: Create database tables
echo ""
echo "📊 Step 1: Creating database tables..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f migrations/init_historical_performance_table.sql
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f migrations/add_historical_performance_sync_logs_table.sql
echo "✅ Database tables created successfully"

echo ""
echo "🎉 Database setup complete!"
echo ""
echo "Next steps:"
echo "  1. Build Docker images:"
echo "     docker build -f Dockerfile -t programmeradmin25/historical-performance-sync:latest ."
echo "     docker build -f Dockerfile.api -t programmeradmin25/historical-performance-api:latest ."
echo "  2. Push images:"
echo "     docker push programmeradmin25/historical-performance-sync:latest"
echo "     docker push programmeradmin25/historical-performance-api:latest"
echo "  3. Deploy to Kubernetes:"
echo "     kubectl apply -f k8s/cronjob.yaml"
echo "     kubectl apply -f k8s/api-deployment.yaml"
echo "     kubectl apply -f k8s/api-ingress.yaml"

