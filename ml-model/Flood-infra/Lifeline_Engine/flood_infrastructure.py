"""
flood_infrastructure.py — Overpass API querying for critical infrastructure within a flood extent.

This module provides:
  - Separate Overpass queries for each OSM tag category.
  - Shapely-based centroid computation for way/relation elements.
  - GeoJSON + CSV output with a flood_risk flag.
  - Retry/sleep mechanism for API rate-limit handling.

Queried OSM tags
----------------
  amenity=hospital, amenity=school, amenity=police, amenity=fire_station,
  amenity=pharmacy, amenity=place_of_worship, amenity=community_centre,
  building=residential, building=commercial, building=yes

Public API
----------
  query_flood_infrastructure(bbox, geojson_polygon, output_dir, output_prefix)
      -> InfrastructureResult
"""

from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import pandas as pd
import requests
from shapely.geometry import MultiPolygon, Point, Polygon, mapping, shape
from shapely.ops import unary_union

from log_config import get_logger

log = get_logger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Tag definitions: (key, value) -> human-readable feature_type
OVERPASS_TAGS: List[Tuple[str, str, str]] = [
    ("amenity", "hospital",          "hospital"),
    ("amenity", "school",            "school"),
    ("amenity", "police",            "police"),
    ("amenity", "fire_station",      "fire_station"),
    ("amenity", "pharmacy",          "pharmacy"),
    ("amenity", "place_of_worship",  "place_of_worship"),
    ("amenity", "community_centre",  "community_centre"),
    ("building", "residential",      "residential_building"),
    ("building", "commercial",       "commercial_building"),
    ("building", "yes",              "building"),
]

# HTTP request settings
_DEFAULT_TIMEOUT_S   = 90
_DEFAULT_MAX_RETRIES = 4
_DEFAULT_RETRY_SLEEP = 10.0   # seconds between retries (doubles each attempt)
_DEFAULT_TAG_SLEEP   = 1.5    # seconds between successive tag queries


# ---------------------------------------------------------------------------
# Overpass query helpers
# ---------------------------------------------------------------------------

def _build_overpass_query(key: str, value: str, bbox: Tuple[float, float, float, float]) -> str:
    """Build an Overpass QL query that returns full geometry for one tag.

    ``bbox`` is ``(min_lat, min_lon, max_lat, max_lon)``; Overpass expects
    ``south,west,north,east`` which maps to ``min_lat,min_lon,max_lat,max_lon``.
    """
    south, west, north, east = bbox
    bb = f"{south},{west},{north},{east}"
    return (
        f'[out:json][timeout:{_DEFAULT_TIMEOUT_S}];\n'
        f'(\n'
        f'  node["{key}"="{value}"]({bb});\n'
        f'  way["{key}"="{value}"]({bb});\n'
        f'  relation["{key}"="{value}"]({bb});\n'
        f');\n'
        f'out geom;'
    )


def _post_overpass(query: str, max_retries: int, retry_sleep: float) -> Dict[str, Any]:
    """POST an Overpass query and return the parsed JSON, with retry on failure."""
    last_exc: Exception = RuntimeError("No attempts made")
    sleep = retry_sleep
    for attempt in range(1, max_retries + 1):
        try:
            log.debug("Overpass request (attempt %d/%d)…", attempt, max_retries)
            resp = requests.post(
                OVERPASS_URL,
                data={"data": query},
                timeout=_DEFAULT_TIMEOUT_S + 10,
            )
            if resp.status_code == 429:
                log.warning("Overpass rate-limited (429). Sleeping %.0fs before retry.", sleep)
                time.sleep(sleep)
                sleep *= 2
                continue
            if resp.status_code in (503, 504):
                log.warning(
                    "Overpass returned %d. Sleeping %.0fs before retry.",
                    resp.status_code, sleep,
                )
                time.sleep(sleep)
                sleep *= 2
                continue
            resp.raise_for_status()
            return resp.json()
        except requests.exceptions.Timeout as exc:
            last_exc = exc
            log.warning("Overpass timeout (attempt %d): %s. Retrying in %.0fs.", attempt, exc, sleep)
            time.sleep(sleep)
            sleep *= 2
        except requests.exceptions.RequestException as exc:
            last_exc = exc
            log.warning("Overpass request error (attempt %d): %s. Retrying in %.0fs.", attempt, exc, sleep)
            time.sleep(sleep)
            sleep *= 2
    raise RuntimeError(
        f"Overpass API unreachable after {max_retries} attempts. Last error: {last_exc}"
    )


