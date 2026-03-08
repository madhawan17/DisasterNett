"""
main.py — Entry point for the Lifeline Accessibility & Road Network Analysis.

Mock-Flood Scenario
-------------------
A 500-metre radius circular "flood zone" is centred on the approximate
centroid of Navi Mumbai, India.  The engine:

  1. Downloads the Navi Mumbai drive network via OSMnx.
  2. Fetches hospitals and schools from OpenStreetMap within the same boundary.
     Falls back to a hard-coded sample set if OSMnx feature queries fail.
  3. Marks all road edges intersecting the flood circle as blocked.
  4. Runs a dual-pass Dijkstra (baseline vs. crisis) to every facility.
  5. Writes ``state_table.json`` and ``state_table.csv`` to this directory.
  6. Prints a human-readable summary to stdout.

Usage
-----
    cd Lifeline_Engine
    python main.py

Optional environment overrides (set before running):
    LIFELINE_PLACE       Override the city name (default: "Navi Mumbai, India")
    LIFELINE_FLOOD_R     Flood radius in metres (default: 500)
    LIFELINE_HUB_LAT     Hub latitude          (default: 19.0330)
    LIFELINE_HUB_LON     Hub longitude         (default: 73.0297)
"""

from __future__ import annotations

import logging
import os
import sys
import textwrap
import time
from pathlib import Path
from typing import List

import geopandas as gpd
import pandas as pd

# ---------------------------------------------------------------------------
# Logging — must be initialised before any other local import
# ---------------------------------------------------------------------------
sys.path.insert(0, str(Path(__file__).parent))
from log_config import get_logger, setup_logging  # noqa: E402

setup_logging()
log = get_logger("lifeline.main")

# ---------------------------------------------------------------------------
# Local imports (utils_geo and engine live in the same directory)
# ---------------------------------------------------------------------------

from engine import (
    apply_flood_mask,
    build_crisis_graph,
    find_hub_node,
    generate_state_table,
    load_network,
    run_dual_pass_dijkstra,
)
from utils_geo import fetch_facilities_from_osm, flood_circle

# ---------------------------------------------------------------------------
# Configuration — override via environment variables if desired
# ---------------------------------------------------------------------------
PLACE: str = os.getenv("LIFELINE_PLACE", "Navi Mumbai, India")
FLOOD_RADIUS_M: float = float(os.getenv("LIFELINE_FLOOD_R", "500"))
HUB_LAT: float = float(os.getenv("LIFELINE_HUB_LAT", "19.0330"))
HUB_LON: float = float(os.getenv("LIFELINE_HUB_LON", "73.0297"))

OUTPUT_JSON = Path(__file__).parent / "state_table.json"

# ---------------------------------------------------------------------------
# Hard-coded fallback facilities (used if OSMnx feature query cannot complete)
# These are real Navi Mumbai hospitals / schools with approximate coordinates.
# ---------------------------------------------------------------------------
_FALLBACK_FACILITIES = [
    {"facility_id": "FAC_0000", "type": "hospital", "name": "MGM Hospital Vashi",          "lat": 19.0727, "lon": 73.0072},
    {"facility_id": "FAC_0001", "type": "hospital", "name": "DY Patil Hospital Nerul",      "lat": 19.0388, "lon": 73.0166},
    {"facility_id": "FAC_0002", "type": "hospital", "name": "Fortis Hospital Kalamboli",    "lat": 18.9813, "lon": 73.0983},
    {"facility_id": "FAC_0003", "type": "hospital", "name": "Apollo Hospital CBD Belapur",  "lat": 19.0166, "lon": 73.0421},
    {"facility_id": "FAC_0004", "type": "school",   "name": "Bal Bharati Public School",   "lat": 19.0613, "lon": 72.9987},
    {"facility_id": "FAC_0005", "type": "school",   "name": "Kendriya Vidyalaya CIDCO",     "lat": 19.0489, "lon": 73.0122},
    {"facility_id": "FAC_0006", "type": "school",   "name": "Ryan International Sanpada",  "lat": 19.0624, "lon": 73.0105},
    {"facility_id": "FAC_0007", "type": "hospital", "name": "NMMC General Hospital",        "lat": 19.0773, "lon": 73.0117},
    {"facility_id": "FAC_0008", "type": "school",   "name": "DAV Public School Airoli",     "lat": 19.1538, "lon": 72.9990},
    {"facility_id": "FAC_0009", "type": "hospital", "name": "Kokilaben Hospital Kharghar",  "lat": 19.0426, "lon": 73.0679},
]


