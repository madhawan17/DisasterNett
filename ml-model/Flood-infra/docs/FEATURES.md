# Features — Lifeline Engine

## What Makes This Different

Most flood-risk tools give you a map and ask you to interpret it. Lifeline Engine gives you **answers**.

| Differentiator | How it appears in the code |
|---|---|
| **Dual-pass crisis routing** | `run_dual_pass_dijkstra` runs Dijkstra on both baseline and flood-degraded graphs simultaneously, quantifying the exact accessibility degradation per facility |
| **Structured, machine-readable risk labels** | Every facility result carries a `status` string (`FULLY_ACCESSIBLE` / `LIMITED_ACCESS` / `CUT_OFF`) and a numeric `detour_factor` — consumable by any downstream system, no GIS expertise required |
| **Precise metre-accurate flood geometry** | `flood_circle` in `utils_geo.py` projects the flood zone to UTM before buffering, so a "500 m radius flood" is exactly 500 m radius in real-world distance, not a degree-based approximation |
| **Full infrastructure inventory** | `flood_infrastructure.py` issues 10 separate Overpass API queries with built-in retry/back-off, deduplicates OSM elements, and computes polygon centroids via Shapely |
| **City-agnostic** | Any city queryable by name via OSMnx/Nominatim — not limited to a single hard-coded area |
| **Thread-safe in-process graph cache** | `threading.Lock`-guarded `_graph_cache` dict means the first request downloads and projects the road graph; all subsequent requests reuse it — zero re-download cost |
| **API-first** | Every analysis capability is a typed Pydantic model + FastAPI endpoint with OpenAPI/Swagger docs auto-generated at `/docs` |

---

## Feature Catalogue

---

### Category 1 — Road Network Ingestion

#### 1.1 OSMnx Road Network Download

**Plain English:** The system downloads the actual road map of any city directly from OpenStreetMap — for free, in real time.

**How it works technically:**
- `engine.py → load_network(place_name)` calls `osmnx.graph_from_place(place_name, network_type="drive", simplify=True)`
- Downloads only drivable roads (motorways, trunks, residential streets, etc.)
- Graph simplification merges redundant junction nodes to reduce complexity
- Returns a `networkx.MultiDiGraph` with `length` (metres) on every edge

**Geospatial behaviour:**
- Raw graph is in WGS-84 (EPSG:4326, degrees)
- Immediately reprojected to the best-fit UTM zone via `utils_geo.py → project_graph_to_utm()` which calls `osmnx.project_graph()` and reads the resulting EPSG code from `G.graph["crs"]`
- All subsequent geometry operations (flood masking, nearest-node snapping, distance computation) work in metres

**Stakeholder:** Emergency services, urban planners, government agencies

---

#### 1.2 In-Process Graph Cache

**Plain English:** Once a city's road map has been downloaded, it stays in memory. Every subsequent request for the same city responds instantly.

**How it works technically:**
- `api.py → _graph_cache: Dict[str, Tuple[nx.MultiDiGraph, int]]` stores `(G_projected, epsg)` keyed by place name
- `_get_or_load_graph(place_name)` acquires `_cache_lock` (a `threading.Lock`) before checking the cache, preventing race conditions on concurrent first requests
- Deep-copy is taken via `copy.deepcopy(G)` before each flood experiment so the shared cached graph is never mutated
- Cache eviction available via `DELETE /cache/{place_name}`

**Stakeholder:** System operators, API integrators requiring low-latency repeated queries

---

#### 1.3 Place Bounding-Box Validation

**Plain English:** Requests are validated to ensure the submitted coordinate actually falls within the city being queried, returning a clear error if not.

**How it works technically:**
- `api.py → _get_place_bbox(place_name, G)` reprojects graph nodes to WGS-84 with `osmnx.graph_to_gdfs`, extracts min/max lat/lon, and adds a 0.15° (~15 km) padding buffer
- Cached in `_bbox_cache` keyed by place name
- `/analyze` and `/route` endpoints guard every request with this check before running Dijkstra

**Stakeholder:** API consumers — surfaces a helpful `422` error instead of a silent wrong result

---

