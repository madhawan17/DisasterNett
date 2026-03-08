# Implementation — Lifeline Engine

## How to Read This Document

This document is a deep walkthrough of how the Lifeline Engine was built — file by file, function by function. It is intended for engineers who want to understand, extend, debug, or contribute to the codebase. Every code snippet shown is taken directly from the source files.

---

## Module Inventory

| File | Role | Lines |
|---|---|---|
| `api.py` | FastAPI application — all endpoints, Pydantic models, route handlers, cache management | ~1034 |
| `engine.py` | Core analysis engine — flood masking, Dijkstra, state table serialisation, path geometry | ~729 |
| `flood_infrastructure.py` | Overpass API querying, centroid computation, GeoJSON/CSV output | ~616 |
| `utils_geo.py` | Geospatial utilities — projection, nearest-node, flood polygon, facility loading | ~340 |
| `log_config.py` | Centralised logging — rotating file, console, optional JSON | ~191 |
| `main.py` | CLI entry point — standalone simulation runner | ~264 |
| `locustfile.py` | Locust load test scenarios | — |
| `test_load.py` | Async HTTP smoke tests | — |

---

## 1. Logging System (`log_config.py`)

### Rationale

Logging is initialised **before any other local import** in every entry-point file. This prevents a common Python problem where a library imported early creates a logger with no handlers, and the first `import log_config` doesn't retroactively attach them.

```python
# Every entry-point module starts with:
sys.path.insert(0, str(Path(__file__).parent))
from log_config import get_logger, setup_logging

setup_logging()
log = get_logger("lifeline.api")
```

### `setup_logging()`

```python
def setup_logging(level: str | None = None) -> None:
    global _setup_done
    if _setup_done:          # idempotent guard
        return
    ...
```

**Idempotency guard** (`_setup_done` module-level flag): calling `setup_logging()` multiple times is safe — only the first call attaches handlers. This matters because multiple modules all call it at import time.

**Three handlers are attached to the root logger:**

| Handler | File | Level | Format |
|---|---|---|---|
| `RotatingFileHandler` | `lifeline_engine.log` | `DEBUG` | Plain text |
| `StreamHandler` | `stdout` | `$LOG_LEVEL` (default INFO) | ANSI-coloured if TTY |
| `RotatingFileHandler` (opt-in) | `lifeline_engine_json.log` | `DEBUG` | JSON (python-json-logger) |

```python
file_handler = logging.handlers.RotatingFileHandler(
    _LOG_FILE,
    maxBytes=10 * 1024 * 1024,   # 10 MB
    backupCount=5,
    encoding="utf-8",
)
```

Root logger level is set to `logging.DEBUG` (accepts everything); handlers apply their own `setLevel` filters. This allows the file to capture all debug detail while the console only shows INFO+.

**ANSI coloured formatter** guards on `sys.stdout.isatty()`:

```python
if sys.stdout.isatty():
    console_handler.setFormatter(_ColouredFormatter(_PLAIN_FMT, ...))
else:
    console_handler.setFormatter(logging.Formatter(_PLAIN_FMT, ...))
```

This ensures containers (where stdout is piped, not a TTY) emit clean log text without ANSI escape codes.

**Third-party logger suppression:**

```python
_QUIET_LOGGERS = ["urllib3", "fiona", "pyproj", "shapely",
                  "matplotlib", "asyncio", "httpx", "httpcore", "osmnx"]
for name in _QUIET_LOGGERS:
    logging.getLogger(name).setLevel(logging.WARNING)
```

OSMnx is especially verbose at DEBUG; without this suppression it emits thousands of lines per graph download.

---

## 2. Geospatial Utilities (`utils_geo.py`)

### 2.1 Edge Geometry Retrieval

```python
def get_edge_geometry(G, u, v, k) -> LineString:
    data = G[u][v][k]
    if "geometry" in data:
        return data["geometry"]
    # Fallback: straight line between node coordinates
    x_u, y_u = G.nodes[u]["x"], G.nodes[u]["y"]
    x_v, y_v = G.nodes[v]["x"], G.nodes[v]["y"]
    return LineString([(x_u, y_u), (x_v, y_v)])
```

OSMnx stores a Shapely `LineString` on most edges (the actual road curve). Simple straight sections between adjacent nodes may not carry a `geometry` attribute. The fallback preserves correctness: a two-point LineString still properly intersects flood polygons and can be reprojected.

### 2.2 UTM Projection

```python
def project_graph_to_utm(G) -> Tuple[nx.MultiDiGraph, int]:
    G_proj = ox.project_graph(G)           # auto-selects UTM zone
    crs = CRS.from_user_input(G_proj.graph["crs"])
    epsg = crs.to_epsg()
    return G_proj, epsg
```

OSMnx's `project_graph` reads the centroid of the graph's bounding box and selects the appropriate UTM zone automatically. The EPSG code is then read back from the graph metadata — this is the code used for all subsequent pyproj transformations in the session.

**Why UTM projection is essential:**  
Without projection, coordinates are in degrees. A 500-metre buffer on a degree-based `Point` would produce an oval in real-world space (because 1° latitude ≠ 1° longitude in metres at most latitudes). In UTM all axes are metres, so `Point(cx, cy).buffer(500)` is exactly a 500-metre circle.

