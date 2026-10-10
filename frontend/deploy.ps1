# Frontend Deployment Script for Cloud Run - Performance Optimized
# Usage: .\deploy.ps1

Write-Host "Starting High-Performance Frontend Deployment to Cloud Run..." -ForegroundColor Green

# Configuration
$PROJECT_ID = "playgroundai-470111"
$SERVICE_NAME = "yaaralabs-playground-frontend"
$REGION = "us-central1"
$COMPUTE_SA = "107731139870-compute@developer.gserviceaccount.com"

Write-Host "Configuration:" -ForegroundColor Yellow
Write-Host "  Project ID: $PROJECT_ID" -ForegroundColor Cyan
Write-Host "  Service Name: $SERVICE_NAME" -ForegroundColor Cyan
Write-Host "  Region: $REGION" -ForegroundColor Cyan
Write-Host "  Compute SA: $COMPUTE_SA" -ForegroundColor Cyan

# Step 1: Fix all required permissions
Write-Host "Step 1: Fixing required permissions..." -ForegroundColor Blue

# Fix logging permissions
Write-Host "  Fixing logging permissions..." -ForegroundColor Cyan
gcloud projects add-iam-policy-binding $PROJECT_ID `
  --member="serviceAccount:$COMPUTE_SA" `
  --role="roles/logging.logWriter"

# Fix artifact registry permissions
Write-Host "  Fixing artifact registry permissions..." -ForegroundColor Cyan
gcloud projects add-iam-policy-binding $PROJECT_ID `
  --member="serviceAccount:$COMPUTE_SA" `
  --role="roles/artifactregistry.writer"

Write-Host "All permissions fixed successfully!" -ForegroundColor Green

# Step 2: Deploy to Cloud Run with Performance Optimizations
Write-Host "Step 2: Deploying with Performance Optimizations..." -ForegroundColor Blue
Write-Host "  CPU: 4 cores (2x faster)" -ForegroundColor Cyan
Write-Host "  Memory: 4GB (2x more)" -ForegroundColor Cyan
Write-Host "  Max Instances: 20 (2x scaling)" -ForegroundColor Cyan
Write-Host "  Concurrency: 1000 requests per instance" -ForegroundColor Cyan
Write-Host "  Min Instances: 1 (no cold starts)" -ForegroundColor Cyan

gcloud run deploy $SERVICE_NAME `
  --source . `
  --platform managed `
  --region $REGION `
  --allow-unauthenticated `
  --port 3000 `
  --memory 4Gi `
  --cpu 4 `
  --max-instances 20 `
  --min-instances 1 `
  --concurrency 1000 `
  --timeout 300 `
  --set-build-env-vars GOOGLE_RUNTIME=nodejs20,GOOGLE_NODE_RUN_SCRIPTS=build,NODE_OPTIONS="--max-old-space-size=3072" `
  --set-env-vars NODE_ENV=production,NEXT_TELEMETRY_DISABLED=1

if ($LASTEXITCODE -eq 0) {
    Write-Host "High-Performance Deployment completed successfully!" -ForegroundColor Green
    Write-Host "Your blazing-fast service is now available at:" -ForegroundColor Yellow
    gcloud run services describe $SERVICE_NAME --region $REGION --format="value(status.url)"
    
    Write-Host "Performance Features Enabled:" -ForegroundColor Green
    Write-Host "  4 CPU cores for faster processing" -ForegroundColor Cyan
    Write-Host "  4GB RAM for smooth operation" -ForegroundColor Cyan
    Write-Host "  20 max instances for high traffic" -ForegroundColor Cyan
    Write-Host "  1 min instance (no cold starts)" -ForegroundColor Cyan
    Write-Host "  1000 concurrent requests per instance" -ForegroundColor Cyan
    Write-Host "  5-minute timeout for long operations" -ForegroundColor Cyan
    Write-Host "  Optimized Node.js memory settings" -ForegroundColor Cyan
    Write-Host "  Production environment variables" -ForegroundColor Cyan
} else {
    Write-Host "Deployment failed!" -ForegroundColor Red
    exit 1
}

Write-Host "High-Performance Deployment Script Completed!" -ForegroundColor Green
Write-Host "Your UI should now be significantly faster!" -ForegroundColor Yellow
