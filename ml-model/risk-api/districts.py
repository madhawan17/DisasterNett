"""districts.py -- Find admin districts in an AOI using FAO GAUL."""

import logging
from typing import Any, Dict, List

import ee
from data_sources import init_gee

log = logging.getLogger("risk.districts")


def find_districts(bbox: List[float]) -> List[Dict[str, Any]]:
    """
    Find administrative districts (Admin Level 2) intersecting the bbox.
    Uses FAO/GAUL/2015/level2 dataset.
    """
    init_gee()

    west, south, east, north = bbox
    aoi = ee.Geometry.Rectangle([west, south, east, north])

    try:
        # Load FAO GAUL Level 2 (Districts / Counties / Municipalities)
        gaul = ee.FeatureCollection("FAO/GAUL/2015/level2")
        
        # Filter to those intersecting our AOI
        intersecting = gaul.filterBounds(aoi)
        
        # We only want to process a reasonable number (e.g., top 10 largest by area)
        # to avoid API timeouts
        intersecting_list = intersecting.toList(10).getInfo()
        
        districts = []
        for feature in intersecting_list:
            props = feature.get("properties", {})
            geom_type = feature.get("geometry", {}).get("type")
            coords = feature.get("geometry", {}).get("coordinates", [])
            
            # Name
            name = props.get("ADM2_NAME") or props.get("ADM1_NAME") or "Unknown District"
            
            # Create an EE geometry for the district to compute its bounds and area
            if geom_type and coords:
                ee_geom = ee.Geometry(feature["geometry"])
                
                # Bbox
                bounds = ee_geom.bounds().coordinates().get(0).getInfo()
                # bounds is [[w,s], [e,s], [e,n], [w,n], [w,s]]
                d_west = bounds[0][0]
                d_south = bounds[0][1]
                d_east = bounds[2][0]
                d_north = bounds[2][1]
                
                # Center
                center_lon = (d_west + d_east) / 2
                center_lat = (d_south + d_north) / 2
                
                # Area
                area_m2 = ee_geom.area().getInfo()
                area_km2 = area_m2 / 1e6
                
                districts.append({
                    "name": name,
                    "ee_geom": ee_geom, # Keep the object for downstream queries
                    "bbox": [d_west, d_south, d_east, d_north],
                    "center": {"lat": center_lat, "lon": center_lon},
                    "area_km2": area_km2
                })

        return districts

    except Exception as e:
        log.error("Failed to fetch FAO GAUL districts: %s", e)
        # Fallback to a single "district" representing the entire AOI
        return [{
            "name": "Target Region",
            "ee_geom": aoi,
            "bbox": bbox,
            "center": {"lat": (south + north) / 2, "lon": (west + east) / 2},
            "area_km2": aoi.area().getInfo() / 1e6 if _gee_initialized else 0
        }]
