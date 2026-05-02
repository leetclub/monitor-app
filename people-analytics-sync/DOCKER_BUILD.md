# Docker Build and Deployment Guide

Complete guide for building and deploying the People Analytics Sync service using Docker.

## Prerequisites

- Docker installed and running
- Access to a container registry (Docker Hub, Digital Ocean Container Registry, etc.)
- Kubernetes cluster (if deploying to K8s)

## Step 1: Build Docker Images

### Build Sync Service Image

```bash
cd people-analytics-sync

# Build the image
docker build -t people-analytics-sync:latest .

# Verify the image was created
docker images | grep people-analytics-sync
```

### Build API Service Image

```bash
cd people-analytics-sync

# Build the API image
docker build -f Dockerfile.api -t people-analytics-sync:api-latest .

# Verify the image was created
docker images | grep people-analytics-sync
```

## Step 2: Test Images Locally

### Test Sync Service

```bash
# Run with environment variables
docker run --rm \
  -e DB_HOST=your-db-host.db.ondigitalocean.com \
  -e DB_PORT=25060 \
  -e DB_NAME=people_analytics \
  -e DB_USER=doadmin \
  -e DB_PASSWORD=your-password \
  -e VIDEOLOFT_EMAIL=your-email@example.com \
  -e VIDEOLOFT_PASSWORD=your-password \
  -e SYNC_DAYS_BACK=1 \
  -e SYNC_INTERVAL=date \
  -e TIMEZONE=Asia/Kuwait \
  people-analytics-sync:latest
```

### Test API Service

```bash
# Run API service
docker run --rm -p 5000:5000 \
  -e DB_HOST=your-db-host.db.ondigitalocean.com \
  -e DB_PORT=25060 \
  -e DB_NAME=people_analytics \
  -e DB_USER=doadmin \
  -e DB_PASSWORD=your-password \
  -e API_PORT=5000 \
  people-analytics-sync:api-latest

# Test in another terminal
curl http://localhost:5000/health
```

## Step 3: Tag Images for Registry

### Option A: Docker Hub

```bash
# Login to Docker Hub
docker login

# Tag images
docker tag people-analytics-sync:latest your-dockerhub-username/people-analytics-sync:latest
docker tag people-analytics-sync:api-latest your-dockerhub-username/people-analytics-sync:api-latest

# Optional: Add version tags
docker tag people-analytics-sync:latest your-dockerhub-username/people-analytics-sync:v1.0.0
docker tag people-analytics-sync:api-latest your-dockerhub-username/people-analytics-sync:api-v1.0.0
```

### Option B: Digital Ocean Container Registry

```bash
# Install doctl if not already installed
# https://docs.digitalocean.com/reference/doctl/how-to/install/

# Login to Digital Ocean registry
doctl registry login

# Create registry if it doesn't exist
doctl registry create your-registry-name

# Tag images with registry URL
docker tag people-analytics-sync:latest registry.digitalocean.com/your-registry-name/people-analytics-sync:latest
docker tag people-analytics-sync:api-latest registry.digitalocean.com/your-registry-name/people-analytics-sync:api-latest
```

### Option C: Other Private Registry

```bash
# Tag with your registry URL
docker tag people-analytics-sync:latest your-registry.com/people-analytics-sync:latest
docker tag people-analytics-sync:api-latest your-registry.com/people-analytics-sync:api-latest
```

## Step 4: Push Images to Registry

### Docker Hub

```bash
# Push images
docker push your-dockerhub-username/people-analytics-sync:latest
docker push your-dockerhub-username/people-analytics-sync:api-latest

# Push version tags if created
docker push your-dockerhub-username/people-analytics-sync:v1.0.0
docker push your-dockerhub-username/people-analytics-sync:api-v1.0.0
```

### Digital Ocean Container Registry

```bash
# Push images
docker push registry.digitalocean.com/your-registry-name/people-analytics-sync:latest
docker push registry.digitalocean.com/your-registry-name/people-analytics-sync:api-latest
```

### Other Private Registry

```bash
# Login first
docker login your-registry.com

# Push images
docker push your-registry.com/people-analytics-sync:latest
docker push your-registry.com/people-analytics-sync:api-latest
```

