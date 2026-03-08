"""
api.py — FastAPI REST interface for the Lifeline Accessibility & Road Network Analysis.

Endpoints
---------
GET  /health              — Liveness check + cache status.
POST /analyze             — Single point-to-point dual-pass analysis (A → B).
POST /simulate            — Full city-wide mock-flood scenario (returns state table).
DELETE /cache/{place}     — Evict a cached graph to force a fresh download.

Graph caching
-------------
Road networks are expensive to download.  The first request for a given
``place_name`` downloads & projects the graph; subsequent requests reuse the
in-process cache.  A threading.Lock prevents race conditions on concurrent
first-requests for the same city.
"""

from __future__ import annotations

import logging
import math
import sys
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import networkx as nx
from fastapi import FastAPI, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, model_validator

# ---------------------------------------------------------------------------
# Logging — initialise before local imports so every module uses the same setup
# ---------------------------------------------------------------------------
sys.path.insert(0, str(Path(__file__).parent))
from log_config import get_logger, setup_logging  # noqa: E402

setup_logging()
log = get_logger("lifeline.api")

from engine import (
    apply_flood_mask,
    build_crisis_graph,
    find_hub_node,
    find_nearest_facility,
    generate_state_table,
    get_detailed_path_coords,
    load_network,
    run_dual_pass_dijkstra,
    snap_facilities_to_nodes,
)
from utils_geo import extract_wgs84_coords, fetch_facilities_from_osm, flood_circle, get_nearest_node
from flood_infrastructure import circle_to_bbox_and_poly, query_flood_infrastructure

# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------
app = FastAPI(
    title="Lifeline Accessibility & Road Network Analysis API",
    description=(
        "Flood-aware routing engine: marks flooded road edges as blocked and"
        " runs dual-pass Dijkstra (baseline vs. crisis) to determine facility"
        " accessibility status."
    ),
    version="1.0.0",
)

# ---------------------------------------------------------------------------
# In-process graph cache  { place_name: (G_projected, epsg) }
# ---------------------------------------------------------------------------
_graph_cache: Dict[str, Tuple[nx.MultiDiGraph, int]] = {}
_cache_lock = threading.Lock()

# Facility cache  { "place::type": snapped_list }
_facility_cache: Dict[str, List[Dict]] = {}
_facility_lock = threading.Lock()

# Bounding-box cache  { place_name: (min_lat, max_lat, min_lon, max_lon) }
_bbox_cache: Dict[str, Tuple[float, float, float, float]] = {}
_bbox_lock  = threading.Lock()


# ---------------------------------------------------------------------------
# Place bounding-box helper
# ---------------------------------------------------------------------------

def _get_place_bbox(
    place_name: str, G: nx.MultiDiGraph
) -> Tuple[float, float, float, float]:
    """Return (min_lat, max_lat, min_lon, max_lon) for *place_name*.

    Derived directly from the graph node lat/lon attributes so no extra
    network call is needed.  Adds a small padding buffer so points right on
    the place boundary are not wrongly rejected.
    """
    with _bbox_lock:
        if place_name in _bbox_cache:
            return _bbox_cache[place_name]

        import osmnx as _ox
        nodes_gdf = _ox.graph_to_gdfs(G, edges=False).to_crs("EPSG:4326")
        pad = 0.15  # ~15 km buffer — generous enough for any suburb
        bbox = (
            float(nodes_gdf.geometry.y.min()) - pad,
            float(nodes_gdf.geometry.y.max()) + pad,
            float(nodes_gdf.geometry.x.min()) - pad,
            float(nodes_gdf.geometry.x.max()) + pad,
        )
        _bbox_cache[place_name] = bbox
        log.debug("BBox for '%s': %.4f/%.4f lat, %.4f/%.4f lon", place_name, *bbox)
        return bbox


def _get_or_load_graph(place_name: str) -> Tuple[nx.MultiDiGraph, int]:
    """Return a cached graph for *place_name*, downloading it if necessary."""
    with _cache_lock:
        if place_name not in _graph_cache:
            log.info("Cache miss — downloading graph for '%s' …", place_name)
            G, epsg = load_network(place_name)
            _graph_cache[place_name] = (G, epsg)
            log.info("Graph cached for '%s'", place_name)
        else:
            log.info("Cache hit for '%s'", place_name)
    return _graph_cache[place_name]


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class Coords(BaseModel):
    """A WGS-84 geographic coordinate pair."""
    lat: float = Field(..., ge=-90.0,  le=90.0,  description="Latitude  (WGS-84, decimal degrees)")
    lon: float = Field(..., ge=-180.0, le=180.0, description="Longitude (WGS-84, decimal degrees)")

    @model_validator(mode="after")
    def _reject_boundary_extremes(self) -> "Coords":
        """Reject coordinates that are exactly at the WGS-84 domain boundary.

        Values of exactly ±90 lat or ±180 lon are mathematically valid but are
        almost always the result of an uninitialised variable or a copy-paste of
        the Pydantic field constraint rather than a real geographic location.
        """
        if self.lat in (-90.0, 90.0):
            raise ValueError(
                f"lat={self.lat} is a boundary extreme — provide a real latitude."
            )
        if self.lon in (-180.0, 180.0):
            raise ValueError(
                f"lon={self.lon} is a boundary extreme — provide a real longitude."
            )
        return self