# ---------------------------------------------------------------------------
# Geometry / centroid helpers
# ---------------------------------------------------------------------------

def _node_to_point(element: Dict[str, Any]) -> Optional[Tuple[float, float]]:
    """Return (lat, lon) for an OSM node element."""
    lat = element.get("lat")
    lon = element.get("lon")
    if lat is not None and lon is not None:
        return float(lat), float(lon)
    return None


def _way_to_centroid(element: Dict[str, Any]) -> Optional[Tuple[float, float]]:
    """Compute the centroid of an OSM way element using its geometry array.

    Overpass returns a ``geometry`` list of ``{lat, lon}`` dicts when
    ``out geom;`` is used.  We build a Shapely polygon (or line, as
    fallback) and return its centroid in (lat, lon) order.
    """
    geom = element.get("geometry", [])
    if not geom:
        # fallback: check for centre key returned by some Overpass mirrors
        ctr = element.get("center")
        if ctr:
            return float(ctr["lat"]), float(ctr["lon"])
        return None

    coords = [(float(g["lon"]), float(g["lat"])) for g in geom if "lat" in g and "lon" in g]
    if len(coords) < 2:
        return None

    try:
        # Closed ring → polygon centroid; open ring → line centroid
        if coords[0] == coords[-1] and len(coords) >= 4:
            poly = Polygon(coords)
            if poly.is_valid and not poly.is_empty:
                c = poly.centroid
                return c.y, c.x   # lat, lon
        from shapely.geometry import LineString
        line = LineString(coords)
        c = line.centroid
        return c.y, c.x
    except Exception as exc:
        log.debug("Centroid computation failed for way %s: %s", element.get("id"), exc)
        return None


def _relation_to_centroid(element: Dict[str, Any]) -> Optional[Tuple[float, float]]:
    """Compute the centroid of an OSM relation by collecting all member-way geometry.

    When a relation has no processable geometry, falls back to the Overpass
    ``center`` field if present.
    """
    members = element.get("members", [])
    all_polys: List[Polygon] = []

    for member in members:
        geom = member.get("geometry", [])
        if not geom:
            continue
        coords = [(float(g["lon"]), float(g["lat"])) for g in geom if "lat" in g and "lon" in g]
        if len(coords) < 2:
            continue
        try:
            if coords[0] == coords[-1] and len(coords) >= 4:
                p = Polygon(coords)
                if p.is_valid and not p.is_empty:
                    all_polys.append(p)
        except Exception:
            continue

    if all_polys:
        try:
            union = unary_union(all_polys)
            c = union.centroid
            return c.y, c.x
        except Exception:
            pass

    # Final fallback: center field
    ctr = element.get("center")
    if ctr:
        return float(ctr["lat"]), float(ctr["lon"])
    return None


def _element_to_latlon(element: Dict[str, Any]) -> Optional[Tuple[float, float]]:
    """Dispatch centroid/coordinate extraction based on element type."""
    t = element.get("type")
    if t == "node":
        return _node_to_point(element)
    if t == "way":
        return _way_to_centroid(element)
    if t == "relation":
        return _relation_to_centroid(element)
    return None


# ---------------------------------------------------------------------------
# Polygon-in-extent filter
# ---------------------------------------------------------------------------

def _build_flood_polygon(geojson_polygon: Optional[Dict[str, Any]]) -> Optional[Polygon]:
    """Parse a GeoJSON Feature, FeatureCollection, Geometry dict → Shapely polygon.

    Returns ``None`` if the input is ``None`` or cannot be parsed.
    """
    if geojson_polygon is None:
        return None
    try:
        geom_type = geojson_polygon.get("type", "")
        if geom_type == "FeatureCollection":
            features = geojson_polygon.get("features", [])
            if not features:
                return None
            polys = [shape(f["geometry"]) for f in features if "geometry" in f]
            return unary_union(polys) if polys else None
        if geom_type == "Feature":
            return shape(geojson_polygon["geometry"])
        # Geometry object or raw Polygon/MultiPolygon
        return shape(geojson_polygon)
    except Exception as exc:
        log.warning("Could not parse GeoJSON flood polygon: %s", exc)
        return None


