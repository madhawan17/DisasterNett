const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org'

async function nominatimFetch(path, params) {
  try {
    const qs = new URLSearchParams(params)
    const res = await fetch(`${NOMINATIM_BASE}${path}?${qs}`, {
      headers: { 'User-Agent': 'COSMEON-FloodDetection/1.0' },
    })
    if (!res.ok) return { data: null, error: `HTTP ${res.status}` }
    const data = await res.json()
    return { data, error: null }
  } catch (err) {
    return { data: null, error: err?.message ?? 'Geocoding error' }
  }
}

/** True if boundary_geojson is a polygon (actual area), not a Point. */
export function hasAreaGeometry(geocoded) {
  const g = geocoded?.boundary_geojson
  return g && ['Polygon', 'MultiPolygon'].includes(g.type)
}

/** Sort Nominatim results so boundary results (polygon, relation/way) appear first. */
export function sortResultsByBoundary(items) {
  if (!items?.length) return items
  const order = { relation: 0, way: 1, node: 2 }
  return [...items].sort((a, b) => {
    const aHas = a.geojson && ['Polygon', 'MultiPolygon'].includes(a.geojson.type)
    const bHas = b.geojson && ['Polygon', 'MultiPolygon'].includes(b.geojson.type)
    if (aHas && !bHas) return -1
    if (!aHas && bHas) return 1
    return (order[a.osm_type] ?? 2) - (order[b.osm_type] ?? 2)
  })
}

/** Parse a Nominatim result into standardised region info */
export function parseNominatimResult(item) {
  const addr = item.address ?? {}
  const bbox = item.boundingbox?.map(Number) // [south, north, west, east]

  return {
    lat: parseFloat(item.lat),
    lon: parseFloat(item.lon),
    // Nominatim bbox: [minLat, maxLat, minLon, maxLon] → Cesium wants [west, south, east, north]
    bbox: bbox ? [bbox[2], bbox[0], bbox[3], bbox[1]] : null,
    boundary_geojson: item.geojson ?? null,
    display_name: item.display_name,
    // OSM refs for boundary lookup (relation/way have real borders)
    osm_type: item.osm_type ?? null,
    osm_id: item.osm_id != null ? Number(item.osm_id) : null,
    // Address components
    city:    addr.city || addr.town || addr.village || addr.municipality || '',
    state:   addr.state || addr.region || '',
    country: addr.country || '',
    country_code: (addr.country_code ?? '').toUpperCase(),
    // Raw Nominatim address for downstream use
    address: addr,
  }
}

export const geocodeApi = {
  /**
   * Free-text search — best for city lookups.
   * Returns top results with full address details + boundary GeoJSON.
   */
  search(query, options = {}) {
    if (!query.trim()) return Promise.resolve({ data: [], error: null })
    const params = {
      q: query,
      format: 'json',
      addressdetails: '1',
      limit: String(options.limit ?? 6),
      polygon_geojson: '1',
    }
    if (options.countrycodes) params.countrycodes = options.countrycodes
    if (options.featuretype)  params.featuretype  = options.featuretype
    return nominatimFetch('/search', params)
  },

  /** Structured city search — more precise than free-text. */
  searchCity(cityName, options = {}) {
    if (!cityName.trim()) return Promise.resolve({ data: [], error: null })
    const params = {
      city: cityName,
      format: 'json',
      addressdetails: '1',
      limit: String(options.limit ?? 6),
      polygon_geojson: '1',
    }
    if (options.state)        params.state        = options.state
    if (options.country)      params.country      = options.country
    if (options.countrycodes) params.countrycodes = options.countrycodes
    return nominatimFetch('/search', params)
  },

  /** Structured state/province search. */
  searchState(stateName, options = {}) {
    if (!stateName.trim()) return Promise.resolve({ data: [], error: null })
    const params = {
      state: stateName,
      format: 'json',
      addressdetails: '1',
      limit: String(options.limit ?? 6),
      polygon_geojson: '1',
      featuretype: 'state',
    }
    if (options.country)      params.country      = options.country
    if (options.countrycodes) params.countrycodes = options.countrycodes
    return nominatimFetch('/search', params)
  },

  /** Structured country search. */
  searchCountry(countryName, options = {}) {
    if (!countryName.trim()) return Promise.resolve({ data: [], error: null })
    const params = {
      country: countryName,
      format: 'json',
      addressdetails: '1',
      limit: String(options.limit ?? 6),
      polygon_geojson: '1',
      featuretype: 'country',
    }
    return nominatimFetch('/search', params)
  },

  /**
   * Lookup by OSM id to get the full boundary (Polygon/MultiPolygon) for relations/ways.
   * Use when search returned only a Point so the globe can show the actual border.
   */
  lookup(osmType, osmId) {
    if (!osmType || osmId == null) return Promise.resolve({ data: null, error: null })
    const prefix = String(osmType).charAt(0).toUpperCase() // relation -> R, way -> W, node -> N
    const osmIds = `${prefix}${osmId}`
    const params = {
      osm_ids: osmIds,
      format: 'json',
      addressdetails: '1',
      polygon_geojson: '1',
    }
    return nominatimFetch('/lookup', params)
  },
}
