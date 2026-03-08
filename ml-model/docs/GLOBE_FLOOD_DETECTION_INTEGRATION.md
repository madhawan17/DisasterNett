# Cesium Globe & Flood Detection — Integration Plan

This document describes how the Cesium globe, region selection, and flood detection pipeline work end-to-end: **what you collect from users**, **what you display**, **what you send to the backend**, and **what structure the backend must return**. Use it to integrate the feature without mismatches.

---

## 1. High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  USER INPUT (RegionForm)                                                         │
│  • City / State / Country search (Nominatim)                                     │
│  • Analysis date (optional)                                                      │
│  • "Analyze Flood Risk" button                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  STORE (globeStore)                                                              │
│  • country, state, city (hierarchy)                                               │
│  • geocoded = { lat, lon, bbox, boundary_geojson, display_name, ... }           │
│  • analysisDate (YYYY-MM-DD)                                                      │
│  • runId, status, progress, error (run state)                                    │
│  • result = { summary, flood_zones, grid_points } (when completed)               │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
          ┌─────────────────────────────┼─────────────────────────────┐
          ▼                             ▼                             ▼
┌──────────────────┐         ┌──────────────────┐         ┌──────────────────┐
│  CESIUM GLOBE    │         │  REGION FORM     │         │  RESULTS PANEL    │
│  • Fly to region │         │  • Submit run    │         │  • Summary stats  │
│  • Boundary + pin│         │  • Poll status   │         │  • Zone list      │
│  • Flood zones   │         │  • Mock mode     │         │  • Zone select →  │
│  • Zone pins     │         │                  │         │    fly on globe    │
└──────────────────┘         └──────────────────┘         └──────────────────┘
          │                             │
          │                             ▼
          │                  ┌──────────────────┐
          │                  │  BACKEND API     │
          │                  │  POST /flood-detect
          │                  │  GET  /flood-detect/{runId}
          │                  └──────────────────┘
          │                             │
          └─────────────────────────────┘
                        result → store → globe + panel
```

---

## 2. Data Structures (Explicit Contracts)

### 2.1 What You COLLECT From Users

| Source | Field | Type | Required | Notes |
|--------|--------|------|----------|--------|
| RegionForm | City / District | string (search → selection) | No | User types; selects from Nominatim dropdown |
| RegionForm | State / Province | string (search → selection) | No | Same |
| RegionForm | Country | string (search → selection) | No | Same |
| RegionForm | Analysis Date | string `YYYY-MM-DD` | No | `<input type="date">`; defaults to today if omitted |

**Important:** The user must select **at least one** place (city, state, or country) from the autocomplete. That selection is what populates `geocoded` and is required before "Analyze Flood Risk" is allowed.

---

### 2.2 Geocoded Object (After User Selects a Place)

This is **derived** from Nominatim + `parseNominatimResult()`, then stored in `globeStore.geocoded`. The frontend never sends raw Nominatim JSON; it sends the **payload** below, which is built from this object.

| Field | Type | Source | Used for |
|-------|------|--------|----------|
| `lat` | number | Nominatim `lat` | Center of region, pin, fly-to |
| `lon` | number | Nominatim `lon` | Same |
| `bbox` | `[west, south, east, north]` (4 numbers) | Nominatim `boundingbox` → reordered | Camera flyTo rectangle |
| `boundary_geojson` | GeoJSON (Polygon/MultiPolygon) or null | Nominatim `geojson` | Region outline on globe |
| `display_name` | string | Built from city/state/country | UI label, payload.region.display_name |
| `country_code` | string (e.g. `"IN"`) | Nominatim `address.country_code` | UI only |
| `city` | string | address.city / town / village | Optional display |
| `state` | string | address.state / region | Optional display |
| `country` | string | address.country | Optional display |
| `address` | object | Nominatim `address` | Optional downstream |

**Nominatim bbox:** API returns `[minLat, maxLat, minLon, maxLon]`. The frontend converts to **Cesium/GeoJSON order** `[west, south, east, north]` = `[bbox[2], bbox[0], bbox[3], bbox[1]]`.

---

### 2.3 Payload SENT to Backend (Submit Detection)

**Endpoint:** `POST /api/v1/flood-detect`  
**Body (JSON):**

```json
{
  "region": {
    "center":           { "lat": number, "lon": number },
    "bbox":             [ west, south, east, north ],
    "boundary_geojson": GeoJSON Polygon/MultiPolygon or null,
    "display_name":     string
  },
  "date":    "YYYY-MM-DD",
  "options": { "sensor": "S1_GRD", "detector": "unet" }
}
```

| Field | Type | From store | Notes |
|-------|------|------------|--------|
| `region.center` | `{ lat, lon }` | `geocoded.lat`, `geocoded.lon` | Center of AOI |
| `region.bbox` | number[4] | `geocoded.bbox` | [west, south, east, north] |
| `region.boundary_geojson` | GeoJSON or null | `geocoded.boundary_geojson` | Full boundary from Nominatim |
| `region.display_name` | string | `geocoded.display_name` | e.g. "Kerala, India" |
| `date` | string | `analysisDate` or today (ISO date slice) | Analysis date |
| `options.sensor` | string | Hardcoded | e.g. `S1_GRD` |
| `options.detector` | string | Hardcoded | e.g. `unet` |

**Example:**

```json
{
  "region": {
    "center": { "lat": 10.8505, "lon": 76.2711 },
    "bbox": [76.0, 8.5, 77.2, 12.8],
    "boundary_geojson": { "type": "Polygon", "coordinates": [ ... ] },
    "display_name": "Kerala, India"
  },
  "date": "2026-02-28",
  "options": { "sensor": "S1_GRD", "detector": "unet" }
}
```

---

### 2.4 Backend Response (Submit) — Immediate

**Expected:** `200 OK` or `202 Accepted` with JSON:

```json
{
  "run_id": "uuid-or-string",
  "status": "queued"
}
```

The frontend stores `run_id` and `status`, then starts polling.

---

### 2.5 Backend Response (Poll) — Status

**Endpoint:** `GET /api/v1/flood-detect/{runId}`

**While running:** status + optional progress

```json
{
  "run_id": "uuid",
  "status": "queued" | "preprocessing" | "detecting" | "scoring",
  "progress": 0
}
```

**On completion:** status + full result

```json
{
  "run_id": "uuid",
  "status": "completed",
  "result": { ... }
}
```

**On failure:**

```json
{
  "run_id": "uuid",
  "status": "failed",
  "error": "Error message string"
}
```

The frontend calls `store.setResult(data.result)` only when `status === 'completed'`.

---

### 2.6 Backend Response (Completed) — Full `result` Object

This is the **exact structure** the frontend and Cesium globe expect. Your backend must return `result` in this shape when `status === 'completed'`.

```json
{
  "summary": {
    "total_flood_area_km2": number,
    "avg_depth_m": number,
    "max_depth_m": number,
    "population_exposed": number,
    "confidence_avg": number,
    "zones_count": number,
    "region_name": string,
    "scene_id": string,
    "sensor": string,
    "detector": string
  },
  "flood_zones": {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "properties": {
          "zone_id": string,
          "severity": "critical" | "high" | "medium" | "low",
          "area_km2": number,
          "avg_depth_m": number,
          "max_depth_m": number,
          "population_exposed": number,
          "confidence": number,
          "bbox": [ west, south, east, north ],
          "centroid": { "lat": number, "lon": number },
          "admin_name": string
        },
        "geometry": {
          "type": "Polygon",
          "coordinates": [ [ [lon, lat], ... ] ]
        }
      }
    ]
  },
  "grid_points": [
    [ "flood_depth", [ lat1, lon1, value1, lat2, lon2, value2, ... ] ],
    [ "pop_density", [ ... ] ],
    [ "risk_score",  [ ... ] ]
  ]
}
```

**Notes:**

- **GeoJSON** uses `[lon, lat]` per spec; Cesium and the frontend handle this.
- **bbox** in each feature: `[west, south, east, north]` (same as region bbox order).
- **severity** must be one of: `critical`, `high`, `medium`, `low` (used for colors and badges).
- **grid_points**: optional; currently used only if you re-enable bar visualization. Each row is `[ metricKey, flatArray ]` with triplets `lat, lon, value`.

---

## 3. Where Each Structure Is Used in the Frontend

| Data | Where used | Purpose |
|------|------------|---------|
| `geocoded` | CesiumGlobe (useEffect geocoded) | Fly camera to bbox or center; draw boundary_geojson; add center pin |
| `geocoded` | RegionForm | Build payload.region; enable/disable Analyze button; show "Geocoded" readout |
| `result.summary` | ResultsPanel | Flood area, avg depth, pop exposed, confidence |
| `result.flood_zones` | CesiumGlobe | Load GeoJSON into GeoJsonDataSource; style by severity; extrude by depth |
| `result.flood_zones.features[].properties` | CesiumGlobe | Zone pins (centroid), labels (admin_name), colors (severity), flyTo (bbox) |
| `result.flood_zones` | ResultsPanel | Zone list; click zone → setSelectedZone(i) → globe flies to that zone |
| `selectedZone` | CesiumGlobe | Fly camera to `result.flood_zones.features[selectedZone].properties.bbox` |
| `runId`, `status`, `progress` | RegionForm | Polling; ProgressOverlay; button disabled while running |
| `analysisDate` | RegionForm | Sent as `date` in payload; shown in date input |

---

## 4. File-by-File Responsibilities

| File | Responsibility |
|------|-----------------|
| **globeStore.js** | Single source of truth: country/state/city, geocoded, analysisDate, runId/status/progress/error, result, selectedZone. |
| **geocodeApi.js** | Nominatim search (search, searchState, searchCountry); `parseNominatimResult(item)` → normalized geocoded shape. |
| **RegionForm.jsx** | User inputs; debounced geocode search; on select → setCity/setState/setCountry + setGeocoded; build payload; POST /flood-detect; poll GET /flood-detect/{runId}; on completed setResult; mock mode uses mockFloodResponse. |
| **floodDetectApi.js** | `submitDetection(payload)`, `getDetectionStatus(runId)` — POST and GET with JSON. |
| **CesiumGlobe.jsx** | Init Cesium viewer (imagery, globe, sky); when geocoded changes → fly to region, add boundary layer, add center pin; when result changes → load flood_zones GeoJSON, style polygons, add zone pins; when selectedZone changes → fly to zone bbox. |
| **ResultsPanel.jsx** | Renders when result exists: summary cards, zone list; zone click → setSelectedZone(i). |
| **ProgressOverlay.jsx** | Shown when status is running or failed; shows status/progress. |
| **mockFloodResponse.js** | Full `result`-shaped object for mock mode (no backend). |

---

## 5. Backend Integration Checklist

To integrate your real backend with this frontend:

1. **Implement POST /api/v1/flood-detect**
   - Accept body: `{ region: { center, bbox, boundary_geojson, display_name }, date, options }`.
   - Return `{ run_id, status: "queued" }` (or 202).

2. **Implement GET /api/v1/flood-detect/{runId}**
   - Return `{ run_id, status, progress? }` while running.
   - When done: `{ run_id, status: "completed", result: { summary, flood_zones, grid_points? } }`.
   - On error: `{ run_id, status: "failed", error: "message" }`.

3. **Ensure `result.summary`** has: `total_flood_area_km2`, `avg_depth_m`, `max_depth_m`, `population_exposed`, `confidence_avg`, `zones_count`, `region_name`, `scene_id`, `sensor`, `detector`.

4. **Ensure `result.flood_zones`** is a GeoJSON FeatureCollection; each feature:
   - `geometry`: Polygon (or MultiPolygon) with `[lon, lat]` coordinates.
   - `properties`: `zone_id`, `severity` (critical|high|medium|low), `area_km2`, `avg_depth_m`, `max_depth_m`, `population_exposed`, `confidence`, `bbox` [w,s,e,n], `centroid` { lat, lon }, `admin_name`.

5. **Optional:** `result.grid_points` array of `[ "metricKey", [lat,lon,value, ...] ]` if you re-enable bar visualization.

6. **CORS / base URL:** Frontend uses `VITE_API_URL` (default `http://localhost:8000/api/v1`). Ensure backend allows origin and serves at that path.

---

## 6. Mock Mode

If `useAppStore.isMockMode` is true, RegionForm does not call the API. It runs a short timer and then sets `store.setResult(mockFloodResponse)`. So you can develop and demo without a backend; the globe and results panel behave the same.

---

## 7. Summary Diagram (Data Flow)

```
User selects "Kerala, India"
    → Nominatim returns place (lat, lon, bbox, boundary_geojson, display_name)
    → parseNominatimResult() normalizes
    → setGeocoded({ lat, lon, bbox, boundary_geojson, display_name, ... })
    → Globe: fly to bbox, draw boundary, show pin
    → User clicks "Analyze Flood Risk"
    → Payload = { region: { center, bbox, boundary_geojson, display_name }, date, options }
    → POST /flood-detect → { run_id, status }
    → Poll GET /flood-detect/{run_id} every 3s
    → When status === 'completed' → setResult(data.result)
    → Globe: load flood_zones GeoJSON (extruded polygons + zone pins)
    → ResultsPanel: summary + zone list
    → User clicks zone → setSelectedZone(i) → Globe flies to zone bbox
```

Using the **exact payload and result shapes** above will let you plug in your backend and have the Cesium globe and UI work without changes.
