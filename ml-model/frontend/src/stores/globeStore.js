import { create } from "zustand";

const RUNNING_STATUSES = ["queued", "preprocessing", "detecting", "scoring"];

export const useGlobeStore = create((set, get) => ({
  // ── Region Selection ──
  country: null,
  state: null,
  city: null,
  setCountry: (c) => set({ country: c, state: null, city: null }),
  setState: (s) => set({ state: s, city: null }),
  setCity: (c) => set({ city: c }),

  // Geocoded result (from Nominatim)
  geocoded: null,
  setGeocoded: (g) => set({ geocoded: g, regionConfirmed: false }),
  /** Update only boundary/bbox (e.g. after lookup returns real admin border). */
  setGeocodedBoundary: (boundary_geojson, bbox) =>
    set((s) =>
      s.geocoded ?
        {
          geocoded: {
            ...s.geocoded,
            boundary_geojson,
            bbox: bbox ?? s.geocoded.bbox,
          },
        }
      : s,
    ),

  // User must confirm the highlighted region before analysis
  regionConfirmed: false,
  setRegionConfirmed: (v) => set({ regionConfirmed: v }),
  clearRegionSelection: () => set({ geocoded: null, regionConfirmed: false }),

  // Date selection
  analysisDate: null,
  setAnalysisDate: (d) => set({ analysisDate: d }),

  // ── Detection Run State ──
  runId: null,
  status: "idle",
  progress: 0,
  error: null,
  setRunState: (patch) => set(patch),

  // ── Results ──
  result: null,
  setResult: (r) => set({ result: r }),

  // ── Globe Interaction ──
  selectedZone: null,
  setSelectedZone: (z) => set({ selectedZone: z }),

  overlayMode: "both",
  setOverlayMode: (m) => set({ overlayMode: m }),

  barMetric: "flood_depth",
  setBarMetric: (m) => set({ barMetric: m }),

  // ── Actions ──
  resetRun: () =>
    set({
      runId: null,
      status: "idle",
      progress: 0,
      error: null,
      result: null,
      selectedZone: null,
    }),

  // Fully flush everything out
  hardReset: () =>
    set({
      country: null,
      state: null,
      city: null,
      geocoded: null,
      regionConfirmed: false,
      analysisDate: null,
      runId: null,
      status: "idle",
      progress: 0,
      error: null,
      result: null,
      selectedZone: null,
    }),

  // Computed
  isRunning: () => RUNNING_STATUSES.includes(get().status),
}));