### 2.3 Nearest-Node Snapping

```python
def get_nearest_node(G, lat, lon) -> int:
    graph_crs_raw = G.graph.get("crs")
    if graph_crs_raw is not None:
        graph_crs = CRS.from_user_input(graph_crs_raw)
        if not graph_crs.is_geographic:
            transformer = Transformer.from_crs("EPSG:4326", graph_crs, always_xy=True)
            x_proj, y_proj = transformer.transform(lon, lat)
            return ox.distance.nearest_nodes(G, X=x_proj, Y=y_proj)
    return ox.distance.nearest_nodes(G, X=lon, Y=lat)
```

**The critical detail here:** `osmnx.distance.nearest_nodes` expects coordinates **in the graph's own CRS**. For a WGS-84 graph `X=lon, Y=lat` is correct. For a projected UTM graph, passing `X=lon, Y=lat` (degrees) would snap every point to the wrong node near the graph origin. The function detects the CRS and reprojects before querying.

`osmnx.distance.nearest_nodes` uses a scipy `cKDTree` (R-tree equivalent) built over all node coordinates — this is $O(\log N)$ query time after $O(N \log N)$ build time.

### 2.4 Flood Polygon Construction

```python
def flood_circle(center_lat, center_lon, radius_m=500.0, crs_epsg=32643) -> Polygon:
    transformer = Transformer.from_crs("EPSG:4326", f"EPSG:{crs_epsg}", always_xy=True)
    x_proj, y_proj = transformer.transform(center_lon, center_lat)
    circle = Point(x_proj, y_proj).buffer(radius_m)
    return circle
```

Returns a Shapely `Polygon` in the UTM CRS (same as the road graph), so that `edge_geom.intersects(flood_union)` is a valid same-CRS comparison.

**Note on `always_xy=True`:** pyproj's `Transformer` by default accepts coordinates in the axis order defined by the CRS standard. For geographic CRS this is `(lat, lon)`. `always_xy=True` forces `(lon, lat) = (X, Y)` order, matching the conventional US/Europe GIS convention and OSM's data format.

### 2.5 OSM Facility Fetching

```python
def fetch_facilities_from_osm(place_name, crs_epsg, amenity_tags=None):
    if amenity_tags is None:
        amenity_tags = ["hospital", "school", "police", "fire_station"]

    frames = []
    for tag in amenity_tags:
        gdf = ox.features_from_place(place_name, tags={"amenity": tag})
        gdf["geometry"] = gdf["geometry"].apply(
            lambda geom: geom.centroid if geom.geom_type != "Point" else geom
        )
        gdf["type"] = tag
        frames.append(gdf)

    combined = pd.concat(frames, ignore_index=True)
    combined["facility_id"] = [f"FAC_{i:04d}" for i in range(len(combined))]
    combined = combined.set_crs("EPSG:4326", allow_override=True)
    combined = combined.to_crs(epsg=crs_epsg)
    return combined[["facility_id", "type", "name", "geometry"]].reset_index(drop=True)
```

**Centroid reduction:** OSM maps most hospitals and schools as polygon areas (building outlines), not points. A polygon can't be directly snapped to a road node. The `.centroid` call reduces each polygon to its geometric centre for routing purposes.

**`allow_override=True`:** OSMnx sometimes returns `GeoDataFrame`s without a declared CRS even though coordinates are implicitly WGS-84. This flag forces the assignment without raising an error.

---

## 3. Core Analysis Engine (`engine.py`)

### 3.1 Network Loading

```python
def load_network(place_name="Navi Mumbai, India") -> Tuple[nx.MultiDiGraph, int]:
    G_raw = ox.graph_from_place(place_name, network_type="drive", simplify=True)
    G_proj, epsg = project_graph_to_utm(G_raw)
    return G_proj, epsg
```

`simplify=True` calls OSMnx's graph simplification algorithm, which:
- Merges long chains of nodes with degree 2 (pass-through junctions) into single edges
- Preserves complex intersections and endpoint nodes
- Significantly reduces graph size (often 50–70% fewer nodes) without affecting routing accuracy
- Stores the original curve as the `geometry` attribute on merged edges

### 3.2 Flood Masking

```python
def apply_flood_mask(G, flood_polygons) -> nx.MultiDiGraph:
    flood_union = unary_union(flood_polygons)
    blocked_count = 0

    for u, v, k, data in G.edges(keys=True, data=True):
        edge_geom = get_edge_geometry(G, u, v, k)
        is_blocked = edge_geom.intersects(flood_union)
        data["blocked"] = is_blocked
        if is_blocked:
            blocked_count += 1
    ...
```

**`unary_union(flood_polygons)`:** Even though the current implementation always passes a single-element list, the union makes the function correctly handle multi-zone flood scenarios (multiple flood pockets).

**In-place mutation:** `data["blocked"] = is_blocked` modifies the edge's attribute dictionary directly. Because edges in NetworkX share their attribute dicts by reference, this mutation is reflected immediately throughout the graph — there is no need to re-assign the edge. This pattern is safe because `apply_flood_mask` always works on a **deep copy** of the cached graph (see `_prepare_graphs` in `api.py`).

