# System Architecture — Lifeline Engine

## Overview

Lifeline Engine is a **single-process Python application** built around a FastAPI HTTP server. It has no external database, no message queue, and no background worker processes. Its architectural complexity lies in the geospatial pipeline: OSM graph download → UTM projection → metric flood masking → graph-theoretic routing — all wired together through a thread-safe in-memory cache layer that makes repeated API calls extremely fast.

### Plain-English Architecture Summary

Think of the system as three cooperating layers:

1. **Data Layer** — Road networks and facility locations pulled live from OpenStreetMap. Graphs are projected to real-world metres and cached in RAM.
2. **Analysis Layer** — A flood polygon is applied to the graph to tag blocked roads. Two versions of the graph (normal, flooded) are run through Dijkstra's algorithm to produce accessibility status labels.
3. **API Layer** — FastAPI exposes all analysis capabilities as REST endpoints with typed request/response models, automatic documentation, and comprehensive error handling.

---

## High-Level Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          CLIENT REQUESTS                                  │
│  (browser / Swagger UI / external system / emergency dispatch portal)     │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │  HTTP (JSON)
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         FastAPI Application (api.py)                      │
│                                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  │
│  │  GET /health │  │POST /analyze │  │ POST /route  │  │POST /simulate│  │
│  └──────────────┘  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘  │
│                            │                 │                  │         │
│  ┌─────────────────────────┴─────────────────┴──────────────────┘         │
│  │         POST /flood-infrastructure          DELETE /cache/{place}       │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │                    Thread-Safe In-Memory Cache                      │   │
│  │  _graph_cache:    { place_name → (G_utm, epsg) }                   │   │
│  │  _facility_cache: { "place::type" → [snapped_facility_list] }      │   │
│  │  _bbox_cache:     { place_name →  (min_lat, max_lat, min_lon, …) } │   │
│  └────────────────────────────────────────────────────────────────────┘   │
└────────────────────────┬─────────────────────────┬───────────────────────┘
                         │                         │
           ┌─────────────▼──────────┐   ┌──────────▼──────────────────────┐
           │   engine.py            │   │   flood_infrastructure.py        │
           │                        │   │                                  │
           │ load_network()         │   │ query_flood_infrastructure()     │
           │ apply_flood_mask()     │   │ circle_to_bbox_and_poly()        │
           │ build_crisis_graph()   │   │ _build_overpass_query()          │
           │ find_hub_node()        │   │ _post_overpass()  [retry logic]  │
           │ snap_facilities()      │   │ _way_to_centroid()               │
           │ find_nearest_facility()│   │ _relation_to_centroid()          │
           │ run_dual_pass_dijkstra │   │ _extract_features()              │
           │ generate_state_table() │   │ _save_outputs() → .geojson/.csv  │
           │ get_detailed_path_coords│  └──────────────┬───────────────────┘
           └──────────┬─────────────┘                  │
                      │                                 │
           ┌──────────▼─────────────┐       ┌──────────▼──────────────────┐
           │   utils_geo.py         │       │   Overpass API               │
           │                        │       │   (overpass-api.de)          │
           │ project_graph_to_utm() │       │                              │
           │ get_nearest_node()     │       │  10 × QL queries             │
           │ flood_circle()         │       │  node/way/relation           │
           │ fetch_facilities_from_ │       │  amenity + building tags     │
           │   osm()                │       └─────────────────────────────┘
           │ load_facilities_from_  │
           │   file()               │
           │ get_edge_geometry()    │
           └──────────┬─────────────┘
                      │
           ┌──────────▼──────────────────────────────────────────┐
           │          OpenStreetMap Data Sources                  │
           │                                                      │
           │  OSMnx / Nominatim   →  Road network graph          │
           │  OSMnx features      →  Hospital / school / police  │
           │                         fire_station amenities       │
           └──────────────────────────────────────────────────────┘

           ┌──────────────────────────────────────────────────────┐
           │                  log_config.py                       │
           │                                                      │
           │  RotatingFileHandler  → lifeline_engine.log          │
           │  StreamHandler        → stdout (coloured on TTY)     │
           │  JSON handler (opt-in)→ lifeline_engine_json.log     │
           └──────────────────────────────────────────────────────┘

           ┌──────────────────────────────────────────────────────┐
           │               Disk Outputs                           │
           │                                                      │
           │  state_table.json        (simulation results)        │
           │  state_table.csv         (simulation results)        │
           │  flood_infrastructure.geojson  (infrastructure)      │
           │  flood_infrastructure.csv      (infrastructure)      │
           └──────────────────────────────────────────────────────┘
