# Use Python 3.12 slim for better compatibility
FROM python:3.12-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && \
    apt-get install -y \
        gcc \
        g++ \
        wget \
        curl \
        && rm -rf /var/lib/apt/lists/* \
        && apt-get clean

# Copy requirements first for better caching
COPY requirements.txt requirements.txt

# Install Python dependencies with optimized flags
# Upgrade pip, setuptools, and wheel first
RUN pip install --no-cache-dir --upgrade pip setuptools wheel

# Install requirements with timeout and no cache
# Remove --force-reinstall as it can cause issues
RUN pip install --no-cache-dir --timeout=300 -r requirements.txt

# Verify installation
RUN pip check || echo "Warning: pip check found issues"

# Install spaCy English model
RUN python -m spacy download en_core_web_sm

# Set HuggingFace cache to shared location (accessible by both root and appuser)
ENV HF_HOME=/app/.cache/huggingface

# Pre-download DistilBERT model to avoid rate limiting at runtime
# Cached = model files saved on disk, so 100 concurrent requests load from disk (fast) instead of downloading
RUN mkdir -p /app/.cache/huggingface && \
    python -c "from transformers import AutoTokenizer, AutoModelForSequenceClassification; \
    print('📥 Pre-downloading DistilBERT tokenizer...'); \
    AutoTokenizer.from_pretrained('distilbert-base-uncased'); \
    print('📥 Pre-downloading DistilBERT model...'); \
    AutoModelForSequenceClassification.from_pretrained('distilbert-base-uncased', num_labels=2); \
    print('✅ DistilBERT model cached successfully')" || \
    echo "⚠️ Warning: Failed to pre-download DistilBERT model (will download at runtime)"

# Copy application code
COPY . .

# Create non-root user
RUN groupadd -g 1001 appgroup && \
    useradd -u 1001 -g appgroup -s /bin/false -m appuser && \
    chown -R appuser:appgroup /app && \
    chmod -R 755 /app && \
    chmod -R 755 /app/.cache

# Switch to non-root user
USER appuser

# Expose port (Cloud Run will override this with PORT env var)
EXPOSE 8080

# Set environment variables
ENV PYTHONPATH=/app \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONHASHSEED=random \
    PYTHONIOENCODING=utf-8

# Health check with longer timeout for Cloud Run
HEALTHCHECK --interval=30s --timeout=30s --start-period=60s --retries=5 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Start the FastAPI application with uvicorn using PORT environment variable
# Use shell form to allow PORT env var expansion (defaults to 8080 if not set)
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --timeout-keep-alive 120