### Category 2 — Facility Loading

#### 2.1 Live OSM Facility Fetch

**Plain English:** The engine fetches the current, real-world locations of hospitals, schools, police stations, and fire stations directly from OpenStreetMap.

**How it works technically:**
- `utils_geo.py → fetch_facilities_from_osm(place_name, crs_epsg, amenity_tags)` calls `osmnx.features_from_place` for each tag in `amenity_tags`
- Default tags: `["hospital", "school", "police", "fire_station"]`
- Polygon and MultiPolygon results (buildings mapped as areas) are reduced to their `.centroid`
- Returned as a `GeoDataFrame` reprojected to the graph's UTM CRS
- Stable `facility_id` strings assigned: `FAC_0000`, `FAC_0001`, …

**Stakeholder:** All — this is the basis for all accessibility analysis

---

#### 2.2 Hard-Coded Fallback Facility Set

**Plain English:** If the live OSM query fails (e.g. due to network issues or API limits), the system automatically falls back to a pre-loaded set of 10 real Navi Mumbai hospitals and schools.

**How it works technically:**
- `main.py → _FALLBACK_FACILITIES` — 10 real facility dicts with name, type, lat, lon
- `main.py → build_fallback_gdf(crs_epsg)` converts them to a projected GeoDataFrame
- `/simulate` and `/analyze` endpoints catch any `fetch_facilities_from_osm` exception and invoke the fallback without surfacing an error to the caller

> ⚠️ **Note:** The fallback set is Navi Mumbai-specific. For other cities this fallback will return geographically wrong facilities.

**Stakeholder:** System operators — ensures resilience during OSM API outages

---

#### 2.3 Custom GeoJSON Facility File Loading

**Plain English:** Advanced users can supply their own facility dataset as a GeoJSON file (e.g. a government-provided hospital register) instead of relying on OSM data.

**How it works technically:**
- `utils_geo.py → load_facilities_from_file(geojson_path, crs_epsg)` reads any GeoJSON via `geopandas.read_file`
- Polygon geometries are centrered automatically (`.centroid`)
- Auto-generates `facility_id`, `type`, `name` columns if absent
- Reprojects from EPSG:4326 to the target CRS

**Stakeholder:** Governments and insurers with proprietary facility registers

---

### Category 3 — Flood Zone Modelling

#### 3.1 Circular Flood Zone Construction

**Plain English:** A flood zone is defined by a centre point (latitude, longitude) and a radius in metres. The system creates an accurate circular polygon in real-world metres, not a rough degree-based approximation.

**How it works technically:**
- `utils_geo.py → flood_circle(center_lat, center_lon, radius_m, crs_epsg)` projects the centre to UTM using `pyproj.Transformer`, calls `Point(cx, cy).buffer(radius_m)` in metric space, and returns the Shapely `Polygon` in the same UTM CRS as the road graph
- The matching `flood_infrastructure.py → circle_to_bbox_and_poly(center_lat, center_lon, radius_m)` does the same but also returns a WGS-84 reprojection for Overpass API queries

**Geospatial behaviour:**
- UTM zone is auto-selected: `utm_zone = int((center_lon + 180) / 6) + 1`
- Southern hemisphere supported: EPSG 327xx series used when `center_lat < 0`
- The resulting polygon is the intersection source for road edge masking

**Stakeholder:** Emergency response coordinators, insurers, urban planners

---

#### 3.2 Road Edge Flood Masking

**Plain English:** Every road segment that passes through the flood zone is marked as blocked. The system then routes around these blocked roads in the crisis scenario.

**How it works technically:**
- `engine.py → apply_flood_mask(G, flood_polygons)` iterates over every edge `(u, v, k, data)` in the projected graph
- For each edge, `get_edge_geometry(G, u, v, k)` retrieves the actual road geometry (a `LineString`), falling back to a straight line between nodes when OSM stores no detailed geometry
- `edge_geom.intersects(flood_union)` — Shapely boolean intersection test
- Sets `data["blocked"] = True/False` on every edge in-place
- Logs blocked/total count and percentage

**Stakeholder:** All — this is the core of the flood simulation

---

#### 3.3 Crisis Subgraph Construction

**Plain English:** From the road network with blocked edges tagged, the system creates a second "crisis" version of the network with all blocked roads physically removed.

**How it works technically:**
- `engine.py → build_crisis_graph(G)` collects all `(u, v, k)` triples where `data["blocked"] == True`
- Calls `nx.restricted_view(G, nodes=[], edges=blocked_edges)` — this creates a **read-only view** of the original graph without the blocked edges, avoiding a full deep copy for memory efficiency
- Dijkstra algorithms operate on this view as if those edges do not exist

**Stakeholder:** Emergency services — determines reachability after the flood

---

### Category 4 — Flood-Aware Routing & Accessibility Analysis

#### 4.1 Dual-Pass Dijkstra — Nearest Facility Search

**Plain English:** For a given starting point (e.g. an incident location or citizen address), the system finds the nearest reachable hospital/police station/fire station under both normal conditions AND flood conditions. If the closest facility gets cut off by the flood, it automatically finds the next nearest one.

**How it works technically:**
- `engine.py → find_nearest_facility(G, origin_node, snapped_facilities)` uses `nx.single_source_dijkstra_path_length(G, origin_node, weight="length")` — a single Dijkstra expansion from the origin that yields distances to **all** reachable nodes
- Iterates over all pre-snapped facilities to find the minimum reachable distance
- Called twice: once on `G_work` (baseline), once on `G_crisis`
- `api.py → analyze()` compares the two hits: if `crisis_hit.facility_id != baseline_hit.facility_id` then `rerouted = True`

**Geospatial behaviour:**
- Origin point is snapped to the nearest road graph node via `utils_geo.py → get_nearest_node()` which reprojects the WGS-84 query coordinate to the graph's UTM CRS before calling `osmnx.distance.nearest_nodes()`
- Distance is reported in metres (the `length` edge attribute from OSMnx)

**Stakeholder:** Emergency services (nearest hospital routing), governments (crisis routing infrastructure)

---

#### 4.2 Detour Factor Classification

**Plain English:** The system doesn't just say "accessible" or "not accessible." It quantifies *how much worse* the route got — a number that lets emergency services and insurers prioritise which areas need the most urgent attention.

**How it works technically:**
- `detour_factor = crisis_dist_m / baseline_dist_m`
- Classification thresholds (from `engine.py`):
  - `detour_factor < 1.2` and same facility → `FULLY_ACCESSIBLE`
  - `detour_factor ≥ 1.2` OR different facility → `LIMITED_ACCESS`
  - No path in crisis graph → `CUT_OFF`, `detour_factor = "INF"`
- `DETOUR_THRESHOLD = 1.2` is a named constant in `engine.py`

**Stakeholder:** Insurers (risk classification), government emergency planners (triage)

---

#### 4.3 Origin-in-Flood-Zone Guard

**Plain English:** If the starting point itself is inside the flood zone, the system immediately rejects the request with a clear explanation — because no outward route can exist from a flooded location.

**How it works technically:**
- `api.py → _origin_in_flood_zone(lat, lon, flood, epsg)` reprojects both the origin point and the flood centre to UTM, constructs the flood circle, and tests `flood_poly.contains(Point(ox, oy))`
- Returns `422 Unprocessable Entity` with a descriptive message indicating the origin is flooded

**Stakeholder:** API consumers — prevents silent bad results

---

#### 4.4 City-Wide Flood Simulation

**Plain English:** In one API call, the system analyses every single hospital, school, police station, and fire station in a city simultaneously and returns a ranked table of which ones are affected and how badly.

**How it works technically:**
- `POST /simulate` → `api.py → simulate()`
- Fetches all facilities via OSM, runs `engine.py → run_dual_pass_dijkstra(G_baseline, G_crisis, facilities_gdf, hub_node)` for every facility
- Results can be filtered by `status_filter` list, sorted by `sort_by` field (`baseline_dist_m`, `flood_dist_m`, `detour_factor`, `status`), and sliced to `top_n`
- Hub node (the reference point for the simulation) defaults to Navi Mumbai centre but is configurable per request