class FloodConfig(BaseModel):
    """Definition of one circular flood zone."""
    center_lat: float = Field(..., ge=-90.0,  le=90.0)
    center_lon: float = Field(..., ge=-180.0, le=180.0)
    radius_m: float   = Field(500.0, gt=0, description="Flood radius in metres")

    @model_validator(mode="after")
    def _reject_boundary_extremes(self) -> "FloodConfig":
        if self.center_lat in (-90.0, 90.0):
            raise ValueError(f"center_lat={self.center_lat} is a boundary extreme — provide a real latitude.")
        if self.center_lon in (-180.0, 180.0):
            raise ValueError(f"center_lon={self.center_lon} is a boundary extreme — provide a real longitude.")
        return self


FACILITY_TYPES = {"hospital", "police", "fire_station"}


class AnalyzeRequest(BaseModel):
    """
    Nearest-facility dual-pass accessibility request.

    - **point_a**: The origin coordinate (e.g. a citizen's location or an
      incident point).
    - **facility_type**: The type of lifeline facility to route to.
      One of ``hospital``, ``police``, ``fire_station``.
    - **place_name**: Nominatim place used to retrieve the road network.
    - **flood**: Optional flood circle.  Defaults to a 500 m circle at the
      Navi Mumbai city centre when omitted.
    """
    point_a: Coords
    facility_type: str = Field(
        "hospital",
        description="Target facility type: hospital | police | fire_station",
    )
    place_name: str = Field("Navi Mumbai, India", description="City / area name for OSMnx graph download")
    flood: Optional[FloodConfig] = Field(
        None,
        description="Flood zone definition.  Defaults to 500 m circle at city centre.",
    )


class FacilityHit(BaseModel):
    """Details of the nearest facility found in one Dijkstra pass."""
    facility_id: str
    name: str
    type: str
    lat: float
    lon: float
    nearest_node: int
    dist_m: float


class RouteCoord(BaseModel):
    """A single WGS-84 coordinate with a stable unique ID for globe rendering."""
    id: str = Field(..., description="Unique coord ID e.g. fac-01-001 (path-N, coord-N)")
    lat: float
    lon: float


class RoutePathHit(BaseModel):
    """Nearest facility with its full road-following path for globe rendering."""
    facility_id: str
    name: str
    dist_m: float
    path: List[RouteCoord] = Field(
        default_factory=list,
        description="Ordered WGS-84 coords following road geometry from origin to facility.",
    )


class RouteRequest(BaseModel):
    """
    Route visualisation request — returns full path geometries for globe rendering.

    Returns both the *baseline* (no flood) and *crisis* (flood-masked) paths
    from the origin to the nearest facility, together with blocked edge segments
    and the flood polygon boundary so a globe renderer can overlay all layers.
    """
    point_a: Coords
    facility_type: str = Field(
        "hospital",
        description="Target facility type: hospital | police | fire_station",
    )
    place_name: str = Field("Navi Mumbai, India")
    flood: Optional[FloodConfig] = Field(
        None,
        description="Flood zone.  Defaults to 500 m circle at city centre.",
    )


class RouteResponse(BaseModel):
    """Minimal globe-rendering payload — baseline and crisis paths only."""
    baseline: Optional[RoutePathHit] = Field(
        None,
        description="Path to nearest facility under normal (no flood) conditions.",
    )
    crisis: Optional[RoutePathHit] = Field(
        None,
        description="Path to nearest reachable facility after flood (may differ from baseline).",
    )


