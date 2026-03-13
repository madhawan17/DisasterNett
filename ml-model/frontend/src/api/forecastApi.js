const BASE_URL = import.meta.env.VITE_FORECAST_API_URL;

async function request(method, path, body) {
  try {
    const options = {
      method,
      headers: { "Content-Type": "application/json" },
    };
    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    const res = await fetch(`${BASE_URL}${path}`, options);

    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const json = await res.json();
        message = json?.detail ?? json?.error ?? message;
      } catch {
        // non-JSON error body
      }
      return { data: null, error: message };
    }

    const data = await res.json();
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err?.message ?? "Network error" };
  }
}

export const forecastApi = {
  /** POST /forecast — 24-hour single-point forecast */
  forecast24h(lat, lon) {
    return request("POST", "/forecast", { lat, lon });
  },

  /** POST /forecast/multiday — 14-day single-point forecast */
  forecastMultiday(lat, lon, forecastDays = 14) {
    return request("POST", "/forecast/multiday", { lat, lon, forecast_days: forecastDays });
  },

  /** POST /forecast/districts — District-level batch across bbox */
  forecastDistricts(bbox, forecastDays = 14, maxDistricts = 9) {
    return request("POST", "/forecast/districts", {
      bbox,
      forecast_days: forecastDays,
      max_districts: maxDistricts,
    });
  },

  /** POST /predict_raw — Predict from raw feature values (what-if) */
  predictRaw(precipitationMm, soilMoisture, temperatureC, elevationM) {
    return request("POST", "/predict_raw", {
      precipitation_mm: precipitationMm,
      soil_moisture: soilMoisture,
      temperature_c: temperatureC,
      elevation_m: elevationM,
    });
  },
};
