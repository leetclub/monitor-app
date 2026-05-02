#!/bin/bash
# Add admin secrets to k8s secret

SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))" 2>/dev/null || echo "change-me-secret-key-$(date +%s)")
API_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))" 2>/dev/null || echo "change-me-api-key-$(date +%s)")

kubectl create secret generic people-analytics-secrets \
  --from-literal=admin-secret-key="$SECRET_KEY" \
  --from-literal=admin-api-key="$API_KEY" \
  --from-literal=admin-username='admin' \
  --from-literal=admin-password='admin123' \
  -n leet-monitor \
  --dry-run=client -o yaml | kubectl apply -f -

echo "✅ Admin secrets added/updated"
echo "Default credentials:"
echo "  Username: admin"
echo "  Password: admin123"
echo "⚠️  Change the password after first login!"