class AnalyzeResponse(BaseModel):
    """Result of a nearest-facility dual-pass analysis."""
    place_name: str
    facility_type: str
    point_a: Coords
    nearest_node_a: int
    flood_center: Coords
    flood_radius_m: float
    edges_blocked: int
    # --- Baseline (no flood) ---
    baseline: Optional[FacilityHit] = Field(None, description="Nearest facility under normal conditions")
    # --- Crisis (with flood) ---
    crisis: Optional[FacilityHit] = Field(None, description="Nearest reachable facility after flood (may differ)")
    detour_factor: Optional[float] = Field(None, description="crisis.dist_m / baseline.dist_m; null = CUT_OFF")
    rerouted: bool = Field(False, description="True when crisis routes to a different facility than baseline")
    status: str = Field(..., description="FULLY_ACCESSIBLE | LIMITED_ACCESS | CUT_OFF")
    warnings: List[str] = Field(default_factory=list, description="Non-fatal anomalies detected during analysis")


class SimulateRequest(BaseModel):
    """
    Full city-wide mock-flood simulation request.

    Fetches all hospitals & schools from OSM, applies the flood mask, and
    returns the complete state table.
    """
    place_name: str = Field("Navi Mumbai, India")
    hub: Optional[Coords] = Field(
        None,
        description="Hub / reference node.  Defaults to the Navi Mumbai city centre.",
    )
    flood: Optional[FloodConfig] = Field(
        None,
        description="Flood zone definition.  Defaults to 500 m circle at city centre.",
    )
    save_to_disk: bool = Field(
        False,
        description="When true, also write state_table.json and state_table.csv to the server's working directory.",
    )
    top_n: Optional[int] = Field(
        None,
        gt=0,
        description="Return only the N nearest accessible facilities sorted by baseline_dist_m. Omit for all.",
    )
    sort_by: str = Field(
        "baseline_dist_m",
        description="Field to sort facilities by: baseline_dist_m | flood_dist_m | detour_factor | status",
    )
    status_filter: Optional[List[str]] = Field(
        None,
        description="Only return facilities matching these statuses. E.g. ['CUT_OFF', 'LIMITED_ACCESS']",
    )


class FacilityResult(BaseModel):
    facility_id: str
    name: str
    type: str
    lat: float
    lon: float
    nearest_node: Optional[int]
    baseline_dist_m: Optional[float]
    flood_dist_m: Optional[float]
    detour_factor: Union[float, str, None]
    status: str


class SimulateResponse(BaseModel):
    place_name: str
    hub: Coords
    flood_center: Coords
    flood_radius_m: float
    total_facilities: int
    edges_blocked: int
    summary: Dict[str, int]
    warnings: List[str] = Field(default_factory=list)
    facilities: List[FacilityResult]


# ---------------------------------------------------------------------------
# Helper — apply flood + build crisis graph, return (G_original, G_crisis, n_blocked)
# ---------------------------------------------------------------------------

def _prepare_graphs(
    G: nx.MultiDiGraph,
    epsg: int,
    flood_cfg: Optional[FloodConfig],
    default_lat: float,
    default_lon: float,
) -> Tuple[nx.MultiDiGraph, nx.MultiDiGraph, int, FloodConfig]:
    """Apply flood mask and return (G_baseline, G_crisis, n_blocked, flood_used)."""
    import copy

    # Deep-copy the graph so the cache entry is never mutated
    G_work: nx.MultiDiGraph = copy.deepcopy(G)

    # Resolve flood config
    if flood_cfg is None:
        flood_cfg = FloodConfig(center_lat=default_lat, center_lon=default_lon, radius_m=500.0)

    flood_poly = flood_circle(
        flood_cfg.center_lat, flood_cfg.center_lon,
        radius_m=flood_cfg.radius_m, crs_epsg=epsg,
    )
    apply_flood_mask(G_work, [flood_poly])

    n_blocked = sum(
        1 for _, _, _, d in G_work.edges(keys=True, data=True) if d.get("blocked", False)
    )
    G_crisis = build_crisis_graph(G_work)
    return G_work, G_crisis, n_blocked, flood_cfg


# ---------------------------------------------------------------------------
# Default hub coordinates (Navi Mumbai centre)
# ---------------------------------------------------------------------------
_DEFAULT_HUB_LAT = 19.0330
_DEFAULT_HUB_LON = 73.0297


# ---------------------------------------------------------------------------
# Origin-in-flood guard
# ---------------------------------------------------------------------------