def build_fallback_gdf(crs_epsg: int) -> gpd.GeoDataFrame:
    """Convert the hard-coded facility list into a projected GeoDataFrame."""
    from shapely.geometry import Point

    rows = []
    for f in _FALLBACK_FACILITIES:
        rows.append(
            {
                "facility_id": f["facility_id"],
                "type": f["type"],
                "name": f["name"],
                "geometry": Point(f["lon"], f["lat"]),  # WGS-84 initially
            }
        )
    gdf = gpd.GeoDataFrame(rows, crs="EPSG:4326")
    return gdf.to_crs(epsg=crs_epsg)


# ---------------------------------------------------------------------------
# Pretty-print helpers
# ---------------------------------------------------------------------------
_STATUS_COLOURS = {
    "FULLY_ACCESSIBLE": "\033[92m",   # green
    "LIMITED_ACCESS":   "\033[93m",   # yellow
    "CUT_OFF":          "\033[91m",   # red
}
_RESET = "\033[0m"
_BOLD  = "\033[1m"


def _colourise(status: str) -> str:
    colour = _STATUS_COLOURS.get(status, "")
    return f"{colour}{status}{_RESET}"


def print_summary(results: List[dict]) -> None:
    """Print a formatted summary table to stdout."""
    df = pd.DataFrame(results)

    # --- Status counts ---
    print(f"\n{_BOLD}{'='*65}{_RESET}")
    print(f"{_BOLD}  LIFELINE ENGINE — MOCK FLOOD SIMULATION RESULTS{_RESET}")
    print(f"{_BOLD}  Place : {PLACE}{_RESET}")
    print(f"{_BOLD}  Flood : {FLOOD_RADIUS_M:.0f} m radius @ ({HUB_LAT}, {HUB_LON}){_RESET}")
    print(f"{_BOLD}{'='*65}{_RESET}\n")

    counts = df["status"].value_counts()
    total  = len(df)
    print(f"  Total facilities analysed : {total}")
    for status in ["FULLY_ACCESSIBLE", "LIMITED_ACCESS", "CUT_OFF"]:
        n = counts.get(status, 0)
        bar = "█" * n + "░" * (total - n)
        print(f"  {_colourise(status):<40}  {n:>3}  {bar[:30]}")

    # --- Detail table for non-fully-accessible facilities ---
    problem = df[df["status"] != "FULLY_ACCESSIBLE"].copy()
    if problem.empty:
        print("\n  All facilities are fully accessible. No disruptions detected.\n")
        return

    print(f"\n{_BOLD}  Disrupted Facilities{_RESET}")
    print(f"  {'ID':<12} {'Type':<10} {'Name':<35} {'Baseline':>10} {'Flood':>10} {'Factor':>8}  Status")
    print(f"  {'-'*12} {'-'*10} {'-'*35} {'-'*10} {'-'*10} {'-'*8}  {'-'*16}")

    for _, row in problem.sort_values("status", ascending=False).iterrows():
        baseline = f"{row['baseline_dist_m']:.0f} m" if row["baseline_dist_m"] else "N/A"
        flood    = f"{row['flood_dist_m']:.0f} m"    if row["flood_dist_m"]    else "—"
        factor   = f"{row['detour_factor']}"          if row["detour_factor"] != "INF" else "∞"
        name_trunc = textwrap.shorten(str(row["name"]), width=35, placeholder="…")
        print(
            f"  {row['facility_id']:<12} {row['type']:<10} {name_trunc:<35} "
            f"{baseline:>10} {flood:>10} {factor:>8}  {_colourise(row['status'])}"
        )

    print()