**`intersects` semantics:** Shapely's `intersects` returns `True` if any part of the LineString passes through or touches the flood polygon, including shared boundary points. A road that merely touches the edge of the flood zone is therefore also blocked.

### 3.3 Crisis Subgraph

```python
def build_crisis_graph(G) -> nx.MultiDiGraph:
    blocked_edges = [
        (u, v, k)
        for u, v, k, data in G.edges(keys=True, data=True)
        if data.get("blocked", False)
    ]
    G_crisis = nx.restricted_view(G, nodes=[], edges=blocked_edges)
    return G_crisis
```

**`nx.restricted_view`** creates a lightweight view object that delegates all node/edge lookups to the original graph but filters out the specified edges. This is more memory-efficient than `G.copy()` or `G.edge_subgraph()` — the original graph data is not duplicated; only a filter set is stored.

**Important:** The view is **read-only**. Any attempt to add/remove nodes or edges from `G_crisis` raises `NetworkXError`. This is intentional — the crisis graph should not be mutated.

### 3.4 Hub Node Snapping

```python
def find_hub_node(G, hub_lat=19.0330, hub_lon=73.0297) -> int:
    node_id = get_nearest_node(G, hub_lat, hub_lon)
    return node_id
```

The hub is the central reference point for `/simulate` city-wide analysis. All facility accessibility distances are measured relative to this point. For `/analyze` the "hub" concept is replaced by `point_a` — the origin of the individual routing query.

### 3.5 Facility Snapping

```python
def snap_facilities_to_nodes(G, facilities_gdf) -> List[Dict]:
    snapped = []
    for _, row in facilities_gdf.iterrows():
        try:
            node = get_nearest_node(G, row["lat"], row["lon"])
            snapped.append({
                "node": node,
                "facility_id": row["facility_id"],
                "name": row.get("name", row["facility_id"]),
                "type": row["type"],
                "lat": round(row["lat"], 6),
                "lon": round(row["lon"], 6),
            })
        except Exception as exc:
            log.warning("Could not snap facility '%s': %s", row["facility_id"], exc)
    return snapped
```

Silent dropping (with a warning log) is the deliberate choice here. If a facility lies outside the graph's coverage area, snapping fails. It is better to run the analysis with the remaining facilities than to abort the entire request.

**Why pre-snap facilities?** Computing Dijkstra on the graph requires node IDs, not lat/lon coordinates. Snapping happens once and is cached in `_facility_cache`. Every subsequent request for the same city/type pair reuses the pre-computed snapped list.

### 3.6 Nearest Facility Search (Single-Pass Dijkstra)

```python
def find_nearest_facility(G, origin_node, snapped_facilities) -> Optional[Dict]:
    lengths = nx.single_source_dijkstra_path_length(
        G, origin_node, weight="length"
    )
    best = None
    best_dist = math.inf
    for fac in snapped_facilities:
        dist = lengths.get(fac["node"], math.inf)
        if dist < best_dist:
            best_dist = dist
            best = {**fac, "dist_m": round(dist, 1)}
    return best
```

**Single-source Dijkstra** expands from the origin node and computes the shortest distance to **every reachable node** in the graph in one pass. This is $O(E \log V)$ regardless of the number of target facilities. The alternative — running one Dijkstra per facility — would be $O(F \times E \log V)$ where $F$ is the number of facilities. For a city with 50 hospitals + schools this is 50× slower.

`lengths.get(fac["node"], math.inf)`: unreachable nodes are not present in the `lengths` dict. Defaulting to `math.inf` correctly handles the "no path" case and means unreachable facilities are never selected as the minimum.

### 3.7 Dual-Pass Dijkstra (Simulation)

```python
def run_dual_pass_dijkstra(G_baseline, G_crisis, facilities_gdf, hub_node):
    for _, row in facilities_with_coords.iterrows():
        fac_node = get_nearest_node(G_baseline, lat, lon)
        baseline_dist = _safe_shortest_path_length(G_baseline, fac_node, hub_node)
        flood_dist    = _safe_shortest_path_length(G_crisis,   fac_node, hub_node)

        # Classification:
        if baseline_dist is None:
            status = "CUT_OFF"; detour_factor = math.inf
        elif flood_dist is None:
            status = "CUT_OFF"; detour_factor = math.inf
        elif baseline_dist == 0 and flood_dist == 0:
            detour_factor = 1.0; status = "FULLY_ACCESSIBLE"
        elif baseline_dist == 0 and flood_dist > 0:
            detour_factor = math.inf; status = "LIMITED_ACCESS"
        else:
            detour_factor = flood_dist / baseline_dist
            status = "FULLY_ACCESSIBLE" if detour_factor < 1.2 else "LIMITED_ACCESS"
```

Note the direction of the Dijkstra in `/simulate`: it runs **from the facility node to the hub**, whereas in `/analyze` it runs **from the origin to all facilities**. Both are correctly equivalent by shortest-path symmetry in undirected graphs, but the road graph is a `MultiDiGraph` (directed). In practice, most urban road networks have enough parallel bidirectional edges that this produces correct results; one-way streets near a facility could theoretically cause discrepancies.

