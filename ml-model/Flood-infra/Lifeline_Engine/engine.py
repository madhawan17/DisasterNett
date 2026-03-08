"""
engine.py — Core analysis engine for the Lifeline Accessibility module.

Pipeline
--------
1. load_network         – Download & project the OSMnx drive graph.
2. apply_flood_mask     – Tag road edges that intersect flood polygons.
3. build_crisis_graph   – Return a subgraph view with blocked edges removed.
4. find_hub_node        – Snap a lat/lon "hub" to the nearest graph node.
5. run_dual_pass_dijkstra – Baseline vs. crisis shortest-path analysis.
6. generate_state_table – Serialise results to JSON (and optionally CSV).
"""

from __future__ import annotations

import json
import logging
import math
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import geopandas as gpd
import networkx as nx
import osmnx as ox
import pandas as pd
from shapely.geometry import Polygon
from shapely.ops import unary_union

from log_config import get_logger
from utils_geo import (
    extract_wgs84_coords,
    get_edge_geometry,
    get_nearest_node,
    project_graph_to_utm,
)

log = get_logger(__name__)

# ---------------------------------------------------------------------------
# Status thresholds
# ---------------------------------------------------------------------------
DETOUR_THRESHOLD = 1.2          # Detour factor above which access is LIMITED


# ---------------------------------------------------------------------------
# 1. Network ingestion
# ---------------------------------------------------------------------------

def load_network(
    place_name: str = "Navi Mumbai, India",
) -> Tuple[nx.MultiDiGraph, int]:
    """Download the drive network for *place_name* and project it to UTM.

    Parameters
    ----------
    place_name:
        Nominatim place string, e.g. ``"Navi Mumbai, India"``.

    Returns
    -------
    G : nx.MultiDiGraph
        Projected (metre-based UTM) road network with ``length`` weights on
        every edge (added automatically by OSMnx).
    epsg : int
        The EPSG code of the projected CRS used by *G*.
    """
    log.info("Downloading drive network for '%s' …", place_name)
    G_raw: nx.MultiDiGraph = ox.graph_from_place(
        place_name,
        network_type="drive",
        simplify=True,
    )
    log.info(
        "Raw graph: %d nodes, %d edges",
        G_raw.number_of_nodes(),
        G_raw.number_of_edges(),
    )

    G_proj, epsg = project_graph_to_utm(G_raw)
    log.info(
        "Projected graph (EPSG:%s): %d nodes, %d edges",
        epsg,
        G_proj.number_of_nodes(),
        G_proj.number_of_edges(),
    )
    return G_proj, epsg


# ---------------------------------------------------------------------------
# 2. Flood mask
# ---------------------------------------------------------------------------

def apply_flood_mask(
    G: nx.MultiDiGraph,
    flood_polygons: List[Polygon],
) -> nx.MultiDiGraph:
    """Mark all graph edges that intersect any flood polygon as *blocked*.

    The function mutates the edge data **in-place** by setting a boolean
    ``blocked`` attribute (``True``) on affected edges.  Unaffected edges
    receive ``blocked = False`` to ensure the attribute is always present.

    Parameters
    ----------
    G:
        Projected OSMnx MultiDiGraph (metres CRS).
    flood_polygons:
        List of Shapely Polygon objects in the **same CRS** as *G*.

    Returns
    -------
    nx.MultiDiGraph
        The same graph object with updated edge attributes.
    """
    if not flood_polygons:
        log.warning("apply_flood_mask called with an empty flood_polygons list.")
        return G

    flood_union = unary_union(flood_polygons)
    blocked_count = 0

    for u, v, k, data in G.edges(keys=True, data=True):
        edge_geom = get_edge_geometry(G, u, v, k)
        is_blocked = edge_geom.intersects(flood_union)
        data["blocked"] = is_blocked
        if is_blocked:
            blocked_count += 1

    total_edges = G.number_of_edges()
    log.info(
        "Flood mask applied: %d / %d edges blocked (%.1f%%)",
        blocked_count,
        total_edges,
        100.0 * blocked_count / total_edges if total_edges else 0,
    )
    return G