def _origin_in_flood_zone(lat: float, lon: float, flood: FloodConfig, epsg: int) -> bool:
    """Return True if (*lat*, *lon*) falls inside the flood circle.

    Both the origin and the flood polygon are projected to the graph's UTM CRS
    before the point-in-polygon test so the comparison is in metres, not
    degrees.
    """
    try:
        from pyproj import Transformer
        from shapely.geometry import Point

        tr = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True)
        ox, oy   = tr.transform(lon, lat)
        fcx, fcy = tr.transform(flood.center_lon, flood.center_lat)
        flood_poly = Point(fcx, fcy).buffer(flood.radius_m)
        return flood_poly.contains(Point(ox, oy))
    except Exception as exc:
        log.warning("Origin-in-flood check failed (non-fatal): %s", exc)
        return False


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health", tags=["Meta"])
def health() -> JSONResponse:
    """Liveness check.  Returns cached place names and graph sizes."""
    cache_info = {
        place: {
            "nodes": G.number_of_nodes(),
            "edges": G.number_of_edges(),
            "epsg": epsg,
        }
        for place, (G, epsg) in _graph_cache.items()
    }
    return JSONResponse({"status": "ok", "cached_graphs": cache_info})


@app.post("/analyze", response_model=AnalyzeResponse, tags=["Analysis"])
def analyze(req: AnalyzeRequest) -> AnalyzeResponse:
    """
    **Nearest-facility dual-pass accessibility analysis.**

    Given an **origin point** and a **facility type** (hospital / police /
    fire_station), finds the nearest reachable facility:

    - **Baseline pass** — on the unmodified road graph.
    - **Crisis pass**   — on the flood-masked graph (blocked edges removed).

    The crisis nearest facility may be *different* from the baseline one if the
    closest facility is cut off by the flood.  The response includes both hits
    and a ``rerouted`` flag.
    """
    # Validate facility_type
    if req.facility_type not in FACILITY_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"facility_type must be one of {sorted(FACILITY_TYPES)}",
        )

    # Load (or reuse cached) graph
    try:
        G, epsg = _get_or_load_graph(req.place_name)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))

    # Validate point_a is within the place bounding box
    try:
        min_lat, max_lat, min_lon, max_lon = _get_place_bbox(req.place_name, G)
        if not (min_lat <= req.point_a.lat <= max_lat and min_lon <= req.point_a.lon <= max_lon):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"point_a ({req.point_a.lat}, {req.point_a.lon}) is outside the "
                    f"bounding box of '{req.place_name}' "
                    f"(lat {min_lat:.4f}–{max_lat:.4f}, lon {min_lon:.4f}–{max_lon:.4f}). "
                    "Provide coordinates within the city area."
                ),
            )
    except HTTPException:
        raise
    except Exception as exc:
        log.warning("BBox check failed (non-fatal): %s", exc)

    # Load (or reuse cached) snapped facility list
    fac_cache_key = f"{req.place_name}::{req.facility_type}"
    with _facility_lock:
        if fac_cache_key not in _facility_cache:
            try:
                fac_gdf = fetch_facilities_from_osm(
                    req.place_name, epsg, amenity_tags=[req.facility_type]
                )
            except Exception:
                # Fallback: filter hard-coded set
                import sys
                from pathlib import Path as _Path
                sys.path.insert(0, str(_Path(__file__).parent))
                from main import build_fallback_gdf  # type: ignore[import]
                fac_gdf = build_fallback_gdf(epsg)
                fac_gdf = fac_gdf[fac_gdf["type"] == req.facility_type]
            fac_gdf = extract_wgs84_coords(fac_gdf)
            snapped = snap_facilities_to_nodes(G, fac_gdf)
            _facility_cache[fac_cache_key] = snapped
            log.info("Facility cache set: %s (%d items)", fac_cache_key, len(snapped))
    snapped_facilities = _facility_cache[fac_cache_key]

    if not snapped_facilities:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No '{req.facility_type}' facilities found in '{req.place_name}'.",
        )

    # Deep-copy graph + apply flood mask
    try:
        G_work, G_crisis, n_blocked, flood_used = _prepare_graphs(
            G, epsg, req.flood, _DEFAULT_HUB_LAT, _DEFAULT_HUB_LON
        )
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))

    # Reject request when the origin itself is inside the flood zone —
    # no outward path is physically passable from a flooded location.
    if _origin_in_flood_zone(req.point_a.lat, req.point_a.lon, flood_used, epsg):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Origin ({req.point_a.lat}, {req.point_a.lon}) is inside the flood zone "
                f"(center={flood_used.center_lat},{flood_used.center_lon}, "
                f"radius={flood_used.radius_m}m). "
                "No outward route is physically feasible from a flooded location. "
                "Provide an origin outside the flood area."
            ),
        )

    # Snap origin to nearest node
    try:
        node_a = get_nearest_node(G_work, req.point_a.lat, req.point_a.lon)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    # Dual-pass: find nearest facility in each graph
    baseline_hit = find_nearest_facility(G_work,   node_a, snapped_facilities)
    crisis_hit   = find_nearest_facility(G_crisis, node_a, snapped_facilities)

    # ------------------------------------------------------------------ #
    # Collect non-fatal warnings                                           #
    # ------------------------------------------------------------------ #
    analysis_warnings: List[str] = []

    if baseline_hit is not None and baseline_hit["node"] == node_a:
        analysis_warnings.append(
            f"Origin snapped to the same graph node as '{baseline_hit['name']}' "
            "(node " + str(node_a) + "). "
            "The origin coordinate may be inside or co-located with the facility. "
            "Verify point_a is the incident/citizen location, not the facility itself."
        )
        log.warning(
            "[%s] Origin node == facility node (%d) for '%s' — dist_m=0 is unreliable.",
            req.place_name, node_a, baseline_hit["name"],
        )

    if baseline_hit is not None and baseline_hit["dist_m"] == 0 and baseline_hit["node"] != node_a:
        analysis_warnings.append(
            "Baseline distance is 0 m even though origin and facility are on different nodes. "
            "This may indicate a graph topology issue."
        )

    if n_blocked == 0:
        analysis_warnings.append(
            "No edges were blocked by the flood polygon. "
            "The flood zone may not intersect the road network — check flood coordinates."
        )
        log.warning("[%s] Flood mask blocked 0 edges — flood may be outside city bounds.", req.place_name)

    # ------------------------------------------------------------------ #
    # Classify                                                             #
    # ------------------------------------------------------------------ #
    if crisis_hit is None:
        st = "CUT_OFF"
        detour_factor: Optional[float] = None
        rerouted = True
    else:
        rerouted = (
            baseline_hit is not None
            and crisis_hit["facility_id"] != baseline_hit["facility_id"]
        )
        if baseline_hit and baseline_hit["dist_m"] > 0:
            detour_factor = round(crisis_hit["dist_m"] / baseline_hit["dist_m"], 4)
        else:
            detour_factor = 1.0
        st = "FULLY_ACCESSIBLE" if (detour_factor < 1.2 and not rerouted) else "LIMITED_ACCESS"

    if rerouted:
        analysis_warnings.append(
            f"Rerouted: closest {req.facility_type} under flood conditions is "
            f"'{crisis_hit['name']}' (not '{baseline_hit['name'] if baseline_hit else 'N/A'}')."
        )

    def _to_hit(h: Optional[Dict]) -> Optional[FacilityHit]:
        if h is None:
            return None
        return FacilityHit(
            facility_id=h["facility_id"],
            name=h["name"],
            type=h["type"],
            lat=h["lat"],
            lon=h["lon"],
            nearest_node=h["node"],
            dist_m=h["dist_m"],
        )

    return AnalyzeResponse(
        place_name=req.place_name,
        facility_type=req.facility_type,
        point_a=req.point_a,
        nearest_node_a=node_a,
        flood_center=Coords(lat=flood_used.center_lat, lon=flood_used.center_lon),
        flood_radius_m=flood_used.radius_m,
        edges_blocked=n_blocked,
        baseline=_to_hit(baseline_hit),
        crisis=_to_hit(crisis_hit),
        detour_factor=detour_factor,
        rerouted=rerouted,
        status=st,
        warnings=analysis_warnings,
    )