**The 1.2 threshold:** `DETOUR_THRESHOLD = 1.2` means a facility becomes `LIMITED_ACCESS` if the flood-forced detour adds more than 20% to the baseline travel distance. This threshold is a named constant in `engine.py` for easy tuning.

### 3.8 Road-Following Path Coordinates

```python
def get_detailed_path_coords(G, path) -> List[Dict[str, float]]:
    for i in range(len(path) - 1):
        u, v = path[i], path[i + 1]
        if v in G[u]:
            edges = G[u][v]
            k = min(edges, key=lambda k: edges[k].get("length", float("inf")))
            geom = get_edge_geometry(G, u, v, k)
        ...
        seg_pts = _proj_to_wgs84(list(geom.coords))
        if all_pts and seg_pts:
            seg_pts = seg_pts[1:]   # remove duplicate junction point
        all_pts.extend(seg_pts)
```

**Parallel edge selection:** NetworkX `MultiDiGraph` allows multiple edges between the same node pair (e.g. a motorway slip road alongside a main road). The function selects the lightest edge (`min(..., key=lambda k: edges[k].get("length", inf))`) to match what Dijkstra's `weight="length"` would have selected.

**Deduplication:** Each segment's first point is the same as the previous segment's last point (the shared junction node). `seg_pts = seg_pts[1:]` prevents duplicate coordinates in the output — important for clean polylines.

**CRS reproject:** `_proj_to_wgs84` uses a cached `pyproj.Transformer(graph_crs → EPSG:4326, always_xy=True)` to convert each `(x_utm, y_utm)` pair back to `(lon, lat)`.

### 3.9 State Table Serialisation

```python
def generate_state_table(results, output_path="state_table.json", also_csv=True):
    with output_path.open("w", encoding="utf-8") as fh:
        json.dump(results, fh, indent=2, ensure_ascii=False)

    if also_csv:
        df = pd.DataFrame(results)
        df.to_csv(output_path.with_suffix(".csv"), index=False)

    return output_path
```

`ensure_ascii=False` preserves Unicode facility names (e.g. Devanagari script for Indian place names) in the JSON output rather than escaping them as `\uXXXX` sequences.

`indent=2` produces human-readable JSON — the indentation overhead is negligible compared to what a downstream system would gain in readability when debugging.

---

## 4. Flood Infrastructure Module (`flood_infrastructure.py`)

### 4.1 Circle-to-Bbox-and-Polygon

```python
def circle_to_bbox_and_poly(center_lat, center_lon, radius_m):
    utm_zone = int((center_lon + 180) / 6) + 1
    hemisphere = "north" if center_lat >= 0 else "south"
    utm_epsg = 32600 + utm_zone if hemisphere == "north" else 32700 + utm_zone

    wgs84_to_utm = Transformer.from_crs("EPSG:4326", f"EPSG:{utm_epsg}", always_xy=True)
    utm_to_wgs84 = Transformer.from_crs(f"EPSG:{utm_epsg}", "EPSG:4326", always_xy=True)

    cx, cy = wgs84_to_utm.transform(center_lon, center_lat)
    circle_utm = Point(cx, cy).buffer(radius_m)

    coords_wgs84 = [
        utm_to_wgs84.transform(x, y)
        for x, y in circle_utm.exterior.coords
    ]
    poly_wgs84 = Polygon(coords_wgs84)

    minx, miny, maxx, maxy = poly_wgs84.bounds  # (min_lon, min_lat, max_lon, max_lat)
    bbox = (miny, minx, maxy, maxx)             # (min_lat, min_lon, max_lat, max_lon)
    return bbox, poly_wgs84
```

**UTM zone formula:** `int((lon + 180) / 6) + 1` is the standard formula for computing the UTM zone from longitude. EPSG:326xx = Northern hemisphere, EPSG:327xx = Southern hemisphere.

**Two separate transformers:** The forward transform (WGS-84 → UTM) is needed to buffer the circle in metres. The inverse transform (UTM → WGS-84) is needed to re-express the circle polygon in WGS-84 degrees for the Overpass API bbox query.

**Why two separate steps vs `flood_circle` in utils_geo?** `flood_circle` returns a UTM polygon for road-graph intersection. `circle_to_bbox_and_poly` returns a WGS-84 polygon for Overpass queries. These are fundamentally different use cases and must produce polygons in different CRS.

### 4.2 Overpass Query Construction

```python
def _build_overpass_query(key, value, bbox) -> str:
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
```

**`out geom;`** is the critical directive. Standard Overpass `out;` returns ways and relations as lists of member node IDs (no coordinates). `out geom;` inlines the full coordinate geometry of every element, which is required for centroid computation without a secondary lookup.

**Overpass QL structure:** The union `(node[...]; way[...]; relation[...]);` returns all three element types in a single request, minimising the number of HTTP calls per tag.

### 4.3 Overpass Retry Mechanism

