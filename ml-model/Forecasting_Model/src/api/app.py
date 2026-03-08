"""Flash Flood Risk Inference API.

Start the server:
    uvicorn src.api.app:app --reload --port 8000

Endpoints:
    GET  /health                     → liveness check
    GET  /predict?lat=18.96&lon=72.82
    POST /predict  { "lat": 18.96, "lon": 72.82 }

Example response:
    {
        "lat": 18.96,
        "lon": 72.82,
        "flood_probability": 0.823,
        "alert_level": "CRITICAL",
        "window_hours": 24,
        "latest_timestamp": "2026-03-01 11:00:00",
        "features_snapshot": {
            "Precipitation_mm": 42.3,
            "Soil_Moisture": 0.38,
            ...
        }
    }
"""
from __future__ import annotations

import sys
from pathlib import Path

# Ensure project root is on sys.path when running as `uvicorn src.api.app:app`
_PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

from src.api.inference import predict
from src.api.inference_forecast import predict_24h
from src.api.inference_raw import predict_from_raw

# ─────────────────────────────────────────────────────────────────────────────
# App
# ─────────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Flash Flood Risk API",
    description=(
        "Given a geographic coordinate, fetches live hourly weather from Open-Meteo, "
        "engineers 13 hydrological features, and returns a flood risk probability "
        "from a trained LSTM model."
    ),
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# ─────────────────────────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────────────────────────

class PredictRequest(BaseModel):
    lat: float = Field(..., ge=-90,  le=90,  description="Latitude in decimal degrees")
    lon: float = Field(..., ge=-180, le=180, description="Longitude in decimal degrees")


class PredictResponse(BaseModel):
    lat:                float
    lon:                float
    flood_probability:  float = Field(..., description="LSTM sigmoid output in (0, 1) — raw float precision")
    alert_level:        str   = Field(..., description="LOW | MODERATE | HIGH | CRITICAL")
    window_hours:       int   = Field(..., description="Sliding window used (hours)")
    latest_timestamp:   str   = Field(..., description="UTC timestamp of most recent weather row")
    features_snapshot:  dict  = Field(..., description="13 engineered feature values at latest hour")


class ForecastResponse(BaseModel):
    lat:                      float
    lon:                      float
    flood_probability:        float = Field(..., description="Max flood probability across the next 24h")
    alert_level:              str   = Field(..., description="LOW | MODERATE | HIGH | CRITICAL")
    forecast_horizon_hours:   int   = Field(..., description="How many hours ahead this prediction covers")
    based_on_data_until:      str   = Field(..., description="Latest weather timestamp used as input")
    peak_flood_time:          str | None = Field(None, description="Timestamp when flood risk is highest in the next 24h")
    features_snapshot:        dict  = Field(..., description="13 engineered feature values at last forecast hour")
    threshold_used:           float = Field(..., description="F1-optimal decision threshold used to compute alert_level")


class RawPredictRequest(BaseModel):
    precipitation_mm: float = Field(..., ge=0, description="Hourly rainfall in mm (e.g. 25.0)")
    soil_moisture:    float = Field(..., ge=0, le=1, description="Volumetric soil water content 0-1 (e.g. 0.42)")
    temperature_c:    float = Field(..., description="2m air temperature in °C (e.g. 22.5)")
    elevation_m:      float = Field(..., ge=0, description="Terrain elevation in metres (e.g. 50.0)")


class RawPredictResponse(BaseModel):
    flood_probability:   float = Field(..., description="LSTM sigmoid output in (0, 1)")
    alert_level:         str   = Field(..., description="LOW | MODERATE | HIGH | CRITICAL")
    threshold_used:      float = Field(..., description="F1-optimal decision threshold")
    window_hours:        int   = Field(..., description="Sliding window used (hours)")
    input_features:      dict  = Field(..., description="The 4 raw features you provided")
    engineered_features: dict  = Field(..., description="All 13 features after engineering")


# ─────────────────────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/health", tags=["utility"])
def health() -> dict:
    """Liveness probe — confirms the API is running."""
    return {"status": "ok"}


