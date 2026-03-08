const BASE_URL = import.meta.env.VITE_API_URL ?? "/api";

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
        // non-JSON error body — keep the status message
      }
      return { data: null, error: message };
    }

    const data = await res.json();
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err?.message ?? "Network error" };
  }
}

export const cosmeonApi = {
  /** POST /runs */
  submitRun(payload) {
    return request("POST", "/runs", payload);
  },

  /** GET /runs/{runId} */
  getRunStatus(runId) {
    return request("GET", `/runs/${runId}`);
  },

  /** GET /floods/{runId}/districts */
  getDistrictResults(runId) {
    return request("GET", `/floods/${runId}/districts`);
  },

  /** GET /floods/{runId}/districts/{districtId}/history?months={months} */
  getDistrictHistory(runId, districtId, months = 12) {
    return request(
      "GET",
      `/floods/${runId}/districts/${districtId}/history?months=${months}`,
    );
  },

  /** GET /floods/{runId}/districts/{districtId}/change */
  getDistrictChange(runId, districtId) {
    return request("GET", `/floods/${runId}/districts/${districtId}/change`);
  },

  /** GET /health */
  getHealth() {
    return request("GET", "/health");
  },
};