```python
def _post_overpass(query, max_retries, retry_sleep) -> Dict:
    last_exc = RuntimeError("No attempts made")
    sleep = retry_sleep
    for attempt in range(1, max_retries + 1):
        resp = requests.post(OVERPASS_URL, data={"data": query}, timeout=_DEFAULT_TIMEOUT_S + 10)
        if resp.status_code == 429:
            time.sleep(sleep); sleep *= 2; continue
        if resp.status_code in (503, 504):
            time.sleep(sleep); sleep *= 2; continue
        resp.raise_for_status()
        return resp.json()
    raise RuntimeError(f"Overpass API unreachable after {max_retries} attempts.")
```

**Exponential back-off** (`sleep *= 2`): Starting at `retry_sleep=10s`, subsequent retries wait 20s, 40s, 80s. This is the standard approach for politely backing off API rate limits without hammering the server.

**Timeout buffer:** `timeout=_DEFAULT_TIMEOUT_S + 10` gives the HTTP connection 10 additional seconds beyond the Overpass query timeout. This prevents the `requests` library from timing out the connection before Overpass has had a chance to return its 408 error.

### 4.4 Centroid Computation for Ways

```python
def _way_to_centroid(element) -> Optional[Tuple[float, float]]:
    geom = element.get("geometry", [])
    coords = [(float(g["lon"]), float(g["lat"])) for g in geom if "lat" in g and "lon" in g]
    if len(coords) < 2:
        return None

    if coords[0] == coords[-1] and len(coords) >= 4:
        poly = Polygon(coords)
        if poly.is_valid and not poly.is_empty:
            c = poly.centroid
            return c.y, c.x   # lat, lon
    from shapely.geometry import LineString
    line = LineString(coords)
    return line.centroid.y, line.centroid.x
```

**Coordinate order:** Overpass `geometry` arrays are `{lat, lon}`. Shapely `Polygon` expects `(x, y)` = `(lon, lat)`. The list comprehension therefore swaps to `(g["lon"], g["lat"])`. The centroid `c.y` = latitude, `c.x` = longitude when in lon/lat coordinate space.

**Closed ring detection:** `coords[0] == coords[-1] and len(coords) >= 4` checks that the way forms a closed ring (a building outline). Open ways (roads, paths tagged as buildings) fall through to the `LineString` path.

**`poly.is_valid`:** Self-intersecting polygons (figure-8 shapes) produce invalid Shapely geometries. The `is_valid` check skips these rather than crashing on a `TopologicalError`.

### 4.5 Centroid Computation for Relations

```python
def _relation_to_centroid(element) -> Optional[Tuple[float, float]]:
    members = element.get("members", [])
    all_polys = []
    for member in members:
        geom = member.get("geometry", [])
        coords = [(float(g["lon"]), float(g["lat"])) for g in geom ...]
        if coords[0] == coords[-1] and len(coords) >= 4:
            p = Polygon(coords)
            if p.is_valid and not p.is_empty:
                all_polys.append(p)

    if all_polys:
        union = unary_union(all_polys)
        return union.centroid.y, union.centroid.x

    ctr = element.get("center")
    if ctr:
        return float(ctr["lat"]), float(ctr["lon"])
    return None
```

OSM relations represent complex features like university campuses or hospital complexes with multiple building polygons. `unary_union(all_polys)` merges all the member polygons into a single `MultiPolygon`, and `.centroid` returns the geometric centre of the combined area. This gives a more representative coordinate than picking any single member polygon's centroid.

### 4.6 Feature Extraction & Membership Filter

```python
def _extract_features(overpass_data, feature_type, flood_polygon):
    features = []
    for element in overpass_data.get("elements", []):
        coords = _element_to_latlon(element)
        if coords is None:
            continue
        lat, lon = coords

        if flood_polygon is not None:
            if not flood_polygon.contains(Point(lon, lat)):
                continue

        tags = element.get("tags", {})
        name = tags.get("name") or tags.get("name:en") or tags.get("operator") or ""
        features.append({
            "feature_id": f"{element['type']}/{element['id']}",
            "osm_id": element["id"],
            "osm_type": element["type"],
            "name": name,
            "feature_type": feature_type,
            "latitude": round(lat, 7),
            "longitude": round(lon, 7),
            "flood_risk": True,
        })
    return features
```

**`feature_id` format:** `"node/1234567"` or `"way/8765432"` — this is the standard OSM identifier format and enables direct lookup in any OSM-aware system.

**Name fallback chain:** `name` → `name:en` → `operator` → `""`. Many small amenities (pharmacies, prayer halls) have no `name` tag but do have an `operator` name. The fallback chain maximises the proportion of records with a useful name.

**`flood_risk: True`** is hardcoded on every record. All features in this dataset are, by definition, within the flood zone.

---

## 5. FastAPI Application (`api.py`)

### 5.1 Application Configuration

```python
app = FastAPI(
    title="Lifeline Accessibility & Road Network Analysis API",
    version="1.0.0",
)
```

No middleware, CORS policy, or authentication is registered. The app is intended for internal/hackathon use. For production, an authentication middleware and CORS headers should be added.

### 5.2 Pydantic Models — Input Validation

All request bodies are Pydantic v2 `BaseModel` subclasses. The `model_validator(mode="after")` hook allows post-field validation:

