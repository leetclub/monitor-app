#!/bin/bash
# Setup script for Vendon Sales Sync
# This script:
# 1. Creates the database table
# 2. Adds Vendon API key to Kubernetes secrets
# 3. Deploys the cronjob

set -e

echo "🔧 Setting up Vendon Sales Sync..."

# Get database connection details from Kubernetes secrets
echo "📡 Getting database connection details from Kubernetes..."
DB_HOST=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-host}' | base64 -d)
DB_PORT=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-port}' | base64 -d)
DB_NAME=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-name}' | base64 -d)
DB_USER=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-user}' | base64 -d)
DB_PASSWORD=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-password}' | base64 -d)

echo "✅ Database: $DB_USER@$DB_HOST:$DB_PORT/$DB_NAME"

# Step 1: Create database tables
echo ""
echo "📊 Step 1: Creating database tables..."
export PGPASSWORD="$DB_PASSWORD"
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f migrations/init_vendon_sales_table.sql
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f migrations/add_vendon_sync_logs_table.sql
echo "✅ Database tables created successfully"

# Step 2: Add Vendon API key to Kubernetes secrets
echo ""
echo "🔑 Step 2: Adding Vendon API key to Kubernetes secrets..."
VENDON_API_KEY="7OMcvPEpSGsM6jRNZJnQVKZWlQEBWSqD"

# Check if vendon-api-key already exists
if kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.vendon-api-key}' &>/dev/null; then
    echo "⚠️  vendon-api-key already exists, updating it..."
    kubectl patch secret people-analytics-secrets -n leet-monitor --type='json' \
        -p="[{\"op\": \"replace\", \"path\": \"/data/vendon-api-key\", \"value\": \"$(echo -n "$VENDON_API_KEY" | base64)\"}]"
else
    echo "➕ Adding new vendon-api-key..."
    kubectl patch secret people-analytics-secrets -n leet-monitor --type='json' \
        -p="[{\"op\": \"add\", \"path\": \"/data/vendon-api-key\", \"value\": \"$(echo -n "$VENDON_API_KEY" | base64)\"}]"
fi
echo "✅ Vendon API key added to secrets"

# Step 3: Deploy cronjob
echo ""
echo "🚀 Step 3: Deploying cronjob..."
kubectl apply -f k8s/cronjob.yaml
echo "✅ Cronjob deployed successfully"

echo ""
echo "🎉 Setup complete! The Vendon sales sync will run daily at 2 AM UTC."
echo ""
echo "To verify:"
echo "  - Check cronjob: kubectl get cronjob vendon-sales-sync -n leet-monitor"
echo "  - Check table: psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c '\\d vendon_sales_records'"