def _bbox_from_geojson(geojson_polygon: Dict[str, Any]) -> Tuple[float, float, float, float]:
    """Compute (min_lat, min_lon, max_lat, max_lon) bounding box of a GeoJSON polygon."""
    poly = _build_flood_polygon(geojson_polygon)
    if poly is None:
        raise ValueError("Could not extract bounding box from supplied GeoJSON polygon.")
    minx, miny, maxx, maxy = poly.bounds   # (min_lon, min_lat, max_lon, max_lat) for EPSG:4326
    return miny, minx, maxy, maxx           # return as (min_lat, min_lon, max_lat, max_lon)


def circle_to_bbox_and_poly(
    center_lat: float,
    center_lon: float,
    radius_m: float,
) -> Tuple[Tuple[float, float, float, float], Polygon]:
    """Convert a lat/lon/radius circle into a WGS-84 bounding box and Shapely polygon.

    The circle is projected to the appropriate UTM zone, buffered by *radius_m*
    metres, and reprojected back to WGS-84 so both the bbox and the membership-
    filter polygon are accurate in real-world metres.

    Returns
    -------
    bbox : (min_lat, min_lon, max_lat, max_lon)
    polygon : Shapely Polygon in WGS-84 (lon, lat) coordinate order.
    """
    from pyproj import Transformer

    # Auto-select a UTM CRS centred on the point for accurate metric buffering
    utm_zone = int((center_lon + 180) / 6) + 1
    hemisphere = "north" if center_lat >= 0 else "south"
    utm_epsg = 32600 + utm_zone if hemisphere == "north" else 32700 + utm_zone

    wgs84_to_utm = Transformer.from_crs("EPSG:4326", f"EPSG:{utm_epsg}", always_xy=True)
    utm_to_wgs84 = Transformer.from_crs(f"EPSG:{utm_epsg}", "EPSG:4326", always_xy=True)

    cx, cy = wgs84_to_utm.transform(center_lon, center_lat)
    circle_utm = Point(cx, cy).buffer(radius_m)

    # Reproject polygon vertices back to WGS-84
    coords_wgs84 = [
        utm_to_wgs84.transform(x, y)
        for x, y in circle_utm.exterior.coords
    ]  # list of (lon, lat) tuples
    poly_wgs84 = Polygon(coords_wgs84)

    minx, miny, maxx, maxy = poly_wgs84.bounds   # (min_lon, min_lat, max_lon, max_lat)
    bbox = (miny, minx, maxy, maxx)               # (min_lat, min_lon, max_lat, max_lon)
    return bbox, poly_wgs84


# ---------------------------------------------------------------------------
# Feature extraction from a single Overpass response
# ---------------------------------------------------------------------------

def _extract_features(
    overpass_data: Dict[str, Any],
    feature_type: str,
    flood_polygon: Optional[Any],   # Shapely polygon or None
) -> List[Dict[str, Any]]:
    """Turn raw Overpass JSON elements into feature dicts.

    Parameters
    ----------
    overpass_data:
        Parsed JSON from the Overpass API.
    feature_type:
        Human-readable type label (e.g. ``"hospital"``).
    flood_polygon:
        When provided, only elements whose centroid falls *inside* this
        polygon are included (useful for non-rectangular flood extents).

    Returns
    -------
    List of feature record dicts.
    """
    features: List[Dict[str, Any]] = []
    for element in overpass_data.get("elements", []):
        coords = _element_to_latlon(element)
        if coords is None:
            continue
        lat, lon = coords

        # Optional polygon membership test
        if flood_polygon is not None:
            try:
                if not flood_polygon.contains(Point(lon, lat)):
                    continue
            except Exception:
                pass   # on geometry error, include the feature

        tags = element.get("tags", {})
        name = (
            tags.get("name")
            or tags.get("name:en")
            or tags.get("operator")
            or ""
        )
        features.append(
            {
                "feature_id": f"{element['type']}/{element['id']}",
                "osm_id":     element["id"],
                "osm_type":   element["type"],
                "name":       name,
                "feature_type": feature_type,
                "latitude":   round(lat, 7),
                "longitude":  round(lon, 7),
                "flood_risk": True,
            }
        )
    return features


