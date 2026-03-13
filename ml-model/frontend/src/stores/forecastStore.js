import { create } from "zustand";
import { forecastApi } from "../api/forecastApi.js";

export const useForecastStore = create((set, get) => ({
  // ── District-level batch forecasts ─────────────────────────────────
  districts: [],            // [{name, lat, lon, overall_max_prob, alert_level, daily_forecasts, ...}]
  selectedDistrict: null,   // currently selected district object
  bbox: null,               // [west, south, east, north]
  forecastDays: 14,

  // ── Single-point multiday forecast ──────────────────────────────────
  singleForecast: null,     // result of /forecast/multiday for a single point

  // ── What-if scenario ────────────────────────────────────────────────
  whatIfResult: null,        // result of /predict_raw

  // ── Loading / error ─────────────────────────────────────────────────
  isLoading: false,
  error: null,

  // ── Actions ─────────────────────────────────────────────────────────

  /** Fetch 14-day forecasts for all districts in a bounding box. */
  fetchDistrictForecasts: async (bbox, forecastDays = 14, maxDistricts = 9) => {
    set({ isLoading: true, error: null, districts: [], selectedDistrict: null, bbox });

    const { data, error } = await forecastApi.forecastDistricts(bbox, forecastDays, maxDistricts);

    if (error) {
      set({ isLoading: false, error });
      return;
    }

    set({
      districts: data.districts ?? [],
      forecastDays: data.forecast_days ?? forecastDays,
      isLoading: false,
    });

    // Auto-select the first (highest risk) district
    if (data.districts?.length > 0) {
      set({ selectedDistrict: data.districts[0] });
    }
  },

  /** Fetch 14-day forecast for a single lat/lon point. */
  fetchSingleForecast: async (lat, lon, forecastDays = 14) => {
    set({ isLoading: true, error: null, singleForecast: null });

    const { data, error } = await forecastApi.forecastMultiday(lat, lon, forecastDays);

    if (error) {
      set({ isLoading: false, error });
      return;
    }

    set({ singleForecast: data, isLoading: false });
  },

  /** Run what-if prediction from raw features. */
  fetchWhatIf: async (precipMm, soilMoisture, tempC, elevM) => {
    const { data, error } = await forecastApi.predictRaw(precipMm, soilMoisture, tempC, elevM);
    if (error) {
      set({ error });
      return;
    }
    set({ whatIfResult: data });
  },

  /** Select a district to show its detail. */
  selectDistrict: (district) => set({ selectedDistrict: district }),

  /** Clear all state. */
  clear: () => set({
    districts: [],
    selectedDistrict: null,
    singleForecast: null,
    whatIfResult: null,
    bbox: null,
    isLoading: false,
    error: null,
  }),
}));