# ---------------------------------------------------------------------------
# Main simulation
# ---------------------------------------------------------------------------

def run_mock_flood_simulation() -> None:
    """Execute the full mock-flood scenario end-to-end."""

    t0 = time.perf_counter()

    # ------------------------------------------------------------------
    # Step 1 — Load the road network
    # ------------------------------------------------------------------
    log.info("STEP 1 — Loading road network for '%s' …", PLACE)
    G, epsg = load_network(PLACE)

    # ------------------------------------------------------------------
    # Step 2 — Load / fetch facilities
    # ------------------------------------------------------------------
    log.info("STEP 2 — Loading critical facilities …")
    try:
        facilities_gdf = fetch_facilities_from_osm(PLACE, epsg)
        log.info("Fetched %d facilities from OSM.", len(facilities_gdf))
    except Exception as exc:
        log.warning("OSM facility fetch failed (%s). Using fallback hard-coded set.", exc)
        facilities_gdf = build_fallback_gdf(epsg)
        log.info("Fallback: %d facilities loaded.", len(facilities_gdf))

    if facilities_gdf.empty:
        log.error("No facilities available — aborting simulation.")
        sys.exit(1)

    # ------------------------------------------------------------------
    # Step 3 — Build mock flood polygon (500 m circle at city centre)
    # ------------------------------------------------------------------
    log.info(
        "STEP 3 — Building flood polygon (r=%.0f m) at (%.4f, %.4f) …",
        FLOOD_RADIUS_M,
        HUB_LAT,
        HUB_LON,
    )
    flood_poly = flood_circle(HUB_LAT, HUB_LON, radius_m=FLOOD_RADIUS_M, crs_epsg=epsg)
    flood_polygons = [flood_poly]

    # ------------------------------------------------------------------
    # Step 4 — Apply flood mask to the graph
    # ------------------------------------------------------------------
    log.info("STEP 4 — Applying flood mask to road network …")
    apply_flood_mask(G, flood_polygons)

    # ------------------------------------------------------------------
    # Step 5 — Build crisis subgraph (blocked edges removed)
    # ------------------------------------------------------------------
    log.info("STEP 5 — Building crisis subgraph …")
    G_crisis = build_crisis_graph(G)

    # ------------------------------------------------------------------
    # Step 6 — Find hub node
    # ------------------------------------------------------------------
    log.info("STEP 6 — Snapping hub to nearest graph node …")
    hub_node = find_hub_node(G, hub_lat=HUB_LAT, hub_lon=HUB_LON)

    # ------------------------------------------------------------------
    # Step 7 — Dual-pass Dijkstra
    # ------------------------------------------------------------------
    log.info("STEP 7 — Running dual-pass Dijkstra (baseline + crisis) …")
    results = run_dual_pass_dijkstra(
        G_baseline=G,
        G_crisis=G_crisis,
        facilities_gdf=facilities_gdf,
        hub_node=hub_node,
    )

    # ------------------------------------------------------------------
    # Step 8 — Write state table
    # ------------------------------------------------------------------
    log.info("STEP 8 — Writing state table …")
    output_path = generate_state_table(results, output_path=OUTPUT_JSON, also_csv=True)

    # ------------------------------------------------------------------
    # Step 9 — Human-readable summary
    # ------------------------------------------------------------------
    print_summary(results)

    elapsed = time.perf_counter() - t0
    print(f"  Output  : {output_path}")
    print(f"  Runtime : {elapsed:.1f} s\n")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    run_mock_flood_simulation()
