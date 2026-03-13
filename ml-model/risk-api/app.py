"""app.py -- Enhanced Risk API with fused OmniFlood criticality scoring."""

from __future__ import annotations

import logging
import os
import sys
import time
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

load_dotenv()

from criticality import calculate_criticality_index
from data_sources import get_land_cover_stats, get_population, get_rainfall, init_gee
from districts import find_districts

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("risk.app")

app = FastAPI(title="AMBROSIA Enhanced Risk API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Point(BaseModel):
    lat: float
    lon: float


class InfrastructureAreaInput(BaseModel):
    area_name: str
    critical_assets_exposed: int = 0
    facilities_cut_off: int = 0
    road_access_disruption_index: Optional[float] = Field(default=None, ge=0, le=1)
    score_override: Optional[float] = Field(default=None, ge=0, le=100)


class RegionInput(BaseModel):
    center: Point
    bbox: List[float] = Field(..., description="[west, south, east, north]")
    boundary_geojson: Optional[Dict] = None
    display_name: str = ""


class CheckRequest(BaseModel):
    region: RegionInput
    forecast_days: int = Field(5, ge=1, le=16)
    infrastructure_overrides: Optional[List[InfrastructureAreaInput]] = None


class DistrictSummary(BaseModel):
    name: str
    bbox: List[float]
    center: Point
    population: int
    area_km2: float
    risk_score: int
    risk_classification: str
    risk_factors: List[str]
    rainfall_mm: float
    urban_pct: float
    fused_factors: List[Dict[str, Any]]
    component_scores: Dict[str, Any]
    forecast_summary: Dict[str, Any]
    detection_summary: Dict[str, Any]
    infrastructure_summary: Dict[str, Any]


@app.get("/health")
async def health():
    return {"status": "ok", "service": "ambrosia-risk-api"}


def _normalize_name(name: str) -> str:
    return "".join(ch.lower() for ch in name if ch.isalnum())


def _bbox_overlap_ratio(a: List[float], b: List[float]) -> float:
    a_w, a_s, a_e, a_n = a
    b_w, b_s, b_e, b_n = b
    inter_w = max(a_w, b_w)
    inter_s = max(a_s, b_s)
    inter_e = min(a_e, b_e)
    inter_n = min(a_n, b_n)
    if inter_w >= inter_e or inter_s >= inter_n:
        return 0.0

    inter_area = (inter_e - inter_w) * (inter_n - inter_s)
    a_area = max((a_e - a_w) * (a_n - a_s), 1e-9)
    b_area = max((b_e - b_w) * (b_n - b_s), 1e-9)
    union_area = a_area + b_area - inter_area
    return max(0.0, min(1.0, inter_area / union_area))


@lru_cache(maxsize=1)
def _get_forecast_predictor():
    forecast_root = Path(__file__).resolve().parents[1] / "Forecasting_Model"
    if str(forecast_root) not in sys.path:
        sys.path.insert(0, str(forecast_root))

    from src.api.inference_multiday import predict_multiday  # type: ignore

    return predict_multiday


def _get_forecast_signal(center: Dict[str, float], forecast_days: int) -> Dict[str, Any]:
    try:
        predictor = _get_forecast_predictor()
        result = predictor(center["lat"], center["lon"], forecast_days)
        result["available"] = True
        return result
    except Exception as exc:
        log.warning(
            "Forecast fetch failed for lat=%s lon=%s: %s",
            center["lat"],
            center["lon"],
            exc,
        )
        return {
            "available": False,
            "error": str(exc),
            "daily_forecasts": [],
            "overall_max_prob": 0.0,
            "overall_alert_level": "LOW",
            "peak_day": 0,
            "peak_date": None,
        }


def _get_latest_detection_signal(district_bbox: List[float]) -> Dict[str, Any]:
    database_url = os.getenv("DATABASE_URL", "")
    if not database_url:
        return {"available": False, "reason": "DATABASE_URL not configured"}

    try:
        import psycopg2
        import psycopg2.extras
    except Exception as exc:
        return {"available": False, "reason": f"psycopg2 unavailable: {exc}"}

    try:
        with psycopg2.connect(database_url, cursor_factory=psycopg2.extras.RealDictCursor) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, location, bbox, analysis_date, created_at,
                           flood_percentage, mean_db_drop, population_exposed,
                           confidence_avg, zones_count
                    FROM runs
                    WHERE status = 'completed'
                      AND bbox IS NOT NULL
                    ORDER BY created_at DESC
                    LIMIT 25
                    """
                )
                best_match: Optional[Dict[str, Any]] = None
                best_overlap = 0.0
                for row in cur.fetchall():
                    row = dict(row)
                    run_bbox = list(row.get("bbox") or [])
                    if len(run_bbox) != 4:
                        continue
                    overlap = _bbox_overlap_ratio(district_bbox, run_bbox)
                    if overlap > best_overlap:
                        best_overlap = overlap
                        best_match = row

                if not best_match or best_overlap <= 0.0:
                    return {"available": False, "reason": "No overlapping completed SAR run found"}

                return {
                    "available": True,
                    "run_id": str(best_match.get("id")),
                    "location": best_match.get("location"),
                    "analysis_date": str(best_match.get("analysis_date") or ""),
                    "created_at": str(best_match.get("created_at") or ""),
                    "flood_percentage": float(best_match.get("flood_percentage") or 0.0),
                    "mean_db_drop": float(best_match.get("mean_db_drop") or 0.0),
                    "population_exposed": int(best_match.get("population_exposed") or 0),
                    "confidence_avg": float(best_match.get("confidence_avg") or 0.0),
                    "zones_count": int(best_match.get("zones_count") or 0),
                    "bbox_overlap_ratio": round(best_overlap, 3),
                }
    except Exception as exc:
        log.warning("SAR lookup failed: %s", exc)
        return {"available": False, "reason": str(exc)}


def _build_infrastructure_map(
    overrides: Optional[List[InfrastructureAreaInput]],
) -> Dict[str, Dict[str, Any]]:
    if not overrides:
        return {}
    return {
        _normalize_name(item.area_name): item.dict()
        for item in overrides
    }


@app.post("/analyze/risk")
async def analyze_risk(req: CheckRequest):
    """
    Analyze districts within the provided bounding box and return a fused
    operational score that combines detection, forecast, and exposure layers.
    """
    try:
        init_gee()
    except Exception as exc:
        log.error("GEE Init failed: %s", exc)
        raise HTTPException(status_code=500, detail="GEE Authentication failed. Check GEE_PROJECT env var.")

    t0 = time.time()
    districts = find_districts(req.region.bbox)
    log.info("Found %d districts in AOI", len(districts))

    infrastructure_map = _build_infrastructure_map(req.infrastructure_overrides)
    summaries: List[DistrictSummary] = []

    for district in districts:
        try:
            geom = district["ee_geom"]
            pop = get_population(geom)
            rain = get_rainfall(geom, days_back=30)
            land = get_land_cover_stats(geom)
            forecast_signal = _get_forecast_signal(district["center"], req.forecast_days)
            detection_signal = _get_latest_detection_signal(district["bbox"])
            infrastructure_signal = infrastructure_map.get(_normalize_name(district["name"]))

            fused = calculate_criticality_index(
                population=pop,
                rainfall_mm=rain,
                land_cover=land,
                detection_signal=detection_signal,
                forecast_signal=forecast_signal,
                infrastructure_signal=infrastructure_signal,
            )

            summaries.append(
                DistrictSummary(
                    name=district["name"],
                    bbox=district["bbox"],
                    center=Point(**district["center"]),
                    population=pop,
                    area_km2=round(district["area_km2"], 1),
                    risk_score=fused["score"],
                    risk_classification=fused["classification"],
                    risk_factors=fused["reasons"],
                    rainfall_mm=round(rain, 1),
                    urban_pct=round(land.get("urban", 0) * 100, 1),
                    fused_factors=fused["factors"],
                    component_scores=fused["component_scores"],
                    forecast_summary=fused["signals"]["forecast"],
                    detection_summary=fused["signals"]["detection"],
                    infrastructure_summary=fused["signals"]["infrastructure"],
                )
            )
        except Exception as exc:
            log.warning("Failed to process district %s: %s", district.get("name", "unknown"), exc)

    summaries.sort(key=lambda summary: summary.risk_score, reverse=True)
    processing_time = time.time() - t0
    log.info("Risk analysis completed in %.1f seconds", processing_time)

    district_summaries = [
        {
            "district_name": summary.name,
            "bbox": summary.bbox,
            "center": {"lat": summary.center.lat, "lon": summary.center.lon},
            "population": summary.population,
            "area_km2": summary.area_km2,
            "risk_score": summary.risk_score,
            "operational_score": summary.risk_score,
            "risk_classification": summary.risk_classification,
            "operational_classification": summary.risk_classification,
            "contributing_factors": summary.risk_factors,
            "fused_factors": summary.fused_factors,
            "component_scores": summary.component_scores,
            "forecast_summary": summary.forecast_summary,
            "detection_summary": summary.detection_summary,
            "infrastructure_summary": summary.infrastructure_summary,
            "rainfall_mm": summary.rainfall_mm,
            "urban_pct": summary.urban_pct,
        }
        for summary in summaries
    ]

    total_pop = sum(summary.population for summary in summaries)
    total_area = sum(summary.area_km2 for summary in summaries)
    avg_rainfall = (
        sum(summary.rainfall_mm for summary in summaries) / len(summaries)
        if summaries else 0.0
    )
    max_score = max((summary.risk_score for summary in summaries), default=0)
    top_classification = summaries[0].risk_classification if summaries else "LOW"
    avg_hazard = (
        sum(float(summary.component_scores.get("hazard", 0.0)) for summary in summaries) / len(summaries)
        if summaries else 0.0
    )
    avg_exposure = (
        sum(float(summary.component_scores.get("exposure", 0.0)) for summary in summaries) / len(summaries)
        if summaries else 0.0
    )
    forecast_coverage = sum(
        1 for summary in summaries
        if summary.forecast_summary and not summary.forecast_summary.get("fallback")
    )
    detection_coverage = sum(
        1 for summary in summaries
        if summary.detection_summary and summary.detection_summary.get("analysis_date")
    )

    confidence_level = (
        "High" if forecast_coverage == len(summaries) and detection_coverage >= max(1, len(summaries) // 2)
        else "Medium" if summaries
        else "Low"
    )

    enhanced_risk_modeling = {
        "population_metrics": {
            "total_population": total_pop,
            "districts_analyzed": len(summaries),
        },
        "hydrological_metrics": {
            "accumulated_rainfall_mm": round(avg_rainfall, 2),
            "average_hazard_score": round(avg_hazard, 2),
        },
        "exposure_metrics": {
            "average_exposure_score": round(avg_exposure, 2),
            "forecast_coverage_districts": forecast_coverage,
            "detection_coverage_districts": detection_coverage,
        },
        "risk_assessment": {
            "composite_risk_score": max_score,
            "operational_index": max_score,
            "risk_classification": top_classification,
        },
        "confidence_metrics": {
            "confidence_level": confidence_level,
        },
        "affected_area_statistics": {
            "area_km2": round(total_area, 1),
        },
        "processing_time_s": round(processing_time, 2),
    }

    return {
        "district_summaries": district_summaries,
        "enhanced_risk_modeling": enhanced_risk_modeling,
    }


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", 7860))
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=True, log_level="info")