# ---------------------------------------------------------------------------
# 3. Crisis subgraph
# ---------------------------------------------------------------------------

def build_crisis_graph(G: nx.MultiDiGraph) -> nx.MultiDiGraph:
    """Return a subgraph view of *G* with all ``blocked`` edges removed.

    Uses ``nx.restricted_view`` to avoid copying the full graph data — the
    returned view is memory-efficient and reflects the original graph's node
    and attribute data by reference.

    Parameters
    ----------
    G:
        Graph whose edges have been tagged with ``blocked`` by
        :func:`apply_flood_mask`.

    Returns
    -------
    nx.MultiDiGraph
        A read-only view of *G* excluding blocked edges.  Shortest-path
        algorithms work normally on this view.
    """
    blocked_edges = [
        (u, v, k)
        for u, v, k, data in G.edges(keys=True, data=True)
        if data.get("blocked", False)
    ]
    # restricted_view accepts sets of *nodes* and *edges* to hide
    # For MultiDiGraph we pass edge triples (u, v, k)
    G_crisis: nx.MultiDiGraph = nx.restricted_view(G, nodes=[], edges=blocked_edges)  # type: ignore[arg-type]
    log.info(
        "Crisis graph: %d nodes, %d edges (removed %d blocked edges)",
        G_crisis.number_of_nodes(),
        G_crisis.number_of_edges(),
        len(blocked_edges),
    )
    return G_crisis


# ---------------------------------------------------------------------------
# 4. Hub node
# ---------------------------------------------------------------------------

def find_hub_node(
    G: nx.MultiDiGraph,
    hub_lat: float = 19.0330,
    hub_lon: float = 73.0297,
) -> int:
    """Snap a geographic hub coordinate to the nearest graph node.

    Parameters
    ----------
    G:
        Projected OSMnx MultiDiGraph.
    hub_lat, hub_lon:
        WGS-84 latitude / longitude of the hub (default: Navi Mumbai centre).

    Returns
    -------
    int
        OSM node id of the closest node in *G*.
    """
    node_id = get_nearest_node(G, hub_lat, hub_lon)
    log.info("Hub snapped to node %d (lat=%.5f, lon=%.5f)", node_id, hub_lat, hub_lon)
    return node_id


# ---------------------------------------------------------------------------
# 5a. Facility snapping & nearest-facility search
# ---------------------------------------------------------------------------

def snap_facilities_to_nodes(
    G: nx.MultiDiGraph,
    facilities_gdf: gpd.GeoDataFrame,
) -> List[Dict[str, Any]]:
    """Snap every facility in *facilities_gdf* to the nearest graph node.

    Parameters
    ----------
    G:
        Projected OSMnx MultiDiGraph.
    facilities_gdf:
        GeoDataFrame with columns ``facility_id``, ``name``, ``type``,
        ``geometry`` (points) plus ``lat`` / ``lon`` (WGS-84).

    Returns
    -------
    List[Dict]
        One dict per facility with keys:
        ``node``, ``facility_id``, ``name``, ``type``, ``lat``, ``lon``.
        Facilities that cannot be snapped are silently dropped.
    """
    snapped: List[Dict[str, Any]] = []
    for _, row in facilities_gdf.iterrows():
        try:
            node = get_nearest_node(G, row["lat"], row["lon"])
            snapped.append(
                {
                    "node": node,
                    "facility_id": row["facility_id"],
                    "name": row.get("name", row["facility_id"]),
                    "type": row["type"],
                    "lat": round(row["lat"], 6),
                    "lon": round(row["lon"], 6),
                }
            )
        except Exception as exc:
            log.warning("Could not snap facility '%s': %s", row["facility_id"], exc)
    return snapped