```python
class Coords(BaseModel):
    lat: float = Field(..., ge=-90.0, le=90.0)
    lon: float = Field(..., ge=-180.0, le=180.0)

    @model_validator(mode="after")
    def _reject_boundary_extremes(self) -> "Coords":
        if self.lat in (-90.0, 90.0):
            raise ValueError(f"lat={self.lat} is a boundary extreme ...")
        ...
```

**Why reject boundary extremes?** Pydantic's `ge=-90.0, le=90.0` allows exactly `-90.0` and `90.0`, which are the poles. In practice these values almost always indicate an uninitialised `0.0` that was mistakenly passed, or a copy-paste of the constraint value. The validator catches this class of user error with a clear message.

### 5.3 Cache Management

```python
_graph_cache: Dict[str, Tuple[nx.MultiDiGraph, int]] = {}
_cache_lock = threading.Lock()

def _get_or_load_graph(place_name: str) -> Tuple[nx.MultiDiGraph, int]:
    with _cache_lock:
        if place_name not in _graph_cache:
            G, epsg = load_network(place_name)
            _graph_cache[place_name] = (G, epsg)
    return _graph_cache[place_name]
```

**Double-checked locking pattern:** The lock is held for the entire check-and-set operation. This is the correct Python threading pattern — unlike Java's `synchronized`, Python's GIL does not make dict lookups atomic for this use case, because `load_network` releases the GIL during I/O and another thread could slip in.

**Three separate caches, three separate locks:**

```python
_graph_cache:     _cache_lock
_facility_cache:  _facility_lock
_bbox_cache:      _bbox_lock
```

Separate locks minimise contention — a thread fetching facilities doesn't block a thread checking the graph cache.

### 5.4 Flood Setup Helper

```python
def _prepare_graphs(G, epsg, flood_cfg, default_lat, default_lon):
    import copy
    G_work = copy.deepcopy(G)    # never mutate the cached graph

    if flood_cfg is None:
        flood_cfg = FloodConfig(center_lat=default_lat, center_lon=default_lon, radius_m=500.0)

    flood_poly = flood_circle(
        flood_cfg.center_lat, flood_cfg.center_lon,
        radius_m=flood_cfg.radius_m, crs_epsg=epsg,
    )
    apply_flood_mask(G_work, [flood_poly])
    n_blocked = sum(1 for _, _, _, d in G_work.edges(keys=True, data=True) if d.get("blocked"))
    G_crisis = build_crisis_graph(G_work)
    return G_work, G_crisis, n_blocked, flood_cfg
```

`copy.deepcopy(G)` creates a fully independent copy of the graph including all edge attribute dicts. This is the performance hot spot — for large city graphs it takes 200–500 ms. The alternative (shallow copy) would cause `data["blocked"] = True` to mutate the cached graph, corrupting all future requests.

### 5.5 Endpoints — Full Reference

---

#### `GET /health`

```python
@app.get("/health", tags=["Meta"])
def health() -> JSONResponse:
    cache_info = {
        place: {"nodes": G.number_of_nodes(), "edges": G.number_of_edges(), "epsg": epsg}
        for place, (G, epsg) in _graph_cache.items()
    }
    return JSONResponse({"status": "ok", "cached_graphs": cache_info})
```

**Request:** None  
**Response:** `{"status": "ok", "cached_graphs": {"Navi Mumbai, India": {"nodes": 20312, "edges": 51840, "epsg": 32643}}}`

---

#### `POST /analyze`

**Request model:** `AnalyzeRequest`

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `point_a` | `Coords` | ✅ | — | Origin coordinate (citizen / incident location) |
| `facility_type` | `str` | — | `"hospital"` | One of `hospital`, `police`, `fire_station` |
| `place_name` | `str` | — | `"Navi Mumbai, India"` | City for road network download |
| `flood` | `FloodConfig` | — | 500m @ Navi Mumbai centre | Flood zone definition |

**Response model:** `AnalyzeResponse`

| Field | Type | Description |
|---|---|---|
| `place_name` | str | Echoed from request |
| `facility_type` | str | Echoed from request |
| `point_a` | Coords | Echoed from request |
| `nearest_node_a` | int | OSM graph node the origin was snapped to |
| `flood_center` | Coords | Resolved flood centre (default if omitted) |
| `flood_radius_m` | float | Resolved flood radius |
| `edges_blocked` | int | Number of road edges blocked by the flood polygon |
| `baseline` | FacilityHit | Nearest facility under normal conditions |
| `crisis` | FacilityHit | Nearest reachable facility after flood (may differ) |
| `detour_factor` | float / null | `crisis.dist_m / baseline.dist_m`; null on CUT_OFF |
| `rerouted` | bool | `True` if crisis routes to a different facility |
| `status` | str | `FULLY_ACCESSIBLE` / `LIMITED_ACCESS` / `CUT_OFF` |
| `warnings` | List[str] | Non-fatal anomalies observed during analysis |