@app.post("/route", response_model=RouteResponse, tags=["Analysis"])
def route(req: RouteRequest) -> RouteResponse:
    """
    **Globe-rendering route endpoint.**

    Returns the road-following path from the origin to the nearest facility
    for both the *baseline* (no flood) and *crisis* (flood-masked) passes.

    Each coordinate in every path carries a unique incrementing ID of the
    form ``fac-{pass}-{seq}`` (e.g. ``fac-01-001`` for the first point of the
    baseline path, ``fac-02-001`` for the first point of the crisis path).
    Feed the coordinate arrays directly into a deck.gl ``PathLayer`` or any
    other globe renderer \u2014 all coordinates are WGS-84 decimal degrees.
    """
    # ---- validate facility_type ----
    if req.facility_type not in FACILITY_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"facility_type must be one of {sorted(FACILITY_TYPES)}",
        )

    # ---- graph ----
    try:
        G, epsg = _get_or_load_graph(req.place_name)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))

    # ---- bbox guard ----
    try:
        min_lat, max_lat, min_lon, max_lon = _get_place_bbox(req.place_name, G)
        if not (min_lat <= req.point_a.lat <= max_lat and min_lon <= req.point_a.lon <= max_lon):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"point_a ({req.point_a.lat}, {req.point_a.lon}) is outside the "
                    f"bounding box of '{req.place_name}' "
                    f"(lat {min_lat:.4f}\u2013{max_lat:.4f}, lon {min_lon:.4f}\u2013{max_lon:.4f})."
                ),
            )
    except HTTPException:
        raise
    except Exception as exc:
        log.warning("BBox check failed (non-fatal): %s", exc)

    # ---- facilities ----
    fac_cache_key = f"{req.place_name}::{req.facility_type}"
    with _facility_lock:
        if fac_cache_key not in _facility_cache:
            try:
                fac_gdf = fetch_facilities_from_osm(
                    req.place_name, epsg, amenity_tags=[req.facility_type]
                )
            except Exception:
                import sys
                from pathlib import Path as _Path
                sys.path.insert(0, str(_Path(__file__).parent))
                from main import build_fallback_gdf  # type: ignore[import]
                fac_gdf = build_fallback_gdf(epsg)
                fac_gdf = fac_gdf[fac_gdf["type"] == req.facility_type]
            fac_gdf = extract_wgs84_coords(fac_gdf)
            snapped = snap_facilities_to_nodes(G, fac_gdf)
            _facility_cache[fac_cache_key] = snapped
    snapped_facilities = _facility_cache[fac_cache_key]

    if not snapped_facilities:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No '{req.facility_type}' facilities found in '{req.place_name}'.",
        )

    # ---- flood + crisis graph ----
    try:
        G_work, G_crisis, n_blocked, flood_used = _prepare_graphs(
            G, epsg, req.flood, _DEFAULT_HUB_LAT, _DEFAULT_HUB_LON
        )
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))

    # Reject request when the origin itself is inside the flood zone.
    if _origin_in_flood_zone(req.point_a.lat, req.point_a.lon, flood_used, epsg):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Origin ({req.point_a.lat}, {req.point_a.lon}) is inside the flood zone "
                f"(center={flood_used.center_lat},{flood_used.center_lon}, "
                f"radius={flood_used.radius_m}m). "
                "No outward route is physically feasible from a flooded location. "
                "Provide an origin outside the flood area."
            ),
        )

    # ---- snap origin ----
    try:
        node_a = get_nearest_node(G_work, req.point_a.lat, req.point_a.lon)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    # ---- nearest facility (distance) ----
    baseline_hit = find_nearest_facility(G_work,   node_a, snapped_facilities)
    crisis_hit   = find_nearest_facility(G_crisis, node_a, snapped_facilities)

    # ---- build path hit with incrementing coord IDs ----
    # ID format: fac-{pass_num:02d}-{coord_num:03d}
    #   pass 01 = baseline, pass 02 = crisis
    def _build_path_hit(
        hit: Optional[Dict],
        G_pass: nx.MultiDiGraph,
        pass_num: int,
    ) -> Optional[RoutePathHit]:
        if hit is None:
            return None
        try:
            raw_path = nx.shortest_path(G_pass, node_a, hit["node"], weight="length")
            path_coords = get_detailed_path_coords(G_pass, raw_path)
        except (nx.NetworkXNoPath, nx.NodeNotFound, Exception) as exc:
            log.warning("Could not extract path for '%s': %s", hit["facility_id"], exc)
            path_coords = []
        return RoutePathHit(
            facility_id=hit["facility_id"],
            name=hit["name"],
            dist_m=hit["dist_m"],
            path=[
                RouteCoord(
                    id=f"fac-{pass_num:02d}-{i + 1:03d}",
                    lat=c["lat"],
                    lon=c["lon"],
                )
                for i, c in enumerate(path_coords)
            ],
        )

    baseline_route = _build_path_hit(baseline_hit, G_work,   pass_num=1)
    crisis_route   = _build_path_hit(crisis_hit,   G_crisis, pass_num=2)

    return RouteResponse(
        baseline=baseline_route,
        crisis=crisis_route,
    )