# ---------------------------------------------------------------------------
# Output writers
# ---------------------------------------------------------------------------

def _to_geojson(features: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Convert feature list to a GeoJSON FeatureCollection."""
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "id":   f["feature_id"],
                "geometry": {
                    "type":        "Point",
                    "coordinates": [f["longitude"], f["latitude"]],
                },
                "properties": {
                    "feature_id":   f["feature_id"],
                    "osm_id":       f["osm_id"],
                    "osm_type":     f["osm_type"],
                    "name":         f["name"],
                    "feature_type": f["feature_type"],
                    "latitude":     f["latitude"],
                    "longitude":    f["longitude"],
                    "flood_risk":   True,
                },
            }
            for f in features
        ],
    }


def _to_csv_df(features: List[Dict[str, Any]]) -> pd.DataFrame:
    """Build a pandas DataFrame with the canonical CSV columns."""
    return pd.DataFrame(
        [
            {
                "feature_id":   f["feature_id"],
                "name":         f["name"],
                "feature_type": f["feature_type"],
                "latitude":     f["latitude"],
                "longitude":    f["longitude"],
                "flood_risk":   f["flood_risk"],
            }
            for f in features
        ],
        columns=["feature_id", "name", "feature_type", "latitude", "longitude", "flood_risk"],
    )


def _save_outputs(
    features: List[Dict[str, Any]],
    output_dir: Path,
    prefix: str,
) -> Tuple[Path, Path]:
    """Write GeoJSON + CSV files and return their paths."""
    output_dir.mkdir(parents=True, exist_ok=True)

    geojson_path = output_dir / f"{prefix}.geojson"
    csv_path     = output_dir / f"{prefix}.csv"

    geojson_obj = _to_geojson(features)
    geojson_path.write_text(json.dumps(geojson_obj, indent=2, ensure_ascii=False), encoding="utf-8")
    log.info("GeoJSON saved → %s", geojson_path)

    df = _to_csv_df(features)
    df.to_csv(csv_path, index=False, encoding="utf-8")
    log.info("CSV saved → %s  (%d rows)", csv_path, len(df))

    return geojson_path, csv_path


# ---------------------------------------------------------------------------
# Summary printer
# ---------------------------------------------------------------------------

def _print_summary(features: List[Dict[str, Any]], geojson_path: Path, csv_path: Path) -> None:
    """Print a human-readable summary to stdout and via the module logger."""
    counts: Dict[str, int] = {}
    for f in features:
        counts[f["feature_type"]] = counts.get(f["feature_type"], 0) + 1

    lines = [
        "",
        "=" * 60,
        "  Flood Infrastructure Extraction — Summary",
        "=" * 60,
        f"  Total features extracted : {len(features)}",
        "-" * 60,
    ]
    for ftype, cnt in sorted(counts.items()):
        lines.append(f"  {ftype:<30s} {cnt:>5d}")
    lines += [
        "-" * 60,
        f"  GeoJSON → {geojson_path}",
        f"  CSV     → {csv_path}",
        "=" * 60,
        "",
    ]
    summary_str = "\n".join(lines)
    print(summary_str)
    log.info("Extraction summary:\n%s", summary_str)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

class InfrastructureResult:
    """Container for the extraction result."""

    def __init__(
        self,
        features: List[Dict[str, Any]],
        geojson: Dict[str, Any],
        geojson_path: Path,
        csv_path: Path,
        summary: Dict[str, int],
    ) -> None:
        self.features     = features
        self.geojson      = geojson
        self.geojson_path = geojson_path
        self.csv_path     = csv_path
        self.summary      = summary


def query_flood_infrastructure(
    bbox: Optional[Tuple[float, float, float, float]] = None,
    geojson_polygon: Optional[Dict[str, Any]] = None,
    _flood_shape: Optional[Any] = None,
    output_dir: str = ".",
    output_prefix: str = "flood_infrastructure",
    max_retries: int = _DEFAULT_MAX_RETRIES,
    retry_sleep: float = _DEFAULT_RETRY_SLEEP,
    tag_sleep: float = _DEFAULT_TAG_SLEEP,
) -> InfrastructureResult:
    """Query the Overpass API for critical infrastructure within a flood extent.

    Parameters
    ----------
    bbox:
        Bounding box as ``(min_lat, min_lon, max_lat, max_lon)``.
        If *geojson_polygon* is provided it will be used to derive the bbox
        and the membership-filter polygon instead.
    geojson_polygon:
        GeoJSON Feature, FeatureCollection, or Geometry object.  Features are
        additionally filtered so only centroids inside the polygon are kept.
    _flood_shape:
        Pre-built Shapely polygon (WGS-84) used directly as the membership
        filter.  Intended for internal callers (e.g. the API endpoint) that
        have already computed the polygon from lat/lon/radius.  Ignored when
        *geojson_polygon* is supplied.
    output_dir:
        Directory where the GeoJSON and CSV files will be saved.
    output_prefix:
        Filename prefix (without extension) for both output files.
    max_retries:
        Maximum number of retry attempts per tag query.
    retry_sleep:
        Base sleep time (seconds) before the first retry; doubles each attempt.
    tag_sleep:
        Seconds to sleep between successive tag queries.

    Returns
    -------
    InfrastructureResult
    """
    # --- Resolve bounding box ---------------------------------------------------
    if geojson_polygon is not None:
        try:
            resolved_bbox = _bbox_from_geojson(geojson_polygon)
        except ValueError as exc:
            raise ValueError(f"Invalid geojson_polygon: {exc}") from exc
    elif bbox is not None:
        resolved_bbox = tuple(bbox)   # type: ignore[assignment]
    else:
        raise ValueError("Provide either 'bbox' or 'geojson_polygon'.")

    min_lat, min_lon, max_lat, max_lon = resolved_bbox
    log.info(
        "Flood extent bbox: lat %.6f\u2013%.6f, lon %.6f\u2013%.6f",
        min_lat, max_lat, min_lon, max_lon,
    )

    # --- Resolve membership-filter polygon -------------------------------------
    if geojson_polygon is not None:
        flood_shape = _build_flood_polygon(geojson_polygon)
    elif _flood_shape is not None:
        flood_shape = _flood_shape
    else:
        flood_shape = None

    # --- Query each tag category ------------------------------------------------
    all_features: List[Dict[str, Any]] = []
    seen_ids: set = set()

    for idx, (key, value, feature_type) in enumerate(OVERPASS_TAGS):
        log.info(
            "[%d/%d] Querying Overpass: %s=%s …",
            idx + 1, len(OVERPASS_TAGS), key, value,
        )
        query = _build_overpass_query(key, value, resolved_bbox)
        try:
            data = _post_overpass(query, max_retries=max_retries, retry_sleep=retry_sleep)
        except RuntimeError as exc:
            log.error("Skipping %s=%s — %s", key, value, exc)
            if idx < len(OVERPASS_TAGS) - 1:
                time.sleep(tag_sleep)
            continue

        feats = _extract_features(data, feature_type, flood_shape)

        # Deduplicate across tag categories (an element may match >1 tag)
        new_feats = []
        for f in feats:
            uid = f["feature_id"]
            if uid not in seen_ids:
                seen_ids.add(uid)
                new_feats.append(f)

        log.info("  → %d new features (total so far: %d)", len(new_feats), len(all_features) + len(new_feats))
        all_features.extend(new_feats)

        # Polite delay between queries
        if idx < len(OVERPASS_TAGS) - 1:
            time.sleep(tag_sleep)

    # --- Save outputs -----------------------------------------------------------
    out_path = Path(output_dir)
    geojson_path, csv_path = _save_outputs(all_features, out_path, output_prefix)
    geojson_obj = _to_geojson(all_features)

    # --- Summary ----------------------------------------------------------------
    summary: Dict[str, int] = {}
    for f in all_features:
        summary[f["feature_type"]] = summary.get(f["feature_type"], 0) + 1

    _print_summary(all_features, geojson_path, csv_path)

    return InfrastructureResult(
        features=all_features,
        geojson=geojson_obj,
        geojson_path=geojson_path,
        csv_path=csv_path,
        summary=summary,
    )