**Internal flow:**
1. Validate `facility_type` against `FACILITY_TYPES = {"hospital", "police", "fire_station"}`
2. `_get_or_load_graph(place_name)`
3. Bounding-box guard via `_get_place_bbox`
4. Fetch/cache facilities via `_facility_cache`
5. `_prepare_graphs` — deep copy + flood mask + crisis graph
6. Origin-in-flood guard via `_origin_in_flood_zone`
7. Snap origin to nearest node
8. `find_nearest_facility(G_work, node_a, facilities)` — baseline
9. `find_nearest_facility(G_crisis, node_a, facilities)` — crisis
10. Classify + collect warnings → return `AnalyzeResponse`

---

#### `POST /route`

**Request model:** `RouteRequest` (identical fields to `AnalyzeRequest`)

**Response model:** `RouteResponse`

| Field | Type | Description |
|---|---|---|
| `baseline` | RoutePathHit / null | Path geometry for baseline route |
| `crisis` | RoutePathHit / null | Path geometry for crisis route |

**RoutePathHit:**

| Field | Type | Description |
|---|---|---|
| `facility_id` | str | Target facility ID |
| `name` | str | Facility name |
| `dist_m` | float | Total route distance in metres |
| `path` | List[RouteCoord] | Ordered WGS-84 coordinates following road geometry |

**RouteCoord:**

| Field | Type | Description |
|---|---|---|
| `id` | str | Stable coord ID: `fac-01-001` (pass-coordIndex) |
| `lat` | float | WGS-84 latitude |
| `lon` | float | WGS-84 longitude |

**ID format:** `fac-{pass_num:02d}-{coord_num:03d}`  
- `fac-01-001` … `fac-01-NNN` = baseline path coordinates
- `fac-02-001` … `fac-02-NNN` = crisis path coordinates

**Internal flow after Dijkstra:** calls `nx.shortest_path(G_pass, node_a, hit["node"], weight="length")` to recover the actual path node sequence, then `get_detailed_path_coords(G_pass, raw_path)` to extract road-following geometry.

---

#### `POST /simulate`

**Request model:** `SimulateRequest`

| Field | Type | Default | Description |
|---|---|---|---|
| `place_name` | str | `"Navi Mumbai, India"` | City |
| `hub` | Coords | Navi Mumbai centre | Reference point for all distance measurements |
| `flood` | FloodConfig | 500m @ hub | Flood zone |
| `save_to_disk` | bool | `false` | Write state_table.json/.csv |
| `top_n` | int | null | Return only top N results |
| `sort_by` | str | `"baseline_dist_m"` | Sort field |
| `status_filter` | List[str] | null | Filter to specific statuses |

**Response model:** `SimulateResponse`

| Field | Description |
|---|---|
| `total_facilities` | Total facilities analysed (before filtering) |
| `edges_blocked` | Number of road segments blocked |
| `summary` | `{"FULLY_ACCESSIBLE": N, "LIMITED_ACCESS": N, "CUT_OFF": N}` |
| `warnings` | Non-fatal anomalies |
| `facilities` | List of `FacilityResult` (filtered, sorted, sliced) |

**Sort key implementations (from `api.py`):**

```python
_SORT_KEYS = {
    "baseline_dist_m": lambda r: (r.get("baseline_dist_m") is None, r.get("baseline_dist_m") or 0),
    "flood_dist_m":    lambda r: (r.get("flood_dist_m") is None,    r.get("flood_dist_m") or 0),
    "detour_factor":   lambda r: (r["detour_factor"] == "INF", 0 if r["detour_factor"] == "INF" else r["detour_factor"]),
    "status":          lambda r: {"CUT_OFF": 0, "LIMITED_ACCESS": 1, "FULLY_ACCESSIBLE": 2}.get(r["status"], 99),
}
```

The tuple trick `(is_none, value)` ensures null values sort last regardless of ascending/descending direction.

---

#### `POST /flood-infrastructure`

**Request model:** `FloodInfraRequest`

| Field | Type | Default | Description |
|---|---|---|---|
| `center_lat` | float | **Required** | Flood zone centre latitude |
| `center_lon` | float | **Required** | Flood zone centre longitude |
| `radius_m` | float | `500.0` | Flood zone radius in metres |
| `output_dir` | str | `"."` | Server-side output directory |
| `output_prefix` | str | `"flood_infrastructure"` | Output filename prefix |
| `max_retries` | int | `4` | Overpass retry limit per tag |
| `retry_sleep` | float | `10.0` | Base retry sleep (doubles each attempt) |
| `tag_sleep` | float | `1.5` | Inter-tag query delay |

**Response model:** `FloodInfraResponse`

| Field | Description |
|---|---|
| `total_features` | Count of unique extracted features |
| `summary` | `{ "hospital": N, "school": N, ... }` per feature type |
| `geojson_path` | Absolute server-side path to saved `.geojson` |
| `csv_path` | Absolute server-side path to saved `.csv` |
| `geojson` | Full GeoJSON FeatureCollection in the response body |
| `features` | List of `InfraFeature` (id, name, type, lat, lon, flood_risk) |

**Internal flow:**
1. `circle_to_bbox_and_poly(center_lat, center_lon, radius_m)` → `bbox, flood_poly`
2. `query_flood_infrastructure(bbox=bbox, _flood_shape=flood_poly, ...)` → `InfrastructureResult`
3. Map to `FloodInfraResponse`

---

#### `DELETE /cache/{place_name}`

