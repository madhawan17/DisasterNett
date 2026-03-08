"""
utils_geo.py — Geospatial helper functions for the Lifeline Engine.

Provides:
  - Edge geometry retrieval from OSMnx MultiDiGraphs
  - UTM projection utilities
  - Nearest-node snapping
  - Flood polygon construction
  - Facility loading from file or OSMnx query
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import List, Optional, Tuple

import geopandas as gpd
import networkx as nx
import osmnx as ox
import pandas as pd
from pyproj import CRS, Transformer
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import transform as shapely_transform

from log_config import get_logger

log = get_logger(__name__)


# ---------------------------------------------------------------------------
# Edge geometry
# ---------------------------------------------------------------------------

def get_edge_geometry(G: nx.MultiDiGraph, u: int, v: int, k: int) -> LineString:
    """Return the Shapely LineString geometry for edge (u, v, k).

    OSMnx stores a ``geometry`` attribute on most edges.  When it is absent
    (e.g. straight segments between adjacent nodes) we synthesise a two-point
    LineString from the node x/y coordinates stored in the graph.

    Parameters
    ----------
    G:
        A projected (metre-based CRS) OSMnx MultiDiGraph.
    u, v, k:
        Edge identifiers (origin node, destination node, parallel-edge key).

    Returns
    -------
    LineString
        Shapely geometry for the edge in the graph's CRS.
    """
    data = G[u][v][k]
    if "geometry" in data:
        return data["geometry"]

    # Fallback: build straight line from node coordinates
    x_u, y_u = G.nodes[u]["x"], G.nodes[u]["y"]
    x_v, y_v = G.nodes[v]["x"], G.nodes[v]["y"]
    return LineString([(x_u, y_u), (x_v, y_v)])


# ---------------------------------------------------------------------------
# Projection helpers
# ---------------------------------------------------------------------------

def project_graph_to_utm(G: nx.MultiDiGraph) -> Tuple[nx.MultiDiGraph, int]:
    """Project an OSMnx graph to its best-fit UTM CRS.

    Parameters
    ----------
    G:
        Unprojected (WGS-84 / EPSG:4326) OSMnx MultiDiGraph.

    Returns
    -------
    G_proj : nx.MultiDiGraph
        Graph reprojected to a metric UTM zone.
    epsg : int
        The EPSG code of the target CRS (e.g. 32643 for UTM zone 43N).
    """
    G_proj = ox.project_graph(G)
    crs = CRS.from_user_input(G_proj.graph["crs"])
    epsg = crs.to_epsg()
    log.info("Graph projected to EPSG:%s", epsg)
    return G_proj, epsg


# ---------------------------------------------------------------------------
# Nearest-node snapping
# ---------------------------------------------------------------------------

def get_nearest_node(G: nx.MultiDiGraph, lat: float, lon: float) -> int:
    """Return the graph node id nearest to a WGS-84 (lat, lon) coordinate.

    ``osmnx.distance.nearest_nodes`` expects X/Y **in the graph's own CRS**.
    For a projected (UTM, metre-based) graph the query point must be
    reprojected from WGS-84 before the call; otherwise every point snaps to
    the same wrong node near the UTM coordinate-system origin.

    Parameters
    ----------
    G:
        An OSMnx MultiDiGraph, projected or geographic.
    lat, lon:
        WGS-84 latitude and longitude of the query point.

    Returns
    -------
    int
        OSM node id of the nearest graph node.
    """
    graph_crs_raw = G.graph.get("crs")

    if graph_crs_raw is not None:
        graph_crs = CRS.from_user_input(graph_crs_raw)
        if not graph_crs.is_geographic:
            # Projected CRS (e.g. UTM) — reproject the query point
            transformer = Transformer.from_crs(
                "EPSG:4326", graph_crs, always_xy=True
            )
            x_proj, y_proj = transformer.transform(lon, lat)
            return ox.distance.nearest_nodes(G, X=x_proj, Y=y_proj)

    # Geographic CRS (lon/lat degrees) — pass directly
    return ox.distance.nearest_nodes(G, X=lon, Y=lat)


# ---------------------------------------------------------------------------
# Flood polygon construction
# ---------------------------------------------------------------------------

def flood_circle(
    center_lat: float,
    center_lon: float,
    radius_m: float = 500.0,
    crs_epsg: int = 32643,
) -> Polygon:
    """Create a circular flood polygon centred on (center_lat, center_lon).

    The circle is constructed in the projected (metre) CRS so that
    *radius_m* is exact, then returned in that same CRS for direct
    intersection with a projected road graph.

    Parameters
    ----------
    center_lat, center_lon:
        WGS-84 centre of the flood zone.
    radius_m:
        Flood radius in metres (default 500 m).
    crs_epsg:
        EPSG code of the target projected CRS (must use metres).

    Returns
    -------
    Polygon
        Shapely polygon in the projected CRS.
    """
    # Project the centre point from WGS-84 to the target UTM zone
    transformer = Transformer.from_crs("EPSG:4326", f"EPSG:{crs_epsg}", always_xy=True)
    x_proj, y_proj = transformer.transform(center_lon, center_lat)

    circle: Polygon = Point(x_proj, y_proj).buffer(radius_m)
    log.info(
        "Flood circle: centre (%.6f, %.6f), radius %.0f m, CRS EPSG:%s",
        center_lat,
        center_lon,
        radius_m,
        crs_epsg,
    )
    return circle


# ---------------------------------------------------------------------------
# Facility loading
# ---------------------------------------------------------------------------

def load_facilities_from_file(geojson_path: str | Path, crs_epsg: int) -> gpd.GeoDataFrame:
    """Load critical facilities from a GeoJSON file.

    The input file must contain at minimum:
      - A point (or polygon) geometry column.
      - Optionally ``facility_id`` and ``type`` columns; these are
        auto-generated if absent.

    Parameters
    ----------
    geojson_path:
        Path to the GeoJSON file.
    crs_epsg:
        EPSG code to reproject facilities into (should match graph CRS).

    Returns
    -------
    GeoDataFrame
        Points in the projected CRS with columns:
        ``facility_id``, ``type``, ``name``, ``geometry``.
    """
    gdf = gpd.read_file(geojson_path)

    # Ensure point geometries (use centroid for polygons / multipolygons)
    gdf["geometry"] = gdf["geometry"].apply(
        lambda geom: geom.centroid if geom.geom_type != "Point" else geom
    )

    # Normalise required columns
    if "facility_id" not in gdf.columns:
        gdf["facility_id"] = [f"FAC_{i:04d}" for i in range(len(gdf))]
    if "type" not in gdf.columns:
        gdf["type"] = "unknown"
    if "name" not in gdf.columns:
        gdf["name"] = gdf["facility_id"]

    # Reproject to match the road graph CRS
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:4326")
    gdf = gdf.to_crs(epsg=crs_epsg)

    return gdf[["facility_id", "type", "name", "geometry"]].reset_index(drop=True)


def fetch_facilities_from_osm(
    place_name: str,
    crs_epsg: int,
    amenity_tags: Optional[List[str]] = None,
) -> gpd.GeoDataFrame:
    """Download critical facilities from OpenStreetMap for a given area.

    Queries OSMnx for hospital and school amenities within the place boundary,
    reduces polygon/MultiPolygon results to their centroids, and reprojects
    to the specified CRS.

    Parameters
    ----------
    place_name:
        Human-readable place name, e.g. ``"Navi Mumbai, India"``.
    crs_epsg:
        Target projected EPSG code (must use metres).
    amenity_tags:
        List of OSM amenity values to fetch.  Defaults to
        ``["hospital", "school"]``.

    Returns
    -------
    GeoDataFrame
        Point features with columns:
        ``facility_id``, ``type``, ``name``, ``geometry``.

    Raises
    ------
    RuntimeError
        If no features are retrieved for any of the requested tags.
    """
    # OSM amenity values accepted for each logical type:
    #   hospital     → amenity=hospital
    #   police       → amenity=police
    #   fire_station → amenity=fire_station
    #   school       → amenity=school
    if amenity_tags is None:
        amenity_tags = ["hospital", "school", "police", "fire_station"]

    frames: List[gpd.GeoDataFrame] = []

    for tag in amenity_tags:
        log.info("Fetching OSM amenity: %s in '%s' …", tag, place_name)
        try:
            gdf = ox.features_from_place(place_name, tags={"amenity": tag})
        except Exception as exc:  # pragma: no cover
            log.warning("OSMnx query failed for tag '%s': %s", tag, exc)
            continue

        if gdf.empty:
            log.warning("No features returned for amenity='%s'", tag)
            continue

        # Keep only essential columns
        keep = [c for c in ["name", "geometry"] if c in gdf.columns]
        gdf = gdf[keep].copy()
        gdf["type"] = tag

        # Reduce to point geometry
        gdf["geometry"] = gdf["geometry"].apply(
            lambda geom: geom.centroid if geom is not None and geom.geom_type != "Point" else geom
        )
        gdf = gdf[gdf["geometry"].notna()]
        frames.append(gdf)

    if not frames:
        raise RuntimeError(
            f"No facility features retrieved from OSM for '{place_name}'. "
            "Check internet connectivity or OSMnx rate limits."
        )

    combined: gpd.GeoDataFrame = pd.concat(frames, ignore_index=True)

    # Assign stable facility IDs
    combined["facility_id"] = [f"FAC_{i:04d}" for i in range(len(combined))]
    if "name" not in combined.columns:
        combined["name"] = combined["facility_id"]
    else:
        combined["name"] = combined["name"].fillna(combined["facility_id"])

    # Ensure WGS-84 source CRS before reprojecting
    combined = combined.set_crs("EPSG:4326", allow_override=True)
    combined = combined.to_crs(epsg=crs_epsg)

    log.info("Total facilities fetched: %d", len(combined))
    return combined[["facility_id", "type", "name", "geometry"]].reset_index(drop=True)


# ---------------------------------------------------------------------------
# Utility: lat/lon columns from projected GeoDataFrame
# ---------------------------------------------------------------------------

def extract_wgs84_coords(
    gdf: gpd.GeoDataFrame,
    crs_epsg: Optional[int] = None,  # kept for API compat; CRS is read from gdf
) -> gpd.GeoDataFrame:
    """Add ``lat`` and ``lon`` columns (WGS-84) to a projected GeoDataFrame.

    Parameters
    ----------
    gdf:
        GeoDataFrame in a projected metric CRS.
    crs_epsg:
        Ignored — the CRS is determined from ``gdf.crs`` directly.  Retained
        for backwards compatibility.

    Returns
    -------
    GeoDataFrame
        Original frame with additional ``lat`` and ``lon`` float columns.
    """
    gdf_wgs = gdf.to_crs("EPSG:4326")
    gdf = gdf.copy()
    gdf["lon"] = gdf_wgs.geometry.x
    gdf["lat"] = gdf_wgs.geometry.y
    return gdf
