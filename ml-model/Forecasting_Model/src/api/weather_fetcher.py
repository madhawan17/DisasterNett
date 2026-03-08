"""Fetch recent hourly weather from Open-Meteo — mirrors dataset_gen.py exactly.

Two fetchers:
  fetch_hourly()           — archive API, past ~5 days  (nowcast /predict)
  fetch_forecast_window()  — forecast API, past 24h + next 24h (forecast /forecast)

Training used archive-api.open-meteo.com/v1/archive (ERA5-Land).
The forecast API (api.open-meteo.com/v1/forecast) uses the GFS/IFS model but
exposes the same hourly variables with the same names, so the same feature
engineering pipeline applies without modification.

We pull 24h of recent history (past_hours=24) so that lag features
(Soil_lag3, Rain_12h, etc.) at the start of the forecast window are grounded
in real observed data rather than zero-padded.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import httpx
import pandas as pd

ARCHIVE_URL     = "https://archive-api.open-meteo.com/v1/archive"
FORECAST_URL    = "https://api.open-meteo.com/v1/forecast"
ELEVATION_URL   = "https://api.open-meteo.com/v1/elevation"
PAST_DAYS       = 5          # request 5 days; archive lags ~1-2 days, ~72-96 h will survive
REQUEST_TIMEOUT = 30         # seconds


def fetch_hourly(lat: float, lon: float) -> pd.DataFrame:
    """Return a DataFrame of recent hourly weather at (lat, lon).

    Column names exactly match the training CSV produced by dataset_gen.py:
        Timestamp, Precipitation_mm, Soil_Moisture, Temperature_C, Elevation_m

    Rows are sorted by Timestamp ascending.

    Raises:
        httpx.HTTPStatusError: non-2xx response from either API.
        ValueError: response missing expected fields, or too few valid rows.
    """
    # ── 1. Elevation (same separate call as dataset_gen.py) ───────────────────
    elev_resp = httpx.get(
        ELEVATION_URL,
        params={"latitude": lat, "longitude": lon},
        timeout=REQUEST_TIMEOUT,
    )
    elev_resp.raise_for_status()
    elevation = float(elev_resp.json().get("elevation", [0])[0])

    # ── 2. Hourly weather via archive API (same endpoint as dataset_gen.py) ───
    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=PAST_DAYS)
    end   = today   # archive silently truncates to its latest available day

    weather_resp = httpx.get(
        ARCHIVE_URL,
        params={
            "latitude":   lat,
            "longitude":  lon,
            "start_date": str(start),
            "end_date":   str(end),
            "hourly":     "precipitation,soil_moisture_0_to_7cm,temperature_2m",
            "timezone":   "GMT",
        },
        timeout=REQUEST_TIMEOUT,
    )
    weather_resp.raise_for_status()
    data = weather_resp.json()

    # ── 3. Validate response shape ────────────────────────────────────────────
    if "hourly" not in data:
        raise ValueError(f"Open-Meteo archive response missing 'hourly' key: {list(data)}")

    hourly  = data["hourly"]
    missing = {"time", "precipitation", "soil_moisture_0_to_7cm", "temperature_2m"} - set(hourly)
    if missing:
        raise ValueError(f"Open-Meteo archive missing variables: {missing}")

    # ── 4. Build DataFrame — column names match dataset_gen.py exactly ────────
    df = pd.DataFrame({
        "Timestamp":        pd.to_datetime(hourly["time"]),
        "Precipitation_mm": hourly["precipitation"],
        "Soil_Moisture":    hourly["soil_moisture_0_to_7cm"],
        "Temperature_C":    hourly["temperature_2m"],
    })
    df["Elevation_m"] = elevation
    df = df.sort_values("Timestamp").reset_index(drop=True)

    # ── 5. Fill soil moisture gaps ────────────────────────────────────────────
    # Soil moisture is often sparse in the archive (dataset_gen.py uses dropna
    # which discards those rows from the training set, but we need a contiguous
    # window for inference so we forward/back fill instead).
    df["Soil_Moisture"] = (
        df["Soil_Moisture"]
        .astype("float64")
        .ffill()
        .bfill()
        .fillna(0.2)          # last resort: ~dry soil default
    )

    # Drop rows where core met variables are still null
    df = df.dropna(subset=["Temperature_C", "Precipitation_mm"])
    df = df.reset_index(drop=True)

    if len(df) < 55:
        raise ValueError(
            f"Only {len(df)} valid hourly rows returned for ({lat}, {lon}). "
            f"Need at least 55 (48h window + 7h warm-up buffer). "
            f"The archive may not have data for this date range at this location."
        )

    return df


def _fetch_archive_soil_moisture(lat: float, lon: float) -> float:
    """Return the most recent non-null soil moisture from the ERA5-Land archive.

    Used as a fallback when the forecast API returns all-null soil moisture
    (common outside Europe). Returns 0.2 if the archive also fails.
    """
    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=5)
    try:
        resp = httpx.get(
            ARCHIVE_URL,
            params={
                "latitude":   lat,
                "longitude":  lon,
                "start_date": str(start),
                "end_date":   str(today),
                "hourly":     "soil_moisture_0_to_7cm",
                "timezone":   "GMT",
            },
            timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        values = resp.json().get("hourly", {}).get("soil_moisture_0_to_7cm", [])
        non_null = [v for v in values if v is not None]
        return float(non_null[-1]) if non_null else 0.2
    except Exception:
        return 0.2


def fetch_forecast_window(lat: float, lon: float, past_hours: int = 24, forecast_hours: int = 24) -> pd.DataFrame:
    """Return a DataFrame of past + future hourly weather at (lat, lon).

    Uses the Open-Meteo FORECAST API which provides:
      - past_hours  : observed ERA5-Land reanalysis (same source as training)
      - forecast_hours: NWP model forecast (GFS/IFS)

    Returns a DataFrame with an extra boolean column ``is_forecast`` that is
    True for future rows (timestamp > now) and False for historical rows.

    Column names are identical to fetch_hourly() so the same feature
    engineering pipeline applies.

    Raises:
        httpx.HTTPStatusError: non-2xx API response.
        ValueError: missing fields or too few rows.
    """
    # ── 1. Elevation ──────────────────────────────────────────────────────────
    elev_resp = httpx.get(
        ELEVATION_URL,
        params={"latitude": lat, "longitude": lon},
        timeout=REQUEST_TIMEOUT,
    )
    elev_resp.raise_for_status()
    elevation = float(elev_resp.json().get("elevation", [0])[0])

    # ── 2. Forecast API (past + future in one call) ───────────────────────────
    resp = httpx.get(
        FORECAST_URL,
        params={
            "latitude":       lat,
            "longitude":      lon,
            "hourly":         "precipitation,soil_moisture_0_to_7cm,temperature_2m",
            "past_hours":     past_hours,
            "forecast_hours": forecast_hours,
            "timezone":       "GMT",
        },
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    data = resp.json()

    if "hourly" not in data:
        raise ValueError(f"Open-Meteo forecast response missing 'hourly': {list(data)}")

    hourly  = data["hourly"]
    missing = {"time", "precipitation", "soil_moisture_0_to_7cm", "temperature_2m"} - set(hourly)
    if missing:
        raise ValueError(f"Open-Meteo forecast missing variables: {missing}")

    # ── 3. Build DataFrame ────────────────────────────────────────────────────
    timestamps = pd.to_datetime(hourly["time"], utc=True)
    # Floor to the current hour so the current hour is included in 'forecast'
    # (strict > would exclude it when the API timestamp == now exactly).
    now_floor  = pd.Timestamp.now(tz="UTC").floor("h")

    df = pd.DataFrame({
        "Timestamp":        timestamps,
        "Precipitation_mm": hourly["precipitation"],
        "Soil_Moisture":    hourly["soil_moisture_0_to_7cm"],
        "Temperature_C":    hourly["temperature_2m"],
        "is_forecast":      timestamps >= now_floor,
    })
    df["Elevation_m"] = elevation
    df = df.sort_values("Timestamp").reset_index(drop=True)

    # ── 4. Fill gaps ──────────────────────────────────────────────────────────
    # The forecast API only carries soil_moisture for Europe.
    # For all other regions it returns all-nulls. When that happens, fall back
    # to the archive API (ERA5-Land, global coverage) to get the most recent
    # real soil moisture value and use it as a constant fill.
    sm_series = pd.to_numeric(df["Soil_Moisture"], errors="coerce")
    if sm_series.isna().all():
        archive_sm = _fetch_archive_soil_moisture(lat, lon)
        sm_series  = sm_series.fillna(archive_sm)
        print(
            f"[weather] Forecast API has no soil moisture for ({lat}, {lon}); "
            f"using archive value {archive_sm:.4f}"
        )

    df["Soil_Moisture"] = sm_series.ffill().bfill().fillna(0.2)
    df["Precipitation_mm"] = pd.to_numeric(df["Precipitation_mm"], errors="coerce").fillna(0.0)
    df = df.dropna(subset=["Temperature_C"]).reset_index(drop=True)

    n_hist     = int((~df["is_forecast"]).sum())
    n_forecast = int(df["is_forecast"].sum())
    if n_forecast < forecast_hours - 1:
        raise ValueError(
            f"Forecast API returned only {n_forecast} future rows for ({lat}, {lon}); "
            f"expected at least {forecast_hours - 1}."
        )
    if n_hist < 12:
        raise ValueError(
            f"Only {n_hist} historical rows returned for ({lat}, {lon}); "
            f"need at least 12 for lag-feature warm-up."
        )

    return df