**Stakeholder:** Government emergency management, urban planners, insurers needing portfolio-level risk assessment

---

#### 4.5 Facility Snapping to Road Graph

**Plain English:** A hospital's front door may not sit exactly on a routable road. The system automatically pins each facility to the nearest road junction so routing is physically valid.

**How it works technically:**
- `engine.py → snap_facilities_to_nodes(G, facilities_gdf)` calls `get_nearest_node` for every facility point
- Facilities that cannot be snapped (exception raised) are silently dropped with a warning log entry
- Snapped results are cached in `_facility_cache` keyed by `"place_name::facility_type"` in `api.py`

**Stakeholder:** All — ensures routing results are physically meaningful

---

### Category 5 — Globe-Rendering Path Output

#### 5.1 Road-Following Path Geometry

**Plain English:** The system doesn't just report a distance — it returns the full turn-by-turn road path as a sequence of GPS coordinates, ready to be drawn on any map or 3D globe.

**How it works technically:**
- `POST /route` → `api.py → route()`
- `engine.py → get_detailed_path_coords(G, path)` walks every consecutive node pair in the Dijkstra path, reads the OSM `geometry` attribute of each edge (a `LineString` with road curves), and reprojects each vertex from UTM to WGS-84
- Falls back to straight-line segments for edges without stored geometry
- Each coordinate is assigned a unique stable ID: `fac-{pass_num:02d}-{coord_num:03d}` (e.g. `fac-01-001`)

**Geospatial behaviour:**
- Baseline path → `pass_num = 01`; crisis path → `pass_num = 02`
- Returns `List[{id, lat, lon}]` directly consumable by deck.gl `PathLayer` or Cesium `PolylineGraphics`

**Stakeholder:** Application developers building interactive mapping UIs

---

#### 5.2 Blocked Edge Geometry Export

**Plain English:** Returns the exact GPS coordinates of every road segment that was blocked by the flood, enabling a map to draw the flood-affected road network in red.

**How it works technically:**
- `engine.py → get_blocked_edge_coords(G)` iterates all edges with `blocked=True`, deduplicates anti-parallel edge pairs (prevents drawing `u→v` and `v→u` twice), extracts or synthesises road geometry, and reprojects to WGS-84

**Stakeholder:** Dashboard/visualisation developers

---

### Category 6 — Critical Infrastructure Extraction

#### 6.1 Flood-Zone Infrastructure Inventory

**Plain English:** Given a flood zone (latitude, longitude, radius), the system enumerates every hospital, school, police station, fire station, pharmacy, place of worship, community centre, and key building category physically located inside that zone — directly from OpenStreetMap.

**How it works technically:**
- `POST /flood-infrastructure` → `api.py → flood_infrastructure()`
- `flood_infrastructure.py → query_flood_infrastructure()` issues 10 separate Overpass QL queries (`[out:json][timeout:90]`) to `https://overpass-api.de/api/interpreter`
- One query per tag: `amenity=hospital`, `amenity=school`, `amenity=police`, `amenity=fire_station`, `amenity=pharmacy`, `amenity=place_of_worship`, `amenity=community_centre`, `building=residential`, `building=commercial`, `building=yes`
- All three OSM element types queried per tag: `node`, `way`, `relation`

**OSM tag → feature_type mapping:**

| OSM Tag | Feature Type |
|---|---|
| `amenity=hospital` | `hospital` |
| `amenity=school` | `school` |
| `amenity=police` | `police` |
| `amenity=fire_station` | `fire_station` |
| `amenity=pharmacy` | `pharmacy` |
| `amenity=place_of_worship` | `place_of_worship` |
| `amenity=community_centre` | `community_centre` |
| `building=residential` | `residential_building` |
| `building=commercial` | `commercial_building` |
| `building=yes` | `building` |

**Stakeholder:** Government emergency management, urban planners, insurers

---

#### 6.2 Polygon Centroid Computation

**Plain English:** Many buildings in OpenStreetMap are stored as polygons (outlines), not as single points. The system automatically computes the centre of each enclosed building and uses that as the representative coordinate.

