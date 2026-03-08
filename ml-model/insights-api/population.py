"""population.py -- WorldPop population exposure via Google Earth Engine.

For each flood patch polygon, sums population pixels (100m resolution)
to estimate the number of people exposed.
"""

import logging
from typing import Any, Dict, List

import ee
from sar_pipeline import init_gee

log = logging.getLogger("insights.population")


def estimate_population_exposure(
    patches: List[Dict[str, Any]],
    bbox: List[float],
) -> List[Dict[str, Any]]:
    """Add `population_exposed` to each patch using WorldPop via GEE.

    Parameters
    ----------
    patches : List of patch dicts from CCA (must have 'geometry' key)
    bbox : [west, south, east, north] of the full AOI

    Returns
    -------
    Same patches list with updated `population_exposed` values
    """
    init_gee()

    # WorldPop Global Population, 100m resolution
    # Dataset: WorldPop/GP/100m/pop (most recent year available)
    try:
        worldpop = ee.ImageCollection("WorldPop/GP/100m/pop").sort(
            "system:time_start", False
        ).first()
    except Exception:
        log.warning("WorldPop dataset not available, using fallback estimate")
        return _fallback_population(patches, bbox)

    total_pop = 0

    for patch in patches:
        try:
            geom = ee.Geometry(patch["geometry"])

            # Sum population within the patch polygon
            stats = worldpop.reduceRegion(
                reducer=ee.Reducer.sum(),
                geometry=geom,
                scale=100,
                bestEffort=True,
            ).getInfo()

            pop = int(stats.get("population", 0) or 0)
            patch["population_exposed"] = pop
            total_pop += pop

        except Exception as e:
            log.warning("Population estimation failed for %s: %s", patch["zone_id"], e)
            # Fallback: estimate from area (rough global average ~50 people/km²)
            patch["population_exposed"] = int(patch["area_km2"] * 50)
            total_pop += patch["population_exposed"]

    log.info("Total population exposed: %d across %d patches", total_pop, len(patches))
    return patches


def get_total_population(bbox: List[float]) -> int:
    """Get total population within a bounding box."""
    init_gee()

    try:
        worldpop = ee.ImageCollection("WorldPop/GP/100m/pop").sort(
            "system:time_start", False
        ).first()

        west, south, east, north = bbox
        aoi = ee.Geometry.Rectangle([west, south, east, north])

        stats = worldpop.reduceRegion(
            reducer=ee.Reducer.sum(),
            geometry=aoi,
            scale=100,
            bestEffort=True,
        ).getInfo()

        return int(stats.get("population", 0) or 0)
    except Exception as e:
        log.warning("Total population estimation failed: %s", e)
        return 0


def _fallback_population(patches: List[Dict], bbox: List[float]) -> List[Dict]:
    """Rough population estimate when GEE WorldPop is unavailable."""
    for patch in patches:
        # Global average is ~60 people/km², urban can be 5000+
        # Use a moderate estimate of ~200 people/km² for flood-prone areas
        patch["population_exposed"] = int(patch["area_km2"] * 200)
    return patches