```

---

## Data Pipeline: Road Network

### Source

OpenStreetMap via the `osmnx` library, which calls the **Overpass API** internally using the Nominatim place-name lookup.

### Pipeline Steps

```
1. Place name string (e.g. "Navi Mumbai, India")
        │
        ▼
2. osmnx.graph_from_place()
   - Network type: "drive" (drivable roads only)
   - simplify=True (merge redundant junction nodes)
   - Returns: nx.MultiDiGraph in WGS-84 (EPSG:4326)
        │
        ▼
3. project_graph_to_utm()
   - osmnx.project_graph() selects best-fit UTM zone automatically
   - Reads resulting EPSG code from G.graph["crs"]
   - Returns: (G_utm: nx.MultiDiGraph, epsg: int)
        │
        ▼
4. Cached in _graph_cache[place_name] = (G_utm, epsg)
   - Threading lock prevents duplicate downloads on concurrent requests
        │
        ▼
5. Deep copy taken before each experiment
   - copy.deepcopy(G) ensures shared cache entry is never mutated
```

### Graph Data Model

Each graph node carries:
- `osmid` — OSM node ID (used as the dict key)
- `x`, `y` — coordinates in the UTM CRS (metres)

Each graph edge carries:
- `length` — road segment length in metres (used as Dijkstra weight)
- `geometry` — Shapely `LineString` of actual road curve (when available)
- `blocked` — boolean, set by `apply_flood_mask()` (added by the engine)

---

## Data Pipeline: Facility Loading

### Source

OpenStreetMap via `osmnx.features_from_place()`.

### Pipeline Steps

```
1. amenity_tags list (default: hospital, school, police, fire_station)
        │
        ▼ (one iteration per tag)
2. osmnx.features_from_place(place_name, tags={"amenity": tag})
   - Returns GeoDataFrame of matching OSM features (nodes, ways, relations)
        │
        ▼
3. Polygon → centroid reduction
   - .centroid applied to any geometry that isn't already a Point
        │
        ▼
4. Concatenate all tags → assign stable facility_id strings (FAC_0000 …)
        │
        ▼
5. Reproject from WGS-84 to the graph's UTM CRS
        │
        ▼
6. extract_wgs84_coords() adds lat/lon float columns back (WGS-84)
   - Used for output tables, not routing
        │
        ▼
7. snap_facilities_to_nodes(G, gdf)
   - For each facility, get_nearest_node() → nearest road junction
   - Result cached in _facility_cache["place::type"]
