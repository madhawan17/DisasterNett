# ──────────────────────────────────────────────────────────────────────────────
# Dockerfile — Flash Flood Risk API
#
# Targets Hugging Face Spaces (Docker SDK, port 7860).
# Uses CPU-only PyTorch to keep the image small (~1 GB vs ~5 GB for CUDA).
#
# Build & run locally:
#   docker build -t flood-api .
#   docker run -p 7860:7860 flood-api
#
# Then open: http://localhost:7860/docs
# ──────────────────────────────────────────────────────────────────────────────

FROM python:3.11-slim

# ── System metadata ────────────────────────────────────────────────────────────
LABEL maintainer="NMIMS Hack Team"
LABEL description="Flash Flood Risk Inference API — FastAPI + LSTM"

WORKDIR /app

# ── Install CPU-only PyTorch FIRST ─────────────────────────────────────────────
# The default PyPI torch wheel bundles CUDA (~2.5 GB).
# The official CPU wheel from pytorch.org is ~220 MB.
RUN pip install --no-cache-dir \
    "torch==2.6.0" \
    --index-url https://download.pytorch.org/whl/cpu

# ── Install remaining serving dependencies ─────────────────────────────────────
# Copy only the slim requirements file (not the full training requirements.txt)
COPY requirements-serve.txt .
RUN pip install --no-cache-dir -r requirements-serve.txt

# ── Copy application source ─────────────────────────────────────────────────────
COPY src/ src/
COPY configs/ configs/

# ── Copy model artifacts ────────────────────────────────────────────────────────
# scaler.joblib  — StandardScaler fitted on training data
COPY artifacts/scaler.joblib artifacts/scaler.joblib

# best.pt        — nowcast model  (used by /predict)
# forecast_24h.pt — 24h forecast model (used by /forecast)
COPY models/best.pt models/best.pt
COPY models/forecast_24h.pt models/forecast_24h.pt

# ── Hugging Face Spaces expects port 7860 ──────────────────────────────────────
EXPOSE 7860

# ── Run ────────────────────────────────────────────────────────────────────────
# --host 0.0.0.0  — accept connections from outside the container
# --port 7860     — HF Spaces default; override with -e PORT=xxxx if needed
CMD ["uvicorn", "src.api.app:app", "--host", "0.0.0.0", "--port", "7860"]
