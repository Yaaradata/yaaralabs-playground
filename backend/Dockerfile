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

# Bake the Text Recognition sentence-embedding model into the image (text_embed_service.py loads it
# from TEXT_EMBED_MODEL_DIR with local_files_only=True, so nothing is downloaded at request time).
# BAAI/bge-small-en-v1.5: ~130 MB (config, tokenizer, safetensors weights).
ENV TEXT_EMBED_MODEL=BAAI/bge-small-en-v1.5     TEXT_EMBED_MODEL_DIR=/app/models/text-embed
RUN python -c "from huggingface_hub import snapshot_download;     snapshot_download('BAAI/bge-small-en-v1.5', local_dir='/app/models/text-embed',     allow_patterns=['*.json', '*.txt', 'model.safetensors'])" &&     python -c "from transformers import AutoTokenizer, AutoModel;     AutoTokenizer.from_pretrained('/app/models/text-embed', local_files_only=True);     AutoModel.from_pretrained('/app/models/text-embed', local_files_only=True);     print('✅ Text embedding model baked into the image')"

# Image Recognition: pre-download the ImageNet weights of both models a learner can pick
# (MobileNetV2 width 0.35 at 128 px, ~2 MB; EfficientNetB0 at 224 px, ~16 MB), so training never
# downloads them during a session. KERAS_HOME is shared so the non-root user can read them.
ENV KERAS_HOME=/app/.keras
RUN mkdir -p /app/.keras && python -c "import keras;     keras.applications.MobileNetV2(include_top=False, weights='imagenet', input_shape=(128, 128, 3), alpha=0.35);     keras.applications.EfficientNetB0(include_top=False, weights='imagenet', input_shape=(224, 224, 3));     print('✅ Image model weights cached')"

# Copy application code
COPY . .

# Create non-root user
RUN groupadd -g 1001 appgroup && \
    useradd -u 1001 -g appgroup -s /bin/false -m appuser && \
    chown -R appuser:appgroup /app && \
    chmod -R 755 /app && \
    chmod -R 755 /app/.cache /app/.keras

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