```python
@app.delete("/cache/{place_name}", tags=["Meta"])
def evict_cache(place_name: str) -> JSONResponse:
    decoded = place_name.replace("__", ", ")
    with _cache_lock:
        if decoded in _graph_cache:
            del _graph_cache[decoded]
            return JSONResponse({"evicted": decoded})
    raise HTTPException(status_code=404, detail=f"'{decoded}' not in cache")
```

**URL encoding:** City names with commas and spaces (e.g. `"Navi Mumbai, India"`) are awkward in URL path segments. The convention `__` → `, ` allows `DELETE /cache/Navi Mumbai__India` to work.

---

## 6. CLI Entry Point (`main.py`)

### Simulation Flow

`run_mock_flood_simulation()` executes a fixed 9-step pipeline:

```
Step 1: load_network(PLACE)
Step 2: fetch_facilities_from_osm() or build_fallback_gdf()
Step 3: flood_circle(HUB_LAT, HUB_LON, FLOOD_RADIUS_M, crs_epsg=epsg)
Step 4: apply_flood_mask(G, [flood_poly])
Step 5: build_crisis_graph(G)
Step 6: find_hub_node(G, HUB_LAT, HUB_LON)
Step 7: run_dual_pass_dijkstra(G, G_crisis, facilities_gdf, hub_node)
Step 8: generate_state_table(results)
Step 9: print_summary(results)
```

All four configuration values accept environment variable overrides:

```python
PLACE         = os.getenv("LIFELINE_PLACE",    "Navi Mumbai, India")
FLOOD_RADIUS_M= float(os.getenv("LIFELINE_FLOOD_R",  "500"))
HUB_LAT       = float(os.getenv("LIFELINE_HUB_LAT",  "19.0330"))
HUB_LON       = float(os.getenv("LIFELINE_HUB_LON",  "73.0297"))
```

### Pretty-Print Summary

```python
_STATUS_COLOURS = {
    "FULLY_ACCESSIBLE": "\033[92m",  # green
    "LIMITED_ACCESS":   "\033[93m",  # yellow
    "CUT_OFF":          "\033[91m",  # red
}
```

ANSI colour codes are used unconditionally here (unlike `log_config.py` which guards on `isatty`). This makes CLI output visually scannable.

The disruption table outputs: `facility_id`, `type`, `name (truncated to 35 chars)`, `baseline_dist`, `flood_dist`, `detour_factor`, `status`.

---

## 7. Error Handling Patterns

### Pattern 1: HTTPException for User Errors

```python
if req.facility_type not in FACILITY_TYPES:
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=f"facility_type must be one of {sorted(FACILITY_TYPES)}",
    )
```

All validation errors → 422. All "resource not found" → 404. All external service failures → 503. Unexpected exceptions → 500.

### Pattern 2: Warn-and-Continue for Non-Fatal Anomalies

```python
if n_blocked == 0:
    analysis_warnings.append(
        "No edges were blocked by the flood polygon. "
        "The flood zone may not intersect the road network — check flood coordinates."
    )
    log.warning("[%s] Flood mask blocked 0 edges ...", req.place_name)
```

The response is still returned (with 200 OK) but the `warnings` array lets callers detect that something unusual was observed.

### Pattern 3: Exception-to-503 for External Dependencies

```python
try:
    G, epsg = _get_or_load_graph(req.place_name)
except Exception as exc:
    raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
```

`503 Service Unavailable` is semantically correct here — the server is up but the graph download service (OSMnx/Overpass) is unavailable or the place name is not found.

### Pattern 4: Silent Drop with Warning Log

```python
except Exception as exc:
    log.warning("Could not snap facility '%s': %s", row["facility_id"], exc)
    # facility is skipped, loop continues
```

Used in facility snapping and Overpass tag queries. The analysis proceeds with the remaining valid data rather than aborting the entire request.

---

## 8. Known Technical Debt & TODO Items

| Location | Issue |
|---|---|
| `main.py → _FALLBACK_FACILITIES` | Hard-coded to Navi Mumbai. Fallback for other cities will produce geographically wrong results. |
| `api.py → _prepare_graphs` | `copy.deepcopy(G)` is expensive (~200–500 ms). No alternative found yet that avoids mutating the cached graph. |
| `engine.py → run_dual_pass_dijkstra` | Dijkstra direction is facility→hub. For directed graphs (one-way streets), facility-to-hub may not equal hub-to-facility distance. |
| `api.py` | No authentication or rate limiting. Any caller can trigger unlimited OSMnx graph downloads. |
| `flood_infrastructure.py → output_dir` | User-supplied `output_dir` path is used without sanitization — potential for unintended write locations. |
| `api.py → _graph_cache` | No LRU eviction policy. Memory grows unbounded with more cities. Only `DELETE /cache/{place}` provides manual eviction. |
| `generate_state_table` | No timestamp or run identifier is written to the state table. Repeated runs overwrite the previous output. |
| `FACILITY_TYPES` in `api.py` | Hard-coded to `{"hospital", "police", "fire_station"}` for `/analyze` and `/route`. `fetch_facilities_from_osm` supports `"school"` and others but the routing endpoints don't expose them. |