@app.post("/simulate", response_model=SimulateResponse, tags=["Analysis"])
def simulate(req: SimulateRequest) -> SimulateResponse:
    """
    **Full city-wide mock-flood simulation.**

    Downloads (or reuses cached) road network, fetches all hospitals & schools
    from OSM, applies the flood mask, and runs dual-pass Dijkstra for every
    facility.  Returns the complete state table.
    """
    try:
        G, epsg = _get_or_load_graph(req.place_name)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))

    # Resolve hub
    hub_lat = req.hub.lat if req.hub else _DEFAULT_HUB_LAT
    hub_lon = req.hub.lon if req.hub else _DEFAULT_HUB_LON

    # Apply flood + build crisis graph
    try:
        G_work, G_crisis, n_blocked, flood_used = _prepare_graphs(
            G, epsg, req.flood, hub_lat, hub_lon
        )
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))

    # Fetch facilities
    try:
        facilities_gdf = fetch_facilities_from_osm(req.place_name, epsg)
    except Exception:
        # Fallback to hard-coded sample set
        import sys
        from pathlib import Path

        sys.path.insert(0, str(Path(__file__).parent))
        from main import build_fallback_gdf  # type: ignore[import]
        facilities_gdf = build_fallback_gdf(epsg)

    # Hub node
    hub_node = find_hub_node(G_work, hub_lat, hub_lon)

    # Warn if hub node is inside the flood zone
    sim_warnings: List[str] = []
    try:
        from shapely.geometry import Point as _Point
        from pyproj import Transformer as _T
        _tr = _T.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True)
        _hx, _hy = _tr.transform(hub_lon, hub_lat)
        _fcx, _fcy = _tr.transform(flood_used.center_lon, flood_used.center_lat)
        from shapely.geometry import Point as _Pt
        _flood_poly = _Pt(_fcx, _fcy).buffer(flood_used.radius_m)
        if _flood_poly.contains(_Pt(_hx, _hy)):
            sim_warnings.append(
                f"Hub ({hub_lat}, {hub_lon}) is INSIDE the flood zone "
                f"(center={flood_used.center_lat},{flood_used.center_lon}, r={flood_used.radius_m}m). "
                "All facilities routing through the hub will appear CUT_OFF. "
                "Move the hub outside the flood area for meaningful results."
            )
            log.warning("Hub node is inside the flood zone — results will be unreliable.")
    except Exception as _exc:
        log.debug("Hub-in-flood check failed (non-fatal): %s", _exc)

    # Dual-pass analysis
    results = run_dual_pass_dijkstra(G_work, G_crisis, facilities_gdf, hub_node)

    # Optionally write to disk
    if req.save_to_disk:
        generate_state_table(results)

    # Build summary counts (over full unfiltered results)
    summary: Dict[str, int] = {}
    for r in results:
        summary[r["status"]] = summary.get(r["status"], 0) + 1

    # ----- Filter by status -----
    filtered = results
    if req.status_filter:
        allowed = {s.upper() for s in req.status_filter}
        filtered = [r for r in filtered if r["status"] in allowed]

    # ----- Sort -----
    _SORT_KEYS = {
        "baseline_dist_m": lambda r: (r.get("baseline_dist_m") is None, r.get("baseline_dist_m") or 0),
        "flood_dist_m":    lambda r: (r.get("flood_dist_m") is None,    r.get("flood_dist_m")    or 0),
        "detour_factor":   lambda r: (r["detour_factor"] == "INF",      0 if r["detour_factor"] == "INF" else r["detour_factor"]),
        "status":          lambda r: {"CUT_OFF": 0, "LIMITED_ACCESS": 1, "FULLY_ACCESSIBLE": 2}.get(r["status"], 99),
    }
    sort_key = _SORT_KEYS.get(req.sort_by, _SORT_KEYS["baseline_dist_m"])
    filtered = sorted(filtered, key=sort_key)

    # ----- top_n slice -----
    if req.top_n:
        filtered = filtered[: req.top_n]

    facilities_out = [
        FacilityResult(
            facility_id=r["facility_id"],
            name=r["name"],
            type=r["type"],
            lat=r["lat"],
            lon=r["lon"],
            nearest_node=r.get("nearest_node"),
            baseline_dist_m=r.get("baseline_dist_m"),
            flood_dist_m=r.get("flood_dist_m"),
            detour_factor=None if r["detour_factor"] == "INF" else r["detour_factor"],
            status=r["status"],
        )
        for r in filtered
    ]

    return SimulateResponse(
        place_name=req.place_name,
        hub=Coords(lat=hub_lat, lon=hub_lon),
        flood_center=Coords(lat=flood_used.center_lat, lon=flood_used.center_lon),
        flood_radius_m=flood_used.radius_m,
        total_facilities=len(results),
        edges_blocked=n_blocked,
        summary=summary,
        warnings=sim_warnings,
        facilities=facilities_out,
    )