**How it works technically:**
- `flood_infrastructure.py → _way_to_centroid(element)`: reads the Overpass `geometry` list of `{lat, lon}` dicts (returned by `out geom;`), constructs a Shapely `Polygon` from the ring coordinates, and calls `.centroid`
- Falls back to a `LineString` centroid for open ways (roads tagged as buildings)
- `_relation_to_centroid(element)`: collects all member-way rings into a list of polygons, calls `unary_union(all_polys).centroid`
- Final fallback for all types: reads Overpass `center` field if present

**Stakeholder:** Any consumer of the infrastructure GeoJSON — ensures point output is geographically sensible

---

#### 6.3 Circular Flood Polygon Membership Filtering

**Plain English:** The bounding-box query from Overpass may return features that are in the corners of the box but technically outside the circular flood zone. The system filters these out so only features genuinely inside the circle are included.

**How it works technically:**
- `circle_to_bbox_and_poly()` returns both the bbox (for the Overpass query) and the WGS-84 Shapely polygon (for post-query filtering)
- `_extract_features(overpass_data, feature_type, flood_polygon)` tests `flood_polygon.contains(Point(lon, lat))` for every extracted centroid
- Elements where the test fails are silently dropped

**Stakeholder:** Insurers and governments who need precise within-zone counts, not bounding-box over-estimates

---

#### 6.4 Deduplication Across Tag Categories

**Plain English:** A building tagged as both `amenity=hospital` and `building=yes` in OSM would appear in two of the 10 queries. The system ensures it only appears once in the output.

**How it works technically:**
- `query_flood_infrastructure()` maintains a `seen_ids: set` across all 10 tag queries
- Each element's `feature_id` (`"node/12345678"` or `"way/87654321"`) is checked against this set before appending

**Stakeholder:** Any consumer — prevents double-counting

---

#### 6.5 Overpass API Rate-Limit Handling

**Plain English:** The public Overpass API sometimes rate-limits or returns errors. The system automatically waits and retries — up to 4 times with exponentially increasing wait periods — before giving up.

**How it works technically:**
- `flood_infrastructure.py → _post_overpass(query, max_retries, retry_sleep)` handles HTTP 429, 503, 504 status codes with a `time.sleep(sleep); sleep *= 2` exponential back-off
- Connection and timeout exceptions are also caught and retried
- `tag_sleep=1.5s` default inter-query delay between the 10 tag categories
- All retry parameters are configurable via the `FloodInfraRequest` model (`max_retries`, `retry_sleep`, `tag_sleep`)

**Stakeholder:** System operators — ensures reliable data collection without manual intervention

---

#### 6.6 Dual-Format Output (GeoJSON + CSV)

**Plain English:** Results of the infrastructure extraction are saved as both a GeoJSON file (for loading into GIS tools like QGIS or ArcGIS) and a CSV file (for loading into Excel, databases, or analysis tools), with every feature labelled `flood_risk=true`.

**How it works technically:**
- `_to_geojson(features)` builds a standard `FeatureCollection` with each feature as a `Point` geometry and all attributes in `properties`
- `_to_csv_df(features)` builds a pandas `DataFrame` with columns: `feature_id, name, feature_type, latitude, longitude, flood_risk`
- Both files written to the `output_dir` / `output_prefix` specified in the request
- Paths to both files returned in the API response alongside the full GeoJSON body

**Stakeholder:** Government offices, insurers, urban planners needing portable output files

---

### Category 7 — State Table & Persistence

#### 7.1 State Table Generation (JSON + CSV)

**Plain English:** After every simulation, the complete results table is saved to disk as both a JSON file and a CSV file — a permanent record of accessibility status at the time of the analysis.

**How it works technically:**
- `engine.py → generate_state_table(results, output_path, also_csv)` serialises the results list with `json.dump(results, fh, indent=2)` and `pd.DataFrame(results).to_csv(csv_path, index=False)`
- Output path defaults to `state_table.json` alongside the script
- The `/simulate` endpoint optionally writes to disk when `save_to_disk=True`

**Schema per record:**

