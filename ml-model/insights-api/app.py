"""app.py -- SAR Insights API (FastAPI).

Endpoints:
    POST /analyze         Trigger SAR analysis for a region + date
    GET  /runs            List all historical analysis runs
    GET  /runs/{run_id}   Get full detail for a single run
    GET  /health          Liveness probe
"""

import asyncio
import logging
import os
import time
import traceback
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv

load_dotenv()

# -- Local modules --
import database as db
from sar_pipeline import run_sar_analysis, generate_sar_rgb
from cca_segmentation import run_cca
from population import estimate_population_exposure
from image_export import generate_and_upload_sar_image
from ai_insights import generate_flood_insight

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(name)-22s  %(levelname)-5s  %(message)s",
)
log = logging.getLogger("insights.app")

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(
    title="AMBROSIA SAR Insights API",
    description="Sentinel-1 SAR change-detection, flood segmentation, and AI insights",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Schema bootstrap on startup
# ---------------------------------------------------------------------------


@app.on_event("startup")
async def startup():
    try:
        db.ensure_schema()
        log.info("Database schema ready")
    except Exception as e:
        log.warning("Database schema init failed (will retry on first use): %s", e)


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class RegionInput(BaseModel):
    center: Dict[str, float] = Field(..., description="{ lat, lon }")
    bbox: List[float] = Field(..., description="[west, south, east, north]")
    boundary_geojson: Optional[Dict] = None
    display_name: str = ""


class AnalyzeRequest(BaseModel):
    region: RegionInput
    date: Optional[str] = Field(None, description="YYYY-MM-DD analysis date")
    options: Optional[Dict] = None


class AnalyzeResponse(BaseModel):
    run_id: str
    status: str = "queued"


class RunSummary(BaseModel):
    id: str
    location: str
    lat: Optional[float] = None
    lon: Optional[float] = None
    analysis_date: Optional[str] = None
    status: str
    flood_area_km2: Optional[float] = None
    flood_percentage: Optional[float] = None
    mean_db_drop: Optional[float] = None
    population_exposed: Optional[int] = None
    zones_count: Optional[int] = None
    processing_time_s: Optional[float] = None
    created_at: Optional[str] = None
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/health")
async def health():
    return {"status": "ok", "service": "ambrosia-insights-api"}


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(req: AnalyzeRequest, background_tasks: BackgroundTasks):
    """Trigger a new SAR flood analysis.

    Returns immediately with a run_id; processing happens in the background.
    """
    analysis_date = req.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    location = req.region.display_name or "Unknown Region"

    try:
        run_id = db.create_run(
            location=location,
            lat=req.region.center.get("lat", 0),
            lon=req.region.center.get("lon", 0),
            bbox=req.region.bbox,
            analysis_date=analysis_date,
        )
    except Exception as e:
        log.error("Failed to create run: %s", e)
        raise HTTPException(status_code=500, detail=f"Database error: {e}")

    # Run analysis in the background
    background_tasks.add_task(
        _run_analysis,
        run_id=run_id,
        bbox=req.region.bbox,
        analysis_date=analysis_date,
        location=location,
        boundary_geojson=req.region.boundary_geojson,
    )

    return AnalyzeResponse(run_id=run_id, status="queued")


@app.get("/runs")
async def list_runs():
    """List all historical analysis runs."""
    try:
        runs = db.list_runs(limit=100)
        return {"runs": runs}
    except Exception as e:
        log.error("Failed to list runs: %s", e)
        raise HTTPException(status_code=500, detail=f"Database error: {e}")


@app.get("/runs/{run_id}")
async def get_run(run_id: str):
    """Get full detail for a single analysis run."""
    try:
        run = db.get_run(run_id)
    except Exception as e:
        log.error("Failed to get run: %s", e)
        raise HTTPException(status_code=500, detail=f"Database error: {e}")

    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    # If completed, reconstruct the full result shape the frontend expects
    if run.get("status") == "completed":
        result_json = run.get("result_json")
        if isinstance(result_json, str):
            import json
            result_json = json.loads(result_json)

        return {
            "run_id": run["id"],
            "status": "completed",
            "location": run["location"],
            "analysis_date": str(run.get("analysis_date", "")),
            "flood_area_km2": run.get("flood_area_km2"),
            "flood_percentage": run.get("flood_percentage"),
            "mean_db_drop": run.get("mean_db_drop"),
            "population_exposed": run.get("population_exposed"),
            "confidence_avg": run.get("confidence_avg"),
            "zones_count": run.get("zones_count"),
            "sar_image_url": run.get("sar_image_url"),
            "ai_insight": run.get("ai_insight"),
            "processing_time_s": run.get("processing_time_s"),
            "sensor": run.get("sensor"),
            "detector": run.get("detector"),
            "created_at": run.get("created_at"),
            "patches": run.get("patches", []),
            "result": result_json,
        }

    # Still running or failed
    return {
        "run_id": run["id"],
        "status": run["status"],
        "progress": run.get("progress", 0),
        "error": run.get("error"),
    }


# ---------------------------------------------------------------------------
# Background analysis task
# ---------------------------------------------------------------------------

async def _run_analysis(
    run_id: str,
    bbox: List[float],
    analysis_date: str,
    location: str,
    boundary_geojson: Optional[Dict] = None,
):
    """Execute the full SAR pipeline in the background."""
    t0 = time.time()

    try:
        # -- Stage 1: SAR Processing --
        db.update_run_status(run_id, "preprocessing", 10)
        log.info("[%s] Starting SAR analysis for %s on %s", run_id, location, analysis_date)

        sar_result = run_sar_analysis(bbox, analysis_date, boundary_geojson)

        # -- Stage 2: CCA Segmentation --
        db.update_run_status(run_id, "detecting", 40)
        log.info("[%s] Running CCA segmentation", run_id)

        patches = run_cca(
            flood_mask=sar_result["flood_mask"],
            log_ratio=sar_result["log_ratio"],
            transform=sar_result["transform"],
            resolution=sar_result["resolution"],
        )

        # -- Stage 3: Population exposure --
        db.update_run_status(run_id, "scoring", 60)
        log.info("[%s] Estimating population exposure", run_id)

        patches = estimate_population_exposure(patches, bbox)
        total_pop = sum(p.get("population_exposed", 0) for p in patches)

        # -- Stage 4: Generate & upload SAR image --
        db.update_run_status(run_id, "scoring", 75)
        log.info("[%s] Generating SAR image", run_id)

        sar_image_url = generate_and_upload_sar_image(
            sigma_pre=sar_result["sigma_pre"],
            sigma_post=sar_result["sigma_post"],
            flood_mask=sar_result["flood_mask"],
            run_id=run_id,
        )

        # Also try GEE thumbnail as fallback
        if not sar_image_url:
            sar_image_url = generate_sar_rgb(bbox, analysis_date, boundary_geojson) or ""

        # -- Stage 5: AI insight --
        db.update_run_status(run_id, "scoring", 85)
        log.info("[%s] Generating AI insight", run_id)

        top_patches_text = "; ".join(
            f"{p['zone_id']}: {p['area_km2']:.2f}km2 ({p['severity']})"
            for p in patches[:5]
        )

        # Compute summary statistics
        flood_area_km2 = sum(p["area_km2"] for p in patches)
        total_area = _bbox_area_approx(bbox)
        flood_percentage = (flood_area_km2 / max(total_area, 0.01)) * 100
        mean_db_drop = float(sar_result["mean_db_drop"])
        confidence_avg = float(np.mean([p["confidence"] for p in patches])) if patches else 0.0

        ai_insight = generate_flood_insight(
            location=location,
            analysis_date=analysis_date,
            flood_area_km2=flood_area_km2,
            flood_percentage=flood_percentage,
            population_exposed=total_pop,
            zones_count=len(patches),
            mean_db_drop=mean_db_drop,
            patches_summary=top_patches_text,
        )

        # -- Build result JSON (matches frontend contract) --
        flood_zones_features = []
        for p in patches:
            flood_zones_features.append({
                "type": "Feature",
                "properties": {
                    "zone_id": p["zone_id"],
                    "severity": p["severity"],
                    "area_km2": p["area_km2"],
                    "avg_depth_m": p["avg_depth_m"],
                    "max_depth_m": p["max_depth_m"],
                    "population_exposed": p["population_exposed"],
                    "confidence": p["confidence"],
                    "bbox": p["bbox"],
                    "centroid": p["centroid"],
                    "admin_name": p.get("admin_name", ""),
                },
                "geometry": p["geometry"],
            })

        result_json = {
            "summary": {
                "total_flood_area_km2": round(flood_area_km2, 2),
                "avg_depth_m": round(float(np.mean([p["avg_depth_m"] for p in patches])) if patches else 0, 2),
                "max_depth_m": round(float(max(p["max_depth_m"] for p in patches)) if patches else 0, 2),
                "population_exposed": total_pop,
                "confidence_avg": round(confidence_avg, 3),
                "zones_count": len(patches),
                "region_name": location,
                "scene_id": sar_result["scene_id"],
                "sensor": "S1_GRD",
                "detector": "sar_logratio",
            },
            "flood_zones": {
                "type": "FeatureCollection",
                "features": flood_zones_features,
            },
        }

        processing_time = time.time() - t0

        # -- Save to database --
        db.save_results(
            run_id=run_id,
            flood_area_km2=flood_area_km2,
            flood_percentage=flood_percentage,
            mean_db_drop=mean_db_drop,
            population_exposed=total_pop,
            confidence_avg=confidence_avg,
            zones_count=len(patches),
            sar_image_url=sar_image_url or "",
            ai_insight=ai_insight,
            result_json=result_json,
            processing_time_s=processing_time,
            patches=[
                {**p, "centroid": p["centroid"]}
                for p in patches
            ],
        )

        log.info(
            "[%s] Analysis complete: %.2f km2 flooded, %d zones, %d pop exposed (%.1fs)",
            run_id, flood_area_km2, len(patches), total_pop, processing_time,
        )

    except Exception as e:
        log.error("[%s] Analysis failed: %s\n%s", run_id, e, traceback.format_exc())
        try:
            db.update_run_status(run_id, "failed", error=str(e))
        except Exception:
            pass


def _bbox_area_approx(bbox: List[float]) -> float:
    """Approximate area of a bbox in km²."""
    import math
    west, south, east, north = bbox
    lat_mid = (south + north) / 2.0
    width_km = abs(east - west) * 111.32 * math.cos(math.radians(lat_mid))
    height_km = abs(north - south) * 110.574
    return width_km * height_km


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 7860))
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=True, log_level="info")