# ---------------------------------------------------------------------------
# Flood infrastructure extraction models
# ---------------------------------------------------------------------------

class FloodInfraRequest(BaseModel):
    """
    Request for critical-infrastructure extraction within a circular flood extent.
    """
    center_lat: float = Field(
        ...,
        ge=-90.0, le=90.0,
        description="Latitude of the flood circle centre (WGS-84 decimal degrees).",
        examples=[19.0330],
    )
    center_lon: float = Field(
        ...,
        ge=-180.0, le=180.0,
        description="Longitude of the flood circle centre (WGS-84 decimal degrees).",
        examples=[73.0297],
    )
    radius_m: float = Field(
        500.0,
        gt=0,
        description="Radius of the flood zone in metres.",
        examples=[1000.0],
    )
    output_dir: str = Field(
        ".",
        description="Server-side directory where GeoJSON and CSV files are saved.",
    )
    output_prefix: str = Field(
        "flood_infrastructure",
        description="Filename prefix (without extension) for both output files.",
    )
    max_retries: int = Field(4, ge=1, le=10, description="Overpass retry attempts per tag query.")
    retry_sleep: float = Field(10.0, ge=1.0, description="Base retry sleep in seconds (doubles each attempt).")
    tag_sleep: float = Field(1.5, ge=0.0, description="Polite delay (seconds) between successive tag queries.")