| Column | Type | Description |
|---|---|---|
| `facility_id` | string | Stable ID, e.g. `FAC_0001` |
| `name` | string | Human-readable facility name from OSM |
| `type` | string | `hospital`, `school`, `police`, `fire_station` |
| `lat` | float | Facility latitude (WGS-84) |
| `lon` | float | Facility longitude (WGS-84) |
| `nearest_node` | int | OSM graph node ID the facility was snapped to |
| `baseline_dist_m` | float / null | Shortest-path distance under normal conditions |
| `flood_dist_m` | float / null | Shortest-path distance under flood conditions |
| `detour_factor` | float / "INF" | `flood_dist_m / baseline_dist_m` |
| `status` | string | `FULLY_ACCESSIBLE` / `LIMITED_ACCESS` / `CUT_OFF` |

**Stakeholder:** Government record-keeping, insurer risk databases, audit trails

---

### Category 8 — Logging & Audit Trail

#### 8.1 Rotating File Logging

**Plain English:** Every action the system takes — downloading a road network, running a query, blocking edges, completing an analysis — is written to a log file. Old logs are automatically rotated so disk space is never exhausted.

**How it works technically:**
- `log_config.py → setup_logging()` attaches a `RotatingFileHandler` to the root logger: 10 MB per file, 5 backup files (`lifeline_engine.log`, `lifeline_engine.log.1`, …)
- Full `DEBUG` level to file even when console shows `INFO`
- Log format: `YYYY-MM-DD HH:MM:SS  LEVEL     [module.name]  message`

**Stakeholder:** System operators, auditors

---

#### 8.2 Coloured Console Logging

**Plain English:** When running interactively in a terminal, log messages are colour-coded: green for normal operations, yellow for warnings, red for errors — making it easy to spot problems at a glance.

**How it works technically:**
- `log_config.py → _ColouredFormatter` applies ANSI codes only when `sys.stdout.isatty()` returns `True` (i.e. a real terminal, not a container or pipe)
- Colours: DEBUG=cyan, INFO=green, WARNING=yellow, ERROR=red, CRITICAL=magenta

**Stakeholder:** Developers during local development and debugging

---

#### 8.3 JSON-Structured Log Output (Opt-In)

**Plain English:** For automated log ingestion into tools like Elasticsearch, Datadog, or AWS CloudWatch, the system can output logs as structured JSON instead of plain text.

**How it works technically:**
- Enabled by setting `LOG_JSON=1` environment variable
- Attaches a second `RotatingFileHandler` to `lifeline_engine_json.log` using `python-json-logger`'s `JsonFormatter`
- Fields: `timestamp`, `level`, `name`, `message`
- Gracefully falls back to plain formatter if `python-json-logger` is not installed

**Stakeholder:** DevOps and platform engineers

---

#### 8.4 Third-Party Logger Suppression

**Plain English:** Libraries like `shapely`, `fiona`, `urllib3`, and `osmnx` are very verbose at DEBUG level. The logging system suppresses these noisy loggers so only application-level messages appear.

**How it works technically:**
- `log_config.py → _QUIET_LOGGERS` list silences: `urllib3`, `fiona`, `pyproj`, `shapely`, `matplotlib`, `asyncio`, `httpx`, `httpcore`, `osmnx`
- Each is set to `logging.WARNING`

**Stakeholder:** Developers — keeps log output readable

---

### Category 9 — API Layer

#### 9.1 Automatic OpenAPI / Swagger Documentation

**Plain English:** Every API endpoint is fully self-documenting. Visit `/docs` in a browser to get an interactive form where you can test every endpoint with real data — no Postman configuration required.

**How it works technically:**
- FastAPI automatically generates OpenAPI 3.0 specification from Pydantic model schemas and endpoint docstrings
- Swagger UI served at `/docs`, ReDoc at `/redoc`
- All field descriptions, examples, and validation constraints (ge, le, gt) are reflected in the schema

**Stakeholder:** API consumers, integrators

---

#### 9.2 Pydantic v2 Request Validation

**Plain English:** The API validates every incoming request before executing it. Nonsensical values — like a latitude of exactly 90° (which usually means an uninitialised variable) — are rejected with a descriptive error message.