def find_nearest_facility(
    G: nx.MultiDiGraph,
    origin_node: int,
    snapped_facilities: List[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """Return the nearest *reachable* facility from *origin_node* in *G*.

    Uses a single-source Dijkstra expansion from *origin_node* so all
    facility targets are evaluated in one pass — O(E log V) regardless of
    how many facilities there are.

    Parameters
    ----------
    G:
        Projected road graph (baseline or crisis subgraph).
    origin_node:
        Starting graph node (the snapped location of the user / incident).
    snapped_facilities:
        Output of :func:`snap_facilities_to_nodes`.

    Returns
    -------
    Dict or None
        The closest reachable facility dict enriched with ``dist_m``, or
        ``None`` if no facility is reachable.
    """
    if not snapped_facilities:
        return None

    try:
        lengths: Dict[int, float] = nx.single_source_dijkstra_path_length(
            G, origin_node, weight="length"
        )
    except (nx.NodeNotFound, nx.exception.NetworkXError):
        return None

    best: Optional[Dict[str, Any]] = None
    best_dist = math.inf

    for fac in snapped_facilities:
        node = fac["node"]
        dist = lengths.get(node, math.inf)
        if dist < best_dist:
            best_dist = dist
            best = {**fac, "dist_m": round(dist, 1)}

    return best  # None if all facilities were unreachable (inf)


# ---------------------------------------------------------------------------
# 5b. Dual-pass Dijkstra (used by /simulate — hub-centric)
# ---------------------------------------------------------------------------

def _safe_shortest_path_length(
    G: nx.MultiDiGraph, source: int, target: int, weight: str = "length"
) -> Optional[float]:
    """Run Dijkstra; return ``None`` on any path-not-found or node-missing error."""
    try:
        return nx.shortest_path_length(G, source=source, target=target, weight=weight)
    except (nx.NetworkXNoPath, nx.NodeNotFound, nx.exception.NetworkXError):
        return None


def run_dual_pass_dijkstra(
    G_baseline: nx.MultiDiGraph,
    G_crisis: nx.MultiDiGraph,
    facilities_gdf: gpd.GeoDataFrame,
    hub_node: int,
) -> List[Dict[str, Any]]:
    """Run baseline and crisis shortest-path analyses for every facility.

    For each facility the function:

    1. Snaps the facility point to the nearest node in *G_baseline*.
    2. Computes the shortest-path distance to *hub_node* on the unmodified
       baseline graph (``baseline_dist_m``).
    3. Computes the same distance on the flood-aware crisis graph
       (``flood_dist_m``).
    4. Derives ``detour_factor = flood_dist_m / baseline_dist_m``.
    5. Assigns one of three status labels:

       * ``FULLY_ACCESSIBLE``  — path exists, detour_factor < 1.2
       * ``LIMITED_ACCESS``    — path exists, detour_factor ≥ 1.2
       * ``CUT_OFF``           — no path exists in the crisis graph

    Parameters
    ----------
    G_baseline:
        Full (unflooded) projected drive graph.
    G_crisis:
        Crisis subgraph with blocked edges removed.
    facilities_gdf:
        GeoDataFrame with columns ``facility_id``, ``type``, ``name``,
        ``geometry`` (points in the same projected CRS as *G_baseline*).
    hub_node:
        Graph node id of the central hub / reference point.

    Returns
    -------
    List[Dict]
        One record per facility.  Keys:
        ``facility_id``, ``name``, ``type``, ``lat``, ``lon``,
        ``nearest_node``, ``baseline_dist_m``, ``flood_dist_m``,
        ``detour_factor``, ``status``.
    """
    # Attach WGS-84 lat/lon columns for the output table
    facilities_with_coords = extract_wgs84_coords(facilities_gdf)

    results: List[Dict[str, Any]] = []

    for _, row in facilities_with_coords.iterrows():
        fac_id: str = row["facility_id"]
        fac_type: str = row["type"]
        fac_name: str = row.get("name", fac_id)
        lat: float = row["lat"]
        lon: float = row["lon"]

        # Snap facility to nearest node
        try:
            fac_node = get_nearest_node(G_baseline, lat, lon)
        except Exception as exc:
            log.warning("Could not snap facility '%s' to graph: %s", fac_id, exc)
            results.append(_make_error_record(fac_id, fac_name, fac_type, lat, lon))
            continue

        # --- Baseline pass ---
        baseline_dist = _safe_shortest_path_length(G_baseline, fac_node, hub_node)

        # --- Crisis pass ---
        flood_dist = _safe_shortest_path_length(G_crisis, fac_node, hub_node)

        # --- Classify ---
        #
        # Truth table:
        #  baseline | flood    | meaning
        #  ---------|----------|-----------------------------------------
        #  None     | any      | Facility was already unreachable before flood
        #  0        | 0        | Facility IS the hub node — always accessible
        #  0        | None     | Facility was at hub but flood cut it off
        #  > 0      | None     | Flooded → CUT_OFF
        #  > 0      | > 0      | Normal case — compute detour_factor
        #
        if baseline_dist is None:
            # Never reachable even without flood; mark as pre-existing CUT_OFF
            status = "CUT_OFF"
            detour_factor = math.inf
        elif flood_dist is None:
            status = "CUT_OFF"
            detour_factor = math.inf
        elif baseline_dist == 0 and flood_dist == 0:
            # Facility is co-located with the hub
            detour_factor = 1.0
            status = "FULLY_ACCESSIBLE"
        elif baseline_dist == 0 and flood_dist > 0:
            # Only possible if hub node is itself flooded / rerouted
            detour_factor = math.inf
            status = "LIMITED_ACCESS"
        else:
            detour_factor = flood_dist / baseline_dist
            status = (
                "FULLY_ACCESSIBLE" if detour_factor < DETOUR_THRESHOLD else "LIMITED_ACCESS"
            )

        log.debug(
            "%s | node=%d | baseline=%.0f m | flood=%s m | factor=%.3f | %s",
            fac_id,
            fac_node,
            baseline_dist or -1,
            f"{flood_dist:.0f}" if flood_dist is not None else "∞",
            detour_factor if not math.isinf(detour_factor) else float("inf"),
            status,
        )

        results.append(
            {
                "facility_id": fac_id,
                "name": fac_name,
                "type": fac_type,
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "nearest_node": fac_node,
                "baseline_dist_m": round(baseline_dist, 1) if baseline_dist is not None else None,
                "flood_dist_m": round(flood_dist, 1) if flood_dist is not None else None,
                "detour_factor": round(detour_factor, 4) if not math.isinf(detour_factor) else "INF",
                "status": status,
            }
        )

    _log_summary(results)
    return results


def _make_error_record(
    fac_id: str, fac_name: str, fac_type: str, lat: float, lon: float
) -> Dict[str, Any]:
    return {
        "facility_id": fac_id,
        "name": fac_name,
        "type": fac_type,
        "lat": round(lat, 6),
        "lon": round(lon, 6),
        "nearest_node": None,
        "baseline_dist_m": None,
        "flood_dist_m": None,
        "detour_factor": "INF",
        "status": "CUT_OFF",
    }


def _log_summary(results: List[Dict[str, Any]]) -> None:
    counts: Dict[str, int] = {}
    for r in results:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    log.info("Analysis complete — %d facilities processed", len(results))
    for status, count in sorted(counts.items()):
        log.info("  %-20s: %d", status, count)


# ---------------------------------------------------------------------------
# 6. Output generation
# ---------------------------------------------------------------------------

def generate_state_table(
    results: List[Dict[str, Any]],
    output_path: str | Path = "state_table.json",
    also_csv: bool = True,
) -> Path:
    """Serialise the analysis results to ``state_table.json`` (and optionally CSV).

    Parameters
    ----------
    results:
        List of per-facility dicts returned by :func:`run_dual_pass_dijkstra`.
    output_path:
        Destination file path for the JSON output.
    also_csv:
        When ``True`` (default), also writes a ``.csv`` alongside the JSON.

    Returns
    -------
    Path
        Absolute path to the JSON file written.
    """
    output_path = Path(output_path).resolve()

    # JSON
    with output_path.open("w", encoding="utf-8") as fh:
        json.dump(results, fh, indent=2, ensure_ascii=False)
    log.info("State table written → %s", output_path)

    # CSV (optional)
    if also_csv:
        df = pd.DataFrame(results)
        csv_path = output_path.with_suffix(".csv")
        df.to_csv(csv_path, index=False)
        log.info("State table (CSV) written → %s", csv_path)

    return output_path


# ---------------------------------------------------------------------------
# 7. Globe-rendering helpers
# ---------------------------------------------------------------------------

def get_path_coords(
    G: nx.MultiDiGraph,
    path: List[int],
) -> List[Dict[str, float]]:
    """Convert a node-id sequence to a WGS-84 ``[{lat, lon}, ...]`` array.

    Parameters
    ----------
    G:
        Projected (or geographic) OSMnx graph whose nodes carry ``x`` / ``y``
        attributes in the graph's native CRS.
    path:
        Ordered list of node IDs as returned by :func:`nx.shortest_path`.

    Returns
    -------
    List[Dict[str, float]]
        Coordinate sequence suitable for deck.gl ``PathLayer``, Cesium
        ``PolylineGraphics``, or any other globe renderer.
    """
    from pyproj import CRS, Transformer

    if not path:
        return []

    graph_crs = CRS.from_user_input(G.graph.get("crs", "EPSG:4326"))
    if graph_crs.is_geographic:
        return [
            {"lat": round(G.nodes[n]["y"], 6), "lon": round(G.nodes[n]["x"], 6)}
            for n in path
        ]

    transformer = Transformer.from_crs(graph_crs, "EPSG:4326", always_xy=True)
    coords: List[Dict[str, float]] = []
    for n in path:
        data = G.nodes[n]
        lon, lat = transformer.transform(data["x"], data["y"])
        coords.append({"lat": round(lat, 6), "lon": round(lon, 6)})
    return coords


def get_detailed_path_coords(
    G: nx.MultiDiGraph,
    path: List[int],
) -> List[Dict[str, float]]:
    """Convert a node-id path to WGS-84 coords following actual road geometry.

    Unlike :func:`get_path_coords` which draws straight lines between nodes,
    this function reads the OSM ``geometry`` attribute of each traversed edge
    so curves and bends in the road are preserved.  Falls back to straight-line
    segments for edges without stored geometry.

    Parameters
    ----------
    G:
        Projected OSMnx MultiDiGraph (nodes and edges carry UTM x/y attrs).
    path:
        Ordered node-id sequence as returned by :func:`nx.shortest_path`.

    Returns
    -------
    List[Dict[str, float]]
        Dense WGS-84 coordinate sequence suitable for globe renderers that
        expect road-following polylines (deck.gl ``PathLayer``, Cesium, etc.).
    """
    from pyproj import CRS, Transformer

    if not path:
        return []

    graph_crs = CRS.from_user_input(G.graph.get("crs", "EPSG:4326"))
    is_geo = graph_crs.is_geographic
    transformer: Optional[Transformer] = None
    if not is_geo:
        transformer = Transformer.from_crs(graph_crs, "EPSG:4326", always_xy=True)

    def _proj_to_wgs84(raw_pts: List[Tuple[float, float]]) -> List[Dict[str, float]]:
        if transformer:
            return [
                {"lat": round(lat, 6), "lon": round(lon, 6)}
                for lon, lat in (transformer.transform(x, y) for x, y in raw_pts)
            ]
        return [{"lat": round(y, 6), "lon": round(x, 6)} for x, y in raw_pts]

    all_pts: List[Dict[str, float]] = []

    for i in range(len(path) - 1):
        u, v = path[i], path[i + 1]

        # Pick the lightest parallel edge (matches what shortest-path used)
        if v in G[u]:
            edges = G[u][v]
            k = min(edges, key=lambda k: edges[k].get("length", float("inf")))
            geom = get_edge_geometry(G, u, v, k)
        else:
            geom = None

        if geom is not None:
            seg_pts = _proj_to_wgs84(list(geom.coords))
        else:
            ud, vd = G.nodes[u], G.nodes[v]
            seg_pts = _proj_to_wgs84([(ud["x"], ud["y"]), (vd["x"], vd["y"])])

        # Avoid duplicating the junction point between consecutive segments
        if all_pts and seg_pts:
            seg_pts = seg_pts[1:]

        all_pts.extend(seg_pts)

    # If path is a single node, return that point
    if not all_pts and path:
        n = path[0]
        data = G.nodes[n]
        if transformer:
            lon, lat = transformer.transform(data["x"], data["y"])
            all_pts = [{"lat": round(lat, 6), "lon": round(lon, 6)}]
        else:
            all_pts = [{"lat": round(data["y"], 6), "lon": round(data["x"], 6)}]

    return all_pts



def get_blocked_edge_coords(
    G: nx.MultiDiGraph,
) -> List[List[Dict[str, float]]]:
    """Return each flood-blocked edge as a ``[[{lat, lon}, ...]]`` segment list.

    Each element is an ordered list of coordinate dicts tracing the road
    segment as stored in the OSM ``geometry`` attribute (or a straight line
    between the two endpoint nodes when no detailed geometry is available).

    Parameters
    ----------
    G:
        Projected OSMnx graph whose edges have been tagged ``blocked=True``
        by :func:`apply_flood_mask`.

    Returns
    -------
    List[List[Dict[str, float]]]
        Array of polyline segments — each segment is an array of WGS-84
        points.  Feed this directly into deck.gl ``PathLayer.data`` (one
        path per element) or Cesium ``PolylineCollection``.
    """
    from pyproj import CRS, Transformer

    graph_crs = CRS.from_user_input(G.graph.get("crs", "EPSG:4326"))
    is_geo = graph_crs.is_geographic

    transformer: Optional[Transformer] = None
    if not is_geo:
        transformer = Transformer.from_crs(graph_crs, "EPSG:4326", always_xy=True)

    def _to_pts(raw_pts: List[Tuple[float, float]]) -> List[Dict[str, float]]:
        if transformer:
            return [
                {"lat": round(lat, 6), "lon": round(lon, 6)}
                for lon, lat in (transformer.transform(x, y) for x, y in raw_pts)
            ]
        return [{"lat": round(y, 6), "lon": round(x, 6)} for x, y in raw_pts]

    segments: List[List[Dict[str, float]]] = []
    seen: set = set()

    for u, v, k, data in G.edges(keys=True, data=True):
        if not data.get("blocked", False):
            continue
        # Deduplicate antiparallel edges (u→v and v→u both marked blocked)
        edge_key = (min(u, v), max(u, v), k)
        if edge_key in seen:
            continue
        seen.add(edge_key)

        geom = get_edge_geometry(G, u, v, k)
        if geom is not None:
            raw_pts = list(geom.coords)
        else:
            ud, vd = G.nodes[u], G.nodes[v]
            raw_pts = [(ud["x"], ud["y"]), (vd["x"], vd["y"])]

        segments.append(_to_pts(raw_pts))

    log.debug("get_blocked_edge_coords: %d unique blocked segments", len(segments))
    return segments


def get_flood_polygon_coords(
    flood_poly,
    src_epsg: int,
) -> List[Dict[str, float]]:
    """Reproject a Shapely flood polygon exterior to WGS-84 coord list.

    Parameters
    ----------
    flood_poly:
        Shapely ``Polygon`` in *src_epsg* (typically a UTM zone).
    src_epsg:
        EPSG code of the polygon's CRS.

    Returns
    -------
    List[Dict[str, float]]
        Closed ring of WGS-84 points — the first and last point are identical
        so standard globe renderers can draw a closed polygon.
    """
    from pyproj import Transformer

    transformer = Transformer.from_crs(f"EPSG:{src_epsg}", "EPSG:4326", always_xy=True)
    coords: List[Dict[str, float]] = []
    for x, y in flood_poly.exterior.coords:
        lon, lat = transformer.transform(x, y)
        coords.append({"lat": round(lat, 6), "lon": round(lon, 6)})
    return coords