class InfraFeature(BaseModel):
    """A single extracted infrastructure feature."""
    feature_id:   str
    name:         str
    feature_type: str
    latitude:     float
    longitude:    float
    flood_risk:   bool = True


class FloodInfraResponse(BaseModel):
    """Response from the flood infrastructure extraction endpoint."""
    total_features: int
    summary:        Dict[str, int] = Field(description="Count of each feature_type found.")
    geojson_path:   str            = Field(description="Server-side path to the saved GeoJSON file.")
    csv_path:       str            = Field(description="Server-side path to the saved CSV file.")
    geojson:        Dict[str, Any] = Field(description="Full GeoJSON FeatureCollection.")
    features:       List[InfraFeature]


# ---------------------------------------------------------------------------
# Flood infrastructure endpoint
# ---------------------------------------------------------------------------

@app.post("/flood-infrastructure", response_model=FloodInfraResponse, tags=["Analysis"])
def flood_infrastructure(req: FloodInfraRequest) -> FloodInfraResponse:
    """
    **Flood-extent critical infrastructure extractor.**

    Accepts a circular flood extent defined by a **centre coordinate**
    (``center_lat``, ``center_lon``) and a **radius in metres** (``radius_m``)
    and queries the OpenStreetMap Overpass API to extract all critical
    infrastructure nodes and buildings within that extent.

    A separate Overpass query is issued for each of the following OSM tags:

    | Tag | Feature type |
    |-----|--------------|
    | amenity=hospital | hospital |
    | amenity=school | school |
    | amenity=police | police |
    | amenity=fire_station | fire_station |
    | amenity=pharmacy | pharmacy |
    | amenity=place_of_worship | place_of_worship |
    | amenity=community_centre | community_centre |
    | building=residential | residential_building |
    | building=commercial | commercial_building |
    | building=yes | building |

    For **way** and **relation** elements (polygon buildings), the centroid is
    computed via Shapely and used as the representative coordinate point.

    All extracted features receive ``flood_risk=true`` because they fall
    within the supplied flood extent.  Results are saved as both a **GeoJSON**
    file and a **CSV** file server-side and also returned in the response body.
    """
    import traceback as _tb

    try:
        bbox, flood_poly = circle_to_bbox_and_poly(
            req.center_lat, req.center_lon, req.radius_m
        )
        result = query_flood_infrastructure(
            bbox=bbox,
            geojson_polygon=None,
            _flood_shape=flood_poly,
            output_dir=req.output_dir,
            output_prefix=req.output_prefix,
            max_retries=req.max_retries,
            retry_sleep=req.retry_sleep,
            tag_sleep=req.tag_sleep,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    except Exception as exc:
        log.error("Unexpected error in /flood-infrastructure: %s\n%s", exc, _tb.format_exc())
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))

    return FloodInfraResponse(
        total_features=len(result.features),
        summary=result.summary,
        geojson_path=str(result.geojson_path),
        csv_path=str(result.csv_path),
        geojson=result.geojson,
        features=[
            InfraFeature(
                feature_id=f["feature_id"],
                name=f["name"],
                feature_type=f["feature_type"],
                latitude=f["latitude"],
                longitude=f["longitude"],
                flood_risk=True,
            )
            for f in result.features
        ],
    )


@app.delete("/cache/{place_name}", tags=["Meta"])
def evict_cache(place_name: str) -> JSONResponse:
    """Remove a graph from the in-process cache.  The next request will re-download it."""
    decoded = place_name.replace("__", ", ")  # simple encoding for commas in URL path
    with _cache_lock:
        if decoded in _graph_cache:
            del _graph_cache[decoded]
            return JSONResponse({"evicted": decoded})
    raise HTTPException(status_code=404, detail=f"'{decoded}' not in cache")


# ---------------------------------------------------------------------------
# Dev runner
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import os
    import uvicorn

    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("api:app", host="0.0.0.0", port=port, reload=False, log_level="info")