## Step 5: Update Kubernetes Manifests

Update the image references in your Kubernetes manifests:

### Update `k8s/cronjob.yaml`

```yaml
containers:
- name: sync
  image: your-registry/people-analytics-sync:latest  # Update this
  imagePullPolicy: Always
```

### Update `k8s/api-deployment.yaml`

```yaml
containers:
- name: api
  image: your-registry/people-analytics-sync:api-latest  # Update this
  imagePullPolicy: Always
```

## Step 6: Deploy to Kubernetes

```bash
# Apply manifests
kubectl apply -f k8s/cronjob.yaml
kubectl apply -f k8s/api-deployment.yaml

# Verify deployments
kubectl get cronjobs
kubectl get deployments
kubectl get pods
```

## Step 7: Verify Deployment

### Check CronJob

```bash
# List cronjobs
kubectl get cronjobs

# Describe cronjob
kubectl describe cronjob people-analytics-sync

# List jobs created by cronjob
kubectl get jobs -l app=people-analytics-sync

# View logs of latest job
kubectl logs -l app=people-analytics-sync --tail=100
```

### Check API Service

```bash
# Check deployment status
kubectl get deployment people-analytics-api

# Check pods
kubectl get pods -l app=people-analytics-api

# View logs
kubectl logs -l app=people-analytics-api --tail=100

# Port forward to test
kubectl port-forward svc/people-analytics-api 5000:80

# Test in another terminal
curl http://localhost:5000/health
```

## Building with Different Tags

### Build for Production

```bash
# Build with version tag
docker build -t people-analytics-sync:v1.0.0 .
docker build -f Dockerfile.api -t people-analytics-sync:api-v1.0.0 .

# Tag and push
docker tag people-analytics-sync:v1.0.0 your-registry/people-analytics-sync:v1.0.0
docker tag people-analytics-sync:api-v1.0.0 your-registry/people-analytics-sync:api-v1.0.0
docker push your-registry/people-analytics-sync:v1.0.0
docker push your-registry/people-analytics-sync:api-v1.0.0
```

### Build for Development

```bash
# Build with dev tag
docker build -t people-analytics-sync:dev .
docker build -f Dockerfile.api -t people-analytics-sync:api-dev .
```

## Troubleshooting

### Image Build Fails

```bash
# Check Docker is running
docker ps

# Build with verbose output
docker build --progress=plain -t people-analytics-sync:latest .
```

### Push Fails - Authentication

```bash
# Re-login to registry
docker logout
docker login

# For Digital Ocean
doctl registry login
```

### Pods Can't Pull Image

```bash
# Check image pull secrets if using private registry
kubectl get secrets

# Create image pull secret if needed
kubectl create secret docker-registry regcred \
  --docker-server=your-registry.com \
  --docker-username=your-username \
  --docker-password=your-password \
  --docker-email=your-email@example.com

# Add to deployment
# Add imagePullSecrets section to pod spec
```

### Database Connection Issues

```bash
# Test database connection from pod
kubectl run -it --rm db-test --image=postgres:15-alpine --restart=Never -- \
  psql -h your-db-host.db.ondigitalocean.com -p 25060 -U doadmin -d people_analytics

# Check network connectivity
kubectl run -it --rm network-test --image=busybox --restart=Never -- \
  wget -O- http://your-db-host.db.ondigitalocean.com:25060
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Build and Push Docker Images

on:
  push:
    branches: [ main ]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v2
    
    - name: Build sync image
      run: docker build -t your-registry/people-analytics-sync:${{ github.sha }} .
    
    - name: Build API image
      run: docker build -f Dockerfile.api -t your-registry/people-analytics-sync:api-${{ github.sha }} .
    
    - name: Push images
      run: |
        docker push your-registry/people-analytics-sync:${{ github.sha }}
        docker push your-registry/people-analytics-sync:api-${{ github.sha }}
```

## Multi-Architecture Builds

For ARM64 support (e.g., Apple Silicon, ARM-based servers):

```bash
# Install buildx
docker buildx create --use

# Build for multiple architectures
docker buildx build --platform linux/amd64,linux/arm64 \
  -t your-registry/people-analytics-sync:latest \
  --push .
```