```

---

## Data Pipeline: Flood Zone

```
           Input
           ┌─────────────────────────────────────────────┐
           │  center_lat, center_lon, radius_m (metres)  │
           └────────────────┬────────────────────────────┘
                            │
              ┌─────────────▼──────────────────┐
              │  flood_circle()  (utils_geo.py) │
              │  OR                              │
              │  circle_to_bbox_and_poly()       │
              │   (flood_infrastructure.py)      │
              └─────────────┬──────────────────┘
                            │
              ┌─────────────▼──────────────────────────────┐
              │  1. Project centre (WGS-84 → UTM)           │
              │     pyproj.Transformer(EPSG:4326 → EPSG:32XX│
              │                                             │
              │  2. Point(cx, cy).buffer(radius_m)           │
              │     Shapely UTM polygon                      │
              │                                             │
              │  For Overpass queries only:                  │
              │  3. Reproject polygon exterior to WGS-84    │
              │  4. Compute bbox (min_lat, min_lon, max_lat, │
              │     max_lon) from polygon bounds            │
              └─────────────┬──────────────────────────────┘
                            │
        ┌───────────────────┼──────────────────────────────┐
        │                   │                              │
        ▼                   ▼                              ▼
apply_flood_mask()    Overpass bbox query           Membership filter
(road graph)          (flood_infrastructure.py)     (contains() test)
```

---

## Analysis Pipeline: Dual-Pass Dijkstra

```
          ┌────────────────────────────────────────────────┐
          │  Inputs                                        │
          │  - origin_node (snapped from lat/lon)          │
          │  - snapped_facilities list                     │
          │  - G_work (baseline graph, flood mask applied) │
          │  - G_crisis (restricted_view, blocked removed) │
          └────────────────────┬───────────────────────────┘
                               │
          ┌────────────────────▼───────────────────────────┐
          │  Pass 1: Baseline                              │
          │  nx.single_source_dijkstra_path_length(        │
          │     G_work, origin_node, weight="length")      │
          │  → lengths: Dict[node_id → dist_m]             │
          │  Minimum over facilities → baseline_hit        │
          └────────────────────┬───────────────────────────┘
                               │
          ┌────────────────────▼───────────────────────────┐
          │  Pass 2: Crisis                                │
          │  nx.single_source_dijkstra_path_length(        │
          │     G_crisis, origin_node, weight="length")    │
          │  → lengths: Dict[node_id → dist_m]             │
          │  Minimum over facilities → crisis_hit          │
          └────────────────────┬───────────────────────────┘
                               │
          ┌────────────────────▼───────────────────────────┐
          │  Classification                                 │
          │                                                 │
          │  crisis_hit is None   →   CUT_OFF              │
          │  detour_factor < 1.2  →   FULLY_ACCESSIBLE     │
          │  detour_factor ≥ 1.2  →   LIMITED_ACCESS       │
          │  different facility   →   LIMITED_ACCESS        │
          │                         + rerouted=True        │
          └────────────────────────────────────────────────┘
```

---

## Analysis Pipeline: Overpass Infrastructure Extraction

```
  Request: center_lat, center_lon, radius_m
        │
        ▼
  circle_to_bbox_and_poly()
        │
        ├─ bbox: (min_lat, min_lon, max_lat, max_lon)  ──► Overpass QL
        └─ flood_shape: Shapely polygon (WGS-84)       ──► membership filter
                │
                ▼ (× 10 tag queries, 1.5s apart)
  _build_overpass_query(key, value, bbox)
        │
        ▼
  _post_overpass()   [retry: 429→sleep×2, 503/504→sleep×2,
        │             timeout→sleep×2, max_retries=4]
        ▼
  overpass JSON
        │
        ▼
  _extract_features()
     for each element:
        node     → _node_to_point()
        way      → _way_to_centroid()   [Polygon.centroid or LineString.centroid]
        relation → _relation_to_centroid() [unary_union(members).centroid]
        │
        ▼ contains(Point(lon, lat)) test against flood_shape
        │
        ▼ append to all_features (dedup via seen_ids set)
        │ (after all 10 queries)
        ▼
  _save_outputs() → flood_infrastructure.geojson + flood_infrastructure.csv
        │
        ▼
  InfrastructureResult returned to API → FloodInfraResponse
```

---

## State Table Design

The state table (`state_table.json` / `state_table.csv`) is a flat list of per-facility records produced by `generate_state_table()` in `engine.py`.

### Schema

```json
[
  {
    "facility_id":      "FAC_0001",
    "name":             "DY Patil Hospital Nerul",
    "type":             "hospital",
    "lat":              19.0388,
    "lon":              73.0166,
    "nearest_node":     1234567890,
    "baseline_dist_m":  2340.5,
    "flood_dist_m":     4210.0,
    "detour_factor":    1.7991,
    "status":           "LIMITED_ACCESS"
  },
  ...
]
```

| Field | Nullability | Notes |
|---|---|---|
| `facility_id` | Never null | Stable `FAC_NNNN` string |
| `name` | Never null | Falls back to `facility_id` if OSM has no name |
| `type` | Never null | OSM amenity tag value |
| `lat` / `lon` | Never null | WGS-84, rounded to 6dp |
| `nearest_node` | Nullable | Null if facility could not be snapped |
| `baseline_dist_m` | Nullable | Null if facility was never reachable |
| `flood_dist_m` | Nullable | Null on `CUT_OFF` |
| `detour_factor` | Number or `"INF"` | `"INF"` when `flood_dist_m` is null |
| `status` | Never null | One of three status strings |

> ⚠️ **Note:** The state table is a snapshot in time. There is no historical versioning or timestamp field. Each `generate_state_table()` call overwrites the previous file.

---

## Backend Architecture

### Framework: FastAPI + Uvicorn

FastAPI provides:
- ASGI-compatible HTTP framework
- Pydantic v2 model validation on all requests and responses
- Automatic OpenAPI schema generation
- Dependency injection (not used beyond Pydantic models in this implementation)

Uvicorn serves the ASGI app synchronously (no `async def` endpoints — all handlers are synchronous because NetworkX and OSMnx are synchronous libraries).

> ⚠️ **Note:** All endpoint handlers are synchronous `def` functions. On a multi-core machine, Uvicorn runs them in a thread pool. Long-running graph downloads will block the serving thread for that request duration.

### Threading Model

```
Uvicorn worker thread (1 per request)
│
├── acquires _cache_lock     (threading.Lock)
│   checks _graph_cache
│   releases _cache_lock
│
├── acquires _facility_lock  (threading.Lock)
│   checks _facility_cache
│   releases _facility_lock
│
├── deep-copies cached graph (inside lock)
├── applies flood mask (local copy only — cache unaffected)
└── runs Dijkstra → returns response
```

Three separate locks prevent three classes of race conditions:
- `_cache_lock` — graph download/projection
- `_facility_lock` — facility fetch/snap
- `_bbox_lock` — bounding box derivation

### Middleware & Error Handling

No custom middleware is registered. Error handling is via explicit `raise HTTPException(status_code=..., detail=...)` calls:

| Condition | HTTP Code |
|---|---|
| Invalid coordinates (boundary extremes) | `422 Unprocessable Entity` |
| Point outside city bounding box | `422 Unprocessable Entity` |
| Origin inside flood zone | `422 Unprocessable Entity` |
| Unknown facility type | `422 Unprocessable Entity` |
| No facilities found | `404 Not Found` |
| OSM graph download fails | `503 Service Unavailable` |
| Overpass API unreachable | `503 Service Unavailable` |
| Unexpected exception | `500 Internal Server Error` |

---

## Frontend Architecture

> ⚠️ **Note:** No frontend is implemented in this repository. The system is **API-only**. The automatic Swagger UI at `/docs` serves as the interactive interface for testing. A globe-rendering frontend (deck.gl / Cesium) is the intended consumer of `/route` path coordinates and blocked-edge geometry, but it is not part of this codebase.

The `/route` endpoint response format is designed for direct consumption by:
- **deck.gl** `PathLayer` — feed `response.baseline.path` directly as layer data
- **Cesium** `PolylineGraphics` — coordinate format is `{lat, lon}` per point with unique stable IDs

---

## Third-Party Integrations

| Service | Library | What It Provides | Authentication |
|---|---|---|---|
| OpenStreetMap / Nominatim | `osmnx` | Road network graph download, facility amenity queries | None (public API) |
| OpenStreetMap Overpass API | `requests` | Raw infrastructure node/way/relation queries | None (public API) |
| Pyproj / PROJ | `pyproj` | CRS transformation between WGS-84 and UTM zones | None (local library) |

No paid APIs, no API keys, no cloud service accounts are required.

---

## Deployment Architecture

### Local / Development

```
Developer machine
└── python api.py  OR  uvicorn api:app --reload
        └── http://localhost:8000
```

### Production Container (Docker)

```
Dockerfile build stages:
  1. FROM python:3.11-slim
  2. adduser --uid 1000 appuser      (HF Spaces compatibility)
  3. apt-get install libgomp1 curl   (OpenMP for scipy/numpy)
  4. COPY requirements-prod.txt
  5. pip install -r requirements-prod.txt
  6. COPY Lifeline_Engine/ ./
  7. mkdir -p /app/data /app/.cache && chown -R appuser
  8. USER appuser
  9. ENV PORT=7860 XDG_CACHE_HOME=/app/.cache PYTHONUNBUFFERED=1

ENTRYPOINT: uvicorn api:app --host 0.0.0.0 --port $PORT
```

### Hugging Face Spaces

The `Dockerfile` is HF Spaces-compatible:
- Non-root user `uid=1000`
- Port `7860` (HF default)
- `XDG_CACHE_HOME=/app/.cache` ensures OSMnx writes to a writable container path
- No `ENTRYPOINT` override needed — HF Spaces reads `CMD` from the Dockerfile

---

## Security Considerations

| Area | Current State | Recommendation |
|---|---|---|
| Authentication | None — all endpoints are public | Add API key header middleware for production |
| Input validation | Pydantic v2 validates all inputs; boundary extremes rejected | Considered adequate for current use |
| SSRF via place_name | `place_name` is passed directly to Nominatim. Malicious strings could cause unexpected lookups | Whitelist known cities for production |
| Disk write path | `output_dir` in `/flood-infrastructure` is a user-controlled write path | Sanitise / restrict to a known safe directory |
| Rate limiting | None on the API itself | Add `slowapi` or nginx rate limiting |
| Container security | App runs as non-root `uid=1000` | ✅ Good |
| Dependency pinning | Minimum versions only (`>=`) — not pinned | Generate `requirements-lock.txt` for reproducibility |

---

## Performance Considerations

### Spatial Indexing

NetworkX's `nx.single_source_dijkstra_path_length` is $O(E \log V)$. For Navi Mumbai (~20k nodes, ~50k edges), this completes in under 100 ms after graph load.

OSMnx's `nearest_nodes` uses an R-tree spatial index internally for sub-millisecond snapping.

### Graph Caching

The dominant latency is the **first request** for a city: OSMnx graph download + projection typically takes 10–60s depending on city size and network speed. All subsequent requests for the same city run in memory.

`copy.deepcopy(G)` is the second-most expensive operation (~200–500 ms for a large city graph). This is necessary because `apply_flood_mask` mutates edge attributes in-place.

### Overpass API Latency

`/flood-infrastructure` issues 10 sequential HTTP requests to the Overpass API, with a 1.5s sleep between each. Minimum wall-clock time is therefore ~15s for the query loop alone, plus network round-trip time. For large bounding boxes with many features this could exceed the 90s Overpass timeout.

### Memory Usage

Each cached road graph for a medium-sized city consumes approximately 200–500 MB of RAM (graph topology + edge geometry). For multi-city deployments consider implementing an LRU eviction policy (currently the `DELETE /cache/{place_name}` endpoint provides manual eviction only).

### No Async Processing

All endpoint handlers are synchronous. For the `/simulate` endpoint running city-wide analysis on hundreds of facilities, execution time is proportional to the number of facilities (~1–5s for 50 facilities). No job queue or background task system is implemented.
