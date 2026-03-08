# =============================================================================
# AMBROSIA Enhanced Risk API — FastAPI
# Deploy target: HuggingFace Spaces (Docker SDK)
# Runtime port : 7860  (HF default; overridable via PORT env var)
# Python       : 3.11-slim
# =============================================================================

FROM python:3.11-slim

RUN adduser --uid 1000 --disabled-password --gecos "" appuser

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

COPY . ./

RUN mkdir -p /app/data /app/.cache \
    && chown -R appuser:appuser /app

USER appuser

ENV PORT=7860
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -fs http://localhost:${PORT}/health || exit 1

CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT} --workers 1 --log-level info"]
