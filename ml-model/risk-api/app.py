"""app.py -- Enhanced Risk API matching Ambrosia architecture."""

import logging
import os
import time
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv

load_dotenv()

from data_sources import init_gee, get_population, get_rainfall, get_land_cover_stats
from districts import find_districts
from criticality import calculate_risk_score

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

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class Point(BaseModel):
    lat: float
    lon: float

class RegionInput(BaseModel):
    center: Point
    bbox: List[float] = Field(..., description="[west, south, east, north]")
    boundary_geojson: Optional[Dict] = None
    display_name: str = ""

class CheckRequest(BaseModel):
    region: RegionInput

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

# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {"status": "ok", "service": "ambrosia-risk-api"}

@app.post("/analyze/risk")
async def analyze_risk(req: CheckRequest):
    """
    Analyze risk for districts within the provided bounding box.
    Returns population, hazard scores, and risk classifications per district.

    Response shape matches what the frontend riskStore / RiskDashboardPanel expect:
      {
        "district_summaries": [ { district_name, risk_score, ... }, ... ],
        "enhanced_risk_modeling": { population_metrics, hydrological_metrics, ... }
      }
    """
    try:
        init_gee()
    except Exception as e:
        log.error("GEE Init failed: %s", e)
        raise HTTPException(status_code=500, detail="GEE Authentication failed. Check GEE_PROJECT env var.")

    t0 = time.time()

    # 1. Find districts in AOI
    districts = find_districts(req.region.bbox)
    log.info("Found %d districts in AOI", len(districts))

    summaries: List[DistrictSummary] = []

    for d in districts:
        try:
            geom = d["ee_geom"]

            # 2. Fetch data sources for this district
            pop = get_population(geom)
            rain = get_rainfall(geom, days_back=30)
            land = get_land_cover_stats(geom)

            # 3. Calculate criticality
            score, cls, factors = calculate_risk_score(
                population=pop,
                rainfall_mm=rain,
                land_cover=land,
            )

            summaries.append(DistrictSummary(
                name=d["name"],
                bbox=d["bbox"],
                center=Point(**d["center"]),
                population=pop,
                area_km2=round(d["area_km2"], 1),
                risk_score=score,
                risk_classification=cls,
                risk_factors=factors,
                rainfall_mm=round(rain, 1),
                urban_pct=round(land.get("urban", 0) * 100, 1),
            ))

        except Exception as e:
            log.warning("Failed to process district %s: %s", d["name"], e)

    # Sort by risk score descending
    summaries.sort(key=lambda s: s.risk_score, reverse=True)

    processing_time = time.time() - t0
    log.info("Risk analysis completed in %.1f seconds", processing_time)

    # -----------------------------------------------------------------
    # Build response matching frontend contract
    # -----------------------------------------------------------------

    # district_summaries — snake_case array with district_name & contributing_factors
    district_summaries = []
    for s in summaries:
        district_summaries.append({
            "district_name": s.name,
            "bbox": s.bbox,
            "center": {"lat": s.center.lat, "lon": s.center.lon},
            "population": s.population,
            "area_km2": s.area_km2,
            "risk_score": s.risk_score,
            "risk_classification": s.risk_classification,
            "contributing_factors": s.risk_factors,
            "rainfall_mm": s.rainfall_mm,
            "urban_pct": s.urban_pct,
        })

    # Aggregate metrics for the enhanced_risk_modeling block
    total_pop = sum(s.population for s in summaries)
    total_area = sum(s.area_km2 for s in summaries)
    avg_rainfall = (
        sum(s.rainfall_mm for s in summaries) / len(summaries)
        if summaries
        else 0.0
    )
    max_score = max((s.risk_score for s in summaries), default=0)
    top_classification = summaries[0].risk_classification if summaries else "LOW"

    # Confidence heuristic: more districts analysed → more confidence
    confidence_level = (
        "High" if len(summaries) >= 5
        else "Medium" if len(summaries) >= 2
        else "Low"
    )

    enhanced_risk_modeling = {
        "population_metrics": {
            "total_population": total_pop,
            "districts_analyzed": len(summaries),
        },
        "hydrological_metrics": {
            "accumulated_rainfall_mm": round(avg_rainfall, 2),
        },
        "risk_assessment": {
            "composite_risk_score": max_score,
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
