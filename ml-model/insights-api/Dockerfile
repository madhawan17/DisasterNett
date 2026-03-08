# =============================================================================
# AMBROSIA SAR Insights API — FastAPI
# Deploy target: HuggingFace Spaces (Docker SDK)
# Runtime port : 7860  (HF default; overridable via PORT env var)
# Python       : 3.11-slim
# =============================================================================

FROM python:3.11-slim

# HF Spaces runs containers as a non-root user (uid=1000)
RUN adduser --uid 1000 --disabled-password --gecos "" appuser

# System dependencies
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libgomp1 \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python dependencies (cached layer)
COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# Application source
COPY . ./

# Permissions
RUN mkdir -p /app/data /app/.cache \
    && chown -R appuser:appuser /app

USER appuser

# Environment
ENV PORT=7860
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

EXPOSE 7860

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -fs http://localhost:${PORT}/health || exit 1

# Start server
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT} --workers 1 --log-level info"]
