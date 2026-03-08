# =============================================================================
# Lifeline Accessibility & Road Network Analysis — FastAPI
# Deploy target: Hugging Face Spaces (Docker SDK)
# Runtime port : 7860  (HF default; overridable via PORT env var)
# Python       : 3.11-slim
# =============================================================================

# ---- base image -------------------------------------------------------------
FROM python:3.11-slim

# HF Spaces runs containers as a non-root user with uid=1000.
# Create the same user here so file permissions are consistent.
RUN adduser --uid 1000 --disabled-password --gecos "" appuser

# ---- system dependencies ----------------------------------------------------
# All geospatial wheels (shapely, pyproj, fiona, geopandas) are self-contained
# manylinux builds, so no libgdal / libgeos required at the OS level.
# libgomp1  — OpenMP runtime needed by scipy / numpy for parallel ops
# curl      — optional; useful for container health-check probes
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libgomp1 \
        curl \
    && rm -rf /var/lib/apt/lists/*

# ---- working directory ------------------------------------------------------
WORKDIR /app

# ---- Python dependencies (cached layer) -------------------------------------
# Copy only the requirements file first so this layer is rebuilt only when
# dependencies change, not on every source-code edit.
COPY Lifeline_Engine/requirements-prod.txt ./requirements-prod.txt

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements-prod.txt

# ---- application source -----------------------------------------------------
COPY Lifeline_Engine/ ./

# Give the cache / output directory write-access to the app user.
# OSMnx stores its HTTP cache under ~/.cache by default; we redirect it here.
RUN mkdir -p /app/data /app/.cache \
    && chown -R appuser:appuser /app

# ---- switch to non-root user ------------------------------------------------
USER appuser

# ---- environment ------------------------------------------------------------
ENV PORT=7860
# Redirect OSMnx / requests cache to a writable path inside the container
ENV XDG_CACHE_HOME=/app/.cache
# Prevent Python from buffering stdout (shows logs immediately in HF logs panel)
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# ---- expose port ------------------------------------------------------------
EXPOSE 7860

# ---- health check -----------------------------------------------------------
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -fs http://localhost:${PORT}/health || exit 1

# ---- start server -----------------------------------------------------------
# Run uvicorn directly (not via __main__) so signals are handled cleanly.
CMD ["sh", "-c", "uvicorn api:app --host 0.0.0.0 --port ${PORT} --workers 1 --log-level info"]
