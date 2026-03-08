"""cca_segmentation.py -- Connected Component Analysis for flood patch delineation.

Takes a binary flood mask (NumPy array) and produces a list of
individually labelled flood patches with:
 - Polygon boundary (GeoJSON)
 - Centroid (lat/lon)
 - Area (km²)
 - Bounding box [west, south, east, north]
 - Depth proxy from mean SAR backscatter difference
 - Severity classification
"""

import math
import logging
from typing import Any, Dict, List, Tuple

import numpy as np
from scipy import ndimage
from shapely.geometry import shape, mapping, MultiPolygon
from shapely.ops import unary_union

log = logging.getLogger("insights.cca")

# Minimum patch area in km² — patches smaller than this are noise
MIN_PATCH_AREA_KM2 = 0.01


# ---------------------------------------------------------------------------
# Severity classification
# ---------------------------------------------------------------------------

def classify_severity(area_km2: float, avg_depth_m: float) -> str:
    """Assign severity based on area and depth proxy.

    - critical : area > 10 km² OR depth > 2 m
    - high     : area > 5 km² OR depth > 1 m
    - medium   : area > 1 km²
    - low      : everything else
    """
    if area_km2 > 10 or avg_depth_m > 2.0:
        return "critical"
    if area_km2 > 5 or avg_depth_m > 1.0:
        return "high"
    if area_km2 > 1:
        return "medium"
    return "low"


# ---------------------------------------------------------------------------
# Depth proxy from SAR backscatter
# ---------------------------------------------------------------------------

def _db_drop_to_depth(db_drop: float) -> float:
    """Convert dB drop to an approximate flood depth in metres.

    This is a rough empirical proxy:
      depth ≈ |dB_drop| × 0.3
    Based on literature relating SAR backscatter attenuation to water depth.
    """
    return abs(db_drop) * 0.3


# ---------------------------------------------------------------------------
# Raster -> Polygon vectorization
# ---------------------------------------------------------------------------

def _pixel_to_coords(
    row: int, col: int, transform: Dict[str, float]
) -> Tuple[float, float]:
    """Convert pixel (row, col) to (lon, lat) using the geo-transform."""
    lon = transform["west"] + col * transform["pixel_size_x"]
    lat = transform["north"] - row * transform["pixel_size_y"]
    return lon, lat


def _patch_to_polygon(
    mask: np.ndarray, label_id: int, labels: np.ndarray, transform: Dict
) -> List[List[Tuple[float, float]]]:
    """Convert a labelled patch raster region into polygon coordinate rings."""
    rows, cols = np.where(labels == label_id)
    if len(rows) == 0:
        return []

    # Build a convex hull from the patch pixel coordinates
    coords = []
    for r, c in zip(rows, cols):
        lon, lat = _pixel_to_coords(r, c, transform)
        coords.append((lon, lat))

    if len(coords) < 3:
        # Too few points for a polygon — make a small square
        lon, lat = coords[0]
        d = transform["pixel_size_x"] * 2
        return [[(lon - d, lat - d), (lon + d, lat - d),
                 (lon + d, lat + d), (lon - d, lat + d),
                 (lon - d, lat - d)]]

    from shapely.geometry import MultiPoint
    hull = MultiPoint(coords).convex_hull

    if hull.geom_type == "Point":
        lon, lat = hull.x, hull.y
        d = transform["pixel_size_x"] * 2
        return [[(lon - d, lat - d), (lon + d, lat - d),
                 (lon + d, lat + d), (lon - d, lat + d),
                 (lon - d, lat - d)]]
    elif hull.geom_type == "LineString":
        # Buffer a line into a thin polygon
        buffered = hull.buffer(transform["pixel_size_x"] * 2)
        return [list(buffered.exterior.coords)]
    else:
        return [list(hull.exterior.coords)]


# ---------------------------------------------------------------------------
# Main CCA function
# ---------------------------------------------------------------------------

def run_cca(
    flood_mask: np.ndarray,
    log_ratio: np.ndarray,
    transform: Dict[str, float],
    resolution: int,
) -> List[Dict[str, Any]]:
    """Run Connected Component Analysis on a binary flood mask.

    Parameters
    ----------
    flood_mask : 2D bool array (True = flooded pixel)
    log_ratio  : 2D float array (dB change values)
    transform  : Geo-transform dict with west, north, pixel_size_x/y, width, height
    resolution : Pixel size in metres

    Returns
    -------
    List of patch dicts, each containing:
        zone_id, severity, area_km2, avg_depth_m, max_depth_m,
        confidence, centroid, bbox, polygon_coords, geometry
    """
    # Step 1: Label connected components
    structure = ndimage.generate_binary_structure(2, 2)  # 8-connectivity
    labels, num_patches = ndimage.label(flood_mask.astype(int), structure=structure)
    log.info("CCA found %d raw patches", num_patches)

    # Pixel area in km²
    pixel_area_m2 = resolution * resolution
    pixel_area_km2 = pixel_area_m2 / 1e6

    patches = []

    for patch_id in range(1, num_patches + 1):
        # Pixel count for this patch
        pixel_count = int(np.sum(labels == patch_id))
        area_km2 = pixel_count * pixel_area_km2

        # Step 2: Filter tiny patches
        if area_km2 < MIN_PATCH_AREA_KM2:
            continue

        # Get pixel rows/cols for this patch
        rows, cols = np.where(labels == patch_id)

        # Step 3: Compute centroid
        mean_row = float(np.mean(rows))
        mean_col = float(np.mean(cols))
        cen_lon, cen_lat = _pixel_to_coords(mean_row, mean_col, transform)

        # Bounding box
        min_row, max_row = int(np.min(rows)), int(np.max(rows))
        min_col, max_col = int(np.min(cols)), int(np.max(cols))
        sw_lon, sw_lat = _pixel_to_coords(max_row, min_col, transform)
        ne_lon, ne_lat = _pixel_to_coords(min_row, max_col, transform)
        bbox = [sw_lon, sw_lat, ne_lon, ne_lat]  # [west, south, east, north]

        # Depth proxy from backscatter change
        patch_db = log_ratio[labels == patch_id]
        mean_db_drop = float(np.mean(patch_db))
        max_db_drop = float(np.min(patch_db))  # Most negative = deepest
        avg_depth_m = _db_drop_to_depth(mean_db_drop)
        max_depth_m = _db_drop_to_depth(max_db_drop)

        # Confidence (based on number of SAR observations and dB contrast)
        confidence = min(1.0, abs(mean_db_drop) / 10.0)

        # Severity
        severity = classify_severity(area_km2, avg_depth_m)

        # Polygon geometry
        poly_coords = _patch_to_polygon(flood_mask, patch_id, labels, transform)
        geometry = {
            "type": "Polygon",
            "coordinates": poly_coords,
        }

        patches.append({
            "zone_id": f"ZONE-{patch_id:04d}",
            "severity": severity,
            "area_km2": round(area_km2, 4),
            "avg_depth_m": round(avg_depth_m, 2),
            "max_depth_m": round(max_depth_m, 2),
            "population_exposed": 0,  # Will be filled by population.py
            "confidence": round(confidence, 3),
            "centroid": {"lat": round(cen_lat, 6), "lon": round(cen_lon, 6)},
            "bbox": [round(v, 6) for v in bbox],
            "admin_name": "",  # Will be filled by reverse geocoding
            "geometry": geometry,
        })

    # Sort by area descending (largest flood patches first)
    patches.sort(key=lambda p: p["area_km2"], reverse=True)
    log.info("CCA retained %d patches (filtered tiny patches)", len(patches))

    return patches