@app.get(
    "/predict",
    response_model=PredictResponse,
    tags=["inference"],
    summary="Predict flood risk for a coordinate (GET)",
)
def predict_get(
    lat: float = Query(..., ge=-90,  le=90,  description="Latitude"),
    lon: float = Query(..., ge=-180, le=180, description="Longitude"),
) -> PredictResponse:
    """Fetch live weather and return flood risk probability for the given coordinate."""
    return _run_predict(lat, lon)


@app.post(
    "/predict",
    response_model=PredictResponse,
    tags=["inference"],
    summary="Predict flood risk for a coordinate (POST)",
)
def predict_post(body: PredictRequest) -> PredictResponse:
    """Same as GET /predict but accepts JSON body — convenient for batch clients."""
    return _run_predict(body.lat, body.lon)


# ─────────────────────────────────────────────────────────────────────────────
# Internal helper
# ─────────────────────────────────────────────────────────────────────────────

def _run_predict(lat: float, lon: float) -> PredictResponse:
    try:
        result = predict(lat, lon)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Inference failed: {exc}") from exc
    return PredictResponse(**result)


@app.get(
    "/forecast",
    response_model=ForecastResponse,
    tags=["inference"],
    summary="Predict flood risk 24 hours from now (GET)",
)
def forecast_get(
    lat: float = Query(..., ge=-90,  le=90,  description="Latitude"),
    lon: float = Query(..., ge=-180, le=180, description="Longitude"),
) -> ForecastResponse:
    """Uses the last 24 h of observed weather to predict flood risk 24 h from now."""
    return _run_forecast(lat, lon)


@app.post(
    "/forecast",
    response_model=ForecastResponse,
    tags=["inference"],
    summary="Predict flood risk 24 hours from now (POST)",
)
def forecast_post(body: PredictRequest) -> ForecastResponse:
    """Same as GET /forecast but accepts JSON body."""
    return _run_forecast(body.lat, body.lon)


def _run_forecast(lat: float, lon: float) -> ForecastResponse:
    try:
        result = predict_24h(lat, lon)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Forecast failed: {exc}") from exc
    return ForecastResponse(**result)


# ─────────────────────────────────────────────────────────────────────────────
# Raw Feature Prediction
# ─────────────────────────────────────────────────────────────────────────────

@app.post(
    "/predict_raw",
    response_model=RawPredictResponse,
    tags=["inference"],
    summary="Predict flood risk from raw feature values (no coordinates needed)",
)
def predict_raw_post(body: RawPredictRequest) -> RawPredictResponse:
    """Provide the 4 base features directly — no weather API call, no lat/lon needed.

    The endpoint engineers the remaining 9 features (rolling sums, lags,
    interaction) automatically and runs the LSTM model.
    """
    return _run_raw_predict(
        body.precipitation_mm,
        body.soil_moisture,
        body.temperature_c,
        body.elevation_m,
    )


@app.get(
    "/predict_raw",
    response_model=RawPredictResponse,
    tags=["inference"],
    summary="Predict flood risk from raw feature values (GET)",
)
def predict_raw_get(
    precipitation_mm: float = Query(..., ge=0,  description="Hourly rainfall in mm"),
    soil_moisture:    float = Query(..., ge=0, le=1, description="Soil water content 0-1"),
    temperature_c:    float = Query(..., description="Temperature in °C"),
    elevation_m:      float = Query(..., ge=0, description="Elevation in metres"),
) -> RawPredictResponse:
    """GET version of /predict_raw — pass features as query parameters."""
    return _run_raw_predict(precipitation_mm, soil_moisture, temperature_c, elevation_m)


def _run_raw_predict(
    precipitation_mm: float,
    soil_moisture: float,
    temperature_c: float,
    elevation_m: float,
) -> RawPredictResponse:
    try:
        result = predict_from_raw(precipitation_mm, soil_moisture, temperature_c, elevation_m)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Raw prediction failed: {exc}") from exc
    return RawPredictResponse(**result)