**How it works technically:**
- `Coords`, `FloodConfig`, `FloodInfraRequest`, `AnalyzeRequest`, `SimulateRequest`, `RouteRequest` are all Pydantic v2 `BaseModel` classes
- `model_validator(mode="after")` hooks reject boundary extremes: `lat ∈ {-90.0, 90.0}`, `lon ∈ {-180.0, 180.0}`
- FastAPI returns `422 Unprocessable Entity` with field-level error details on validation failure

**Stakeholder:** API integrators — fast, clear feedback on bad inputs

---

#### 9.3 Non-Fatal Warning System

**Plain English:** When the engine detects something unusual (e.g. a flood zone that doesn't intersect any roads, or an origin coordinate co-located with a hospital), it still returns a result but includes a `warnings` list explaining what was observed.

**How it works technically:**
- `analyze()` and `simulate()` accumulate `analysis_warnings: List[str]` / `sim_warnings: List[str]`
- Conditions detected: origin node == facility node (distance=0 likely wrong), 0 blocked edges (flood may be outside city), rerouting event
- Warnings propagate into `AnalyzeResponse.warnings` and `SimulateResponse.warnings`

**Stakeholder:** API consumers who need to distinguish between a clean result and a result with caveats

---

### Category 10 — Load Testing Infrastructure

#### 10.1 Locust Load Test Scenarios

**Plain English:** The repository includes a ready-to-run load test script that simulates hundreds of concurrent users hitting the API endpoints simultaneously — allowing engineers to measure how the system performs under stress.

**How it works technically:**
- `Lifeline_Engine/locustfile.py` defines Locust user classes targeting `/analyze`, `/simulate`, `/route`, and `/health`
- Run with: `locust -f Lifeline_Engine/locustfile.py --host http://localhost:8000`

**Stakeholder:** DevOps, performance engineers

---

#### 10.2 Async Smoke Tests

**Plain English:** A lightweight test script verifies that all API endpoints return valid responses — useful for CI/CD pipelines before deployment.

**How it works technically:**
- `Lifeline_Engine/test_load.py` uses `httpx` (async HTTP client) to fire requests to each endpoint
- Run with: `python Lifeline_Engine/test_load.py`

**Stakeholder:** CI/CD pipelines, QA

---

## Limitations & Known Constraints

| Limitation | Detail |
|---|---|
| In-memory graph cache | Graphs are cached in-process only. Server restart clears the cache; all graphs must be re-downloaded. No persistent graph store. |
| Fallback facilities are Navi Mumbai-specific | The hard-coded fallback in `main.py` has real coordinates only for Navi Mumbai. Other cities will fall back to geographically wrong facilities. |
| Circular flood zones only | The flood geometry is always a circle. Irregular polygon flood zones are not supported in routing (only in the infrastructure extraction endpoint via the `_flood_shape` parameter). |
| No authentication | All API endpoints are publicly accessible. No API key, OAuth, or rate limiting is implemented. |
| No satellite imagery processing | The system uses road network and POI data from OSM. It does not ingest, process, or analyse satellite raster data directly. Flood zone definition must be provided by the caller. |
| Overpass API dependency | `/flood-infrastructure` requires an external public API. During high-load periods the Overpass API may be slow or unavailable despite the retry mechanism. |
| No persistent database | State tables are written to local disk files. There is no database backend for querying historical analyses. |

---

## Planned / Potential Enhancements

> These are areas where the architecture naturally extends but are not currently implemented.

- **Satellite-derived flood polygon ingestion** — accept Sentinel-1 SAR or Sentinel-2 NDWI raster output as the flood zone input instead of a manual circle
- **Temporal change detection** — compare state tables from multiple simulation timestamps to track facility accessibility degradation over time
- **Predictive flood risk modelling** — integrate rainfall forecasting APIs (e.g. Open-Meteo) to project flood zone growth
- **Persistent state table database** — replace file-based output with a PostGIS or SQLite backend
- **Authentication & rate limiting** — API key middleware for production deployments
- **Multi-polygon flood support** — accept GeoJSON `MultiPolygon` inputs for the routing engine (flood infrastructure extraction already supports this)
