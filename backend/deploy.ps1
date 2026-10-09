# YaaraLabs Playground Backend - Cloud Run Deployment Script (PowerShell)
# This script builds and deploys the FastAPI backend to Google Cloud Run

# gcloud writes progress to stderr, which "Stop" turns into a fatal error in
# Windows PowerShell 5.1; each step checks $LASTEXITCODE instead.
$ErrorActionPreference = "Continue"

# Configuration
$PROJECT_ID = gcloud config get-value project
$SERVICE_NAME = "yaaralabs-playground-backend"
$REGION = "us-central1"
$TAG = Get-Date -Format "yyyyMMdd-HHmmss"
$IMAGE_NAME = "$REGION-docker.pkg.dev/$PROJECT_ID/cloud-run-source-deploy/$SERVICE_NAME"

Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host "  YaaraLabs Playground Backend - Deploy    " -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Configuration:" -ForegroundColor Yellow
Write-Host "  Project ID:  $PROJECT_ID" -ForegroundColor Cyan
Write-Host "  Service:     $SERVICE_NAME" -ForegroundColor Cyan
Write-Host "  Region:      $REGION" -ForegroundColor Cyan
Write-Host "  Image:       ${IMAGE_NAME}:$TAG" -ForegroundColor Cyan
Write-Host ""
Write-Host "=============================================" -ForegroundColor Yellow
Write-Host ""

# Step 1: Build and push with Cloud Build (no local Docker needed; .gcloudignore keeps .env out)
Write-Host "[1/3] Building image with Cloud Build..." -ForegroundColor Blue
Write-Host "  This may take 10-15 minutes..." -ForegroundColor DarkGray
gcloud builds submit --tag "${IMAGE_NAME}:$TAG" --machine-type=e2-highcpu-8 --timeout=3600s .
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: Cloud Build failed" -ForegroundColor Red
    exit 1
}
Write-Host "  SUCCESS: Image built and pushed" -ForegroundColor Green
Write-Host ""

# Step 2: Deploy to Cloud Run
Write-Host "[2/3] Deploying to Cloud Run..." -ForegroundColor Blue
Write-Host "  This may take 2-3 minutes..." -ForegroundColor DarkGray

# Build the command with proper escaping
# Override with $env:CORS_ORIGINS once the frontend domain is final
$corsOrigins = if ($env:CORS_ORIGINS) { $env:CORS_ORIGINS } else { "https://yaaralabs-playground-frontend-773717965404.us-central1.run.app,https://scratch-editor-773717965404.us-central1.run.app" }
$envVars = @(
    "GOOGLE_CLOUD_PROJECT=$PROJECT_ID"
    "ENVIRONMENT=production"
    "FIRESTORE_DATABASE_ID=yaaralabs-playground"
    "GCS_BUCKET_NAME=yaaralabs-playground-470111-data"
    "PUBSUB_TOPIC_NAME=yaaralabs-train-jobs"
    "PUBSUB_SUBSCRIPTION_NAME=yaaralabs-trainer-sub"
    "CORS_ORIGIN=$corsOrigins"
    "FIRESTORE_BATCH_SIZE=500"
    "GCS_CHUNK_SIZE=8388608"
) -join "@"

gcloud run deploy $SERVICE_NAME `
    --image="${IMAGE_NAME}:$TAG" `
    --region=$REGION `
    --platform=managed `
    --allow-unauthenticated `
    --service-account="yl-backend@${PROJECT_ID}.iam.gserviceaccount.com" `
    --set-env-vars="^@^$envVars" `
    --set-secrets="GOOGLE_API_KEY=yaaralabs-google-api-key:latest,GOOGLE_CSE_ID=yaaralabs-google-cse-id:latest" `
    --memory=8Gi `
    --cpu=4 `
    --concurrency=320 `
    --cpu-boost `
    --max-instances=50 `
    --timeout=1500 `
    --port=8080 `
    --execution-environment=gen2 `
    --quiet

if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: Cloud Run deployment failed" -ForegroundColor Red
    exit 1
}
Write-Host "  SUCCESS: Deployed to Cloud Run" -ForegroundColor Green
Write-Host ""

# Step 3: Get the service URL
Write-Host "[3/3] Retrieving service URL..." -ForegroundColor Blue
$SERVICE_URL = gcloud run services describe $SERVICE_NAME --region $REGION --format="value(status.url)"
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: Failed to retrieve service URL" -ForegroundColor Red
    exit 1
}
Write-Host "  SUCCESS: Service URL retrieved" -ForegroundColor Green
Write-Host ""

# Step 3b: Test the deployment
Write-Host "[3/3] Testing deployment..." -ForegroundColor Blue
Start-Sleep -Seconds 5

try {
    $response = Invoke-RestMethod -Uri "$SERVICE_URL/health" -Method Get -TimeoutSec 30
    Write-Host "  SUCCESS: Health check passed" -ForegroundColor Green
    Write-Host "  Response: $($response | ConvertTo-Json -Compress)" -ForegroundColor DarkGray
}
catch {
    Write-Host "  WARNING: Health check failed (service may still be starting)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host "  DEPLOYMENT SUCCESSFUL!                    " -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Service URLs:" -ForegroundColor Cyan
Write-Host "  Main:        $SERVICE_URL" -ForegroundColor White
Write-Host "  API Docs:    $SERVICE_URL/docs" -ForegroundColor White
Write-Host "  Health:      $SERVICE_URL/health" -ForegroundColor White
Write-Host ""
Write-Host "Useful Commands:" -ForegroundColor Cyan
Write-Host "  View logs:" -ForegroundColor White
Write-Host "    gcloud run logs tail $SERVICE_NAME --region $REGION" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Scale service:" -ForegroundColor White
Write-Host "    gcloud run services update $SERVICE_NAME --region $REGION --max-instances 20" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Redeploy:" -ForegroundColor White
Write-Host "    .\deploy.ps1" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "  1. Update frontend CORS_ORIGIN to: $SERVICE_URL" -ForegroundColor White
Write-Host "  2. Test the API at: $SERVICE_URL/docs" -ForegroundColor White
Write-Host "  3. Monitor logs for any errors" -ForegroundColor White
Write-Host ""