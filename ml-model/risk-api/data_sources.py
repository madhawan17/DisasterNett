"""data_sources.py -- GEE data integrations (WorldPop, CHIRPS, ESA WorldCover)."""

import os
import logging
from datetime import datetime, timedelta
from typing import Dict

import ee
from dotenv import load_dotenv

load_dotenv()
log = logging.getLogger("risk.data")

_gee_initialized = False


def init_gee():
    global _gee_initialized
    if _gee_initialized:
        return

    project = os.getenv("GEE_PROJECT", "")
    sa_key = os.getenv("GEE_SERVICE_ACCOUNT_KEY", "")

    try:
        if sa_key and os.path.isfile(sa_key):
            credentials = ee.ServiceAccountCredentials(None, sa_key)
            ee.Initialize(credentials, project=project)
        elif project:
            ee.Initialize(project=project)
        else:
            ee.Initialize()
        _gee_initialized = True
        log.info("GEE initialized for Risk API")
    except Exception as e:
        log.error("GEE initialization failed: %s", e)
        raise


def get_population(geom: ee.Geometry) -> int:
    """Sum population within geometry using WorldPop (100m)."""
    try:
        worldpop = ee.ImageCollection("WorldPop/GP/100m/pop").sort(
            "system:time_start", False
        ).first()

        stats = worldpop.reduceRegion(
            reducer=ee.Reducer.sum(),
            geometry=geom,
            scale=100,
            bestEffort=True,
            maxPixels=1e9
        ).getInfo()

        return int(stats.get("population", 0) or 0)
    except Exception as e:
        log.warning("WorldPop failed: %s", e)
        return 0


def get_rainfall(geom: ee.Geometry, days_back: int = 30) -> float:
    """Aggregate rainfall (mm) over the last N days using CHIRPS."""
    try:
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days_back)
        
        chirps = ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY").filterDate(
            start_date.strftime("%Y-%m-%d"),
            end_date.strftime("%Y-%m-%d")
        )
        
        # Sum rainfall over the period
        total_precip = chirps.sum()
        
        # Average over the geometry
        stats = total_precip.reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=geom,
            scale=5566,  # CHIRPS native is ~5.5km
            bestEffort=True,
            maxPixels=1e9
        ).getInfo()

        return float(stats.get("precipitation", 0.0) or 0.0)
    except Exception as e:
        log.warning("CHIRPS rainfall failed: %s", e)
        return 0.0


def get_land_cover_stats(geom: ee.Geometry) -> Dict[str, float]:
    """Get land use percentages using ESA WorldCover (10m)."""
    try:
        # 10=Tree cover, 20=Shrubland, 30=Grassland, 40=Cropland, 50=Built-up, 
        # 60=Bare/sparse, 70=Snow/ice, 80=Permanent water bodies, 90=Herbaceous wetland, 95=Mangroves, 100=Moss/lichen
        worldcover = ee.ImageCollection("ESA/WorldCover/v200").first()
        
        # Calculate pixel counts for each class
        hist = worldcover.reduceRegion(
            reducer=ee.Reducer.frequencyHistogram(),
            geometry=geom,
            scale=100,  # Downsample for speed
            bestEffort=True,
            maxPixels=1e9
        ).getInfo()
        
        counts = hist.get("Map", {})
        total = sum(counts.values()) if counts else 0
        
        if total == 0:
            return {"urban": 0.0, "water": 0.0, "forest": 0.0, "crop": 0.0}

        def get_pct(classes):
            return sum(counts.get(str(c), 0) for c in classes) / total

        return {
            "urban": get_pct([50]),            # Built-up
            "water": get_pct([80, 90, 95]),    # Water + wetlands
            "forest": get_pct([10, 20]),       # Trees + shrubs
            "crop": get_pct([40]),             # Cropland
        }
    except Exception as e:
        log.warning("ESA WorldCover failed: %s", e)
        return {"urban": 0.2, "water": 0.1, "forest": 0.3, "crop": 0.4}  # Fallback
