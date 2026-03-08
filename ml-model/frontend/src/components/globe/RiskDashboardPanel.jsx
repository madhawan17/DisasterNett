import React, { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { insightsApi } from "../../api/insightsApi.js";
import { useRiskStore } from "../../stores/riskStore.js";
import GeoSearchInput from "../ui/GeoSearchInput.jsx";
import CalendarPicker from "../ui/CalendarPicker.jsx";
import { geocodeApi } from "../../api/geocodeApi.js";
import { generateRiskReport } from "../../utils/reports/generateRiskReport.js";

export default function RiskDashboardPanel() {
  // Local form state
  const [location, setLocation] = useState("");
  const [locationResults, setLocationResults] = useState([]);
  const [searchingLocation, setSearchingLocation] = useState(false);
  const locationDebounce = useRef(null);

  const searchLocation = useCallback(async (q) => {
    clearTimeout(locationDebounce.current);
    if (q.length < 2) {
      setLocationResults([]);
      return;
    }
    locationDebounce.current = setTimeout(async () => {
      setSearchingLocation(true);
      const { data } = await geocodeApi.search(q, { limit: 6 });
      setLocationResults(data ?? []);
      setSearchingLocation(false);
    }, 280);
  }, []);

  const handleSelectLocation = (item) => {
    const primary = item.display_name.split(",")[0].trim();
    setLocation(primary);
    setLocationResults([]);
  };

  const [preStart, setPreStart] = useState("2024-06-01");
  const [preEnd, setPreEnd] = useState("2024-06-15");
  const [postStart, setPostStart] = useState("2024-07-01");
  const [postEnd, setPostEnd] = useState("2024-07-15");
  const [threshold, setThreshold] = useState("-1.25");

  // Store state
  const isLoading = useRiskStore((s) => s.isLoading);
  const error = useRiskStore((s) => s.error);
  const globalMetrics = useRiskStore((s) => s.globalMetrics);
  const districtSummaries = useRiskStore((s) => s.districtSummaries);
  const setRiskData = useRiskStore((s) => s.setRiskData);
  const setStoreLoading = useRiskStore((s) => s.setLoading);
  const setStoreError = useRiskStore((s) => s.setError);

  const handleAnalyze = async () => {
    if (!location.trim()) {
      setStoreError("Location is required");
      return;
    }

    setStoreLoading(true);
    try {
      // Step 1: Geocode the location to get lat/lon/bbox
      const geoResult = await geocodeApi.search(location, { limit: 1 });
      const place = geoResult.data?.[0];

      if (!place) {
        setStoreError("Could not find location. Try a more specific name.");
        return;
      }

      // Nominatim returns boundingbox as [minLat, maxLat, minLon, maxLon]
      // Convert to [west, south, east, north]
      const rawBbox = place.boundingbox?.map(Number);
      const bbox = rawBbox
        ? [rawBbox[2], rawBbox[0], rawBbox[3], rawBbox[1]]
        : [-180, -90, 180, 90];

      const payload = {
        region: {
          center: {
            lat: parseFloat(place.lat),
            lon: parseFloat(place.lon),
          },
          bbox,
          display_name: place.display_name || location,
        },
      };

      const { data, error: apiError } = await insightsApi.analyzeRisk(payload);

      if (apiError) {
        setStoreError(apiError);
        return;
      }

      setRiskData(data);
    } catch (err) {
      setStoreError(err?.message || "Failed to fetch risk data");
    } finally {
      setStoreLoading(false);
    }
  };

  const sortedDistricts = [...districtSummaries].sort(
    (a, b) => (b.risk_score || 0) - (a.risk_score || 0),
  );

  const getRiskColor = (classification) => {
    switch (classification?.toLowerCase()) {
      case "critical":
        return {
          bg: "bg-red-900/30",
          border: "border-red-600/50",
          text: "text-red-500",
        };
      case "high":
        return {
          bg: "bg-orange-900/30",
          border: "border-orange-600/50",
          text: "text-orange-500",
        };
      case "medium":
        return {
          bg: "bg-amber-900/30",
          border: "border-amber-600/50",
          text: "text-amber-500",
        };
      default:
        return {
          bg: "bg-green-900/30",
          border: "border-green-600/50",
          text: "text-green-500",
        };
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.3 }}
      className="w-full h-full flex flex-col gap-4"
    >
      {/* Error State */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="px-3 py-2 rounded border border-red-600/50 bg-red-900/20 text-red-400 text-xs font-mono tracking-wide"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Form Section (only show if no data loaded yet) */}
      {!globalMetrics && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="space-y-3"
        >
          <div className="text-[10px] uppercase tracking-widest text-[rgba(242,209,109,0.6)] font-mono border-b border-[rgba(242,209,109,0.15)] pb-2 flex items-center justify-between">
            <span>RISK ANALYSIS</span>
          </div>

          <GeoSearchInput
            label="Location"
            placeholder="e.g. Mumbai, India"
            value={location}
            onChange={(q) => {
              setLocation(q);
              searchLocation(q);
            }}
            results={locationResults}
            onSelect={handleSelectLocation}
            isSearching={searchingLocation}
            onClear={() => {
              setLocation("");
              setLocationResults([]);
            }}
          />

          {/* Date Ranges */}
          <div>
            <label
              className="text-[10px] uppercase font-mono tracking-[0.2em] mb-2 block"
              style={{ color: "rgba(236,232,223,0.5)" }}
            >
              Pre-Event Window
            </label>
            <div className="grid grid-cols-2 gap-3">
              <CalendarPicker
                label=""
                value={preStart}
                onChange={setPreStart}
              />
              <CalendarPicker label="" value={preEnd} onChange={setPreEnd} />
            </div>
          </div>

          <div>
            <label
              className="text-[10px] uppercase font-mono tracking-[0.2em] mb-2 block"
              style={{ color: "rgba(236,232,223,0.5)" }}
            >
              Post-Event Window
            </label>
            <div className="grid grid-cols-2 gap-3">
              <CalendarPicker
                label=""
                value={postStart}
                onChange={setPostStart}
              />
              <CalendarPicker label="" value={postEnd} onChange={setPostEnd} />
            </div>
          </div>

          {/* Threshold Input */}
          <div>
            <label
              className="text-[10px] uppercase font-mono tracking-[0.2em] mb-2 block"
              style={{ color: "rgba(236,232,223,0.5)" }}
            >
              Threshold (dB)
            </label>
            <input
              type="number"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              step="0.1"
              className="w-full text-xs font-mono tracking-wide px-3 py-2.5 transition-all outline-none"
              style={{
                background: "rgba(236,232,223,0.03)",
                border: "1px solid rgba(242,209,109,0.15)",
                color: "#ece8df",
              }}
              onFocusCapture={(e) => {
                e.target.style.borderColor = "#f2d16d";
              }}
              onBlurCapture={(e) => {
                e.target.style.borderColor = "rgba(242,209,109,0.15)";
              }}
            />
          </div>

          {/* Analyze Button */}
          <button
            onClick={handleAnalyze}
            disabled={isLoading}
            className="relative group w-full mt-2 overflow-hidden"
            style={{
              padding: "0.8rem 1rem",
              cursor: isLoading ? "not-allowed" : "pointer",
              opacity: isLoading ? 0.5 : 1,
            }}
          >
            <span
              className="absolute inset-0 transition-colors"
              style={{ border: "1px solid rgba(242,209,109,0.4)" }}
            />
            <span
              className="absolute inset-0 translate-x-full group-hover:translate-x-0 transition-transform duration-300"
              style={{ background: "#f2d16d" }}
            />

            <span
              className="relative z-10 flex items-center justify-center gap-2 font-mono tracking-[0.2em] uppercase transition-colors text-[#f2d16d] group-hover:text-[#0a0907]"
              style={{ fontSize: "0.65rem" }}
            >
              {isLoading ?
                <>
                  <span className="w-1.5 h-1.5 bg-[#f2d16d] group-hover:bg-[#0a0907] animate-pulse" />
                  ANALYZING...
                </>
              : "RUN ANALYSIS"}
            </span>
          </button>
        </motion.div>
      )}

      {/* Metrics Section */}
      <AnimatePresence>
        {globalMetrics && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            className="space-y-3"
          >
            <div className="text-[10px] uppercase tracking-widest text-text-3 font-mono border-b border-[rgba(242,209,109,0.15)] pb-2 flex justify-between items-center">
              <span>GLOBAL METRICS</span>
              <button
                onClick={() => generateRiskReport(globalMetrics, districtSummaries)}
                className="text-[9px] font-mono uppercase tracking-widest px-2 py-1 border rounded transition-colors hover:bg-[rgba(242,209,109,0.1)]"
                style={{
                  borderColor: "rgba(242,209,109,0.4)",
                  color: "#f2d16d",
                }}
              >
                Export PDF
              </button>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="px-3 py-2 bg-[#0a0907] border border-[rgba(242,209,109,0.15)] rounded">
                <div className="text-[#f2d16d] uppercase tracking-widest font-mono text-[9px] mb-1">
                  Population
                </div>
                <div className="text-[#ece8df] font-mono text-sm font-semibold">
                  {globalMetrics?.population_metrics?.total_population?.toLocaleString() ||
                    "N/A"}
                </div>
              </div>

              <div className="px-3 py-2 bg-[#0a0907] border border-[rgba(242,209,109,0.15)] rounded">
                <div className="text-[#f2d16d] uppercase tracking-widest font-mono text-[9px] mb-1">
                  Rainfall (mm)
                </div>
                <div className="text-[#ece8df] font-mono text-sm font-semibold">
                  {globalMetrics?.hydrological_metrics?.accumulated_rainfall_mm?.toFixed(
                    2,
                  ) || "N/A"}
                </div>
              </div>

              <div className="px-3 py-2 bg-[#0a0907] border border-[rgba(242,209,109,0.15)] rounded">
                <div className="text-[#f2d16d] uppercase tracking-widest font-mono text-[9px] mb-1">
                  Risk Score
                </div>
                <div className="text-[#ece8df] font-mono text-sm font-semibold">
                  {globalMetrics?.risk_assessment?.composite_risk_score ||
                    "N/A"}
                </div>
              </div>

              <div className="px-3 py-2 bg-[#0a0907] border border-[rgba(242,209,109,0.15)] rounded">
                <div className="text-[#f2d16d] uppercase tracking-widest font-mono text-[9px] mb-1">
                  Classification
                </div>
                <div
                  className={`font-mono text-sm font-semibold ${
                    (
                      globalMetrics?.risk_assessment?.risk_classification?.toLowerCase() ===
                      "critical"
                    ) ?
                      "text-red-500"
                    : (
                      globalMetrics?.risk_assessment?.risk_classification?.toLowerCase() ===
                      "high"
                    ) ?
                      "text-orange-500"
                    : (
                      globalMetrics?.risk_assessment?.risk_classification?.toLowerCase() ===
                      "medium"
                    ) ?
                      "text-amber-500"
                    : "text-green-500"
                  }`}
                >
                  {globalMetrics?.risk_assessment?.risk_classification || "N/A"}
                </div>
              </div>

              <div className="px-3 py-2 bg-[#0a0907] border border-[rgba(242,209,109,0.15)] rounded">
                <div className="text-[#f2d16d] uppercase tracking-widest font-mono text-[9px] mb-1">
                  Confidence
                </div>
                <div className="text-[#ece8df] font-mono text-sm font-semibold">
                  {globalMetrics?.confidence_metrics?.confidence_level || "N/A"}
                </div>
              </div>

              <div className="px-3 py-2 bg-[#0a0907] border border-[rgba(242,209,109,0.15)] rounded">
                <div className="text-[#f2d16d] uppercase tracking-widest font-mono text-[9px] mb-1">
                  Area (km²)
                </div>
                <div className="text-[#ece8df] font-mono text-sm font-semibold">
                  {globalMetrics?.affected_area_statistics?.area_km2?.toLocaleString() ||
                    "N/A"}
                </div>
              </div>
            </div>

            {/* District Summary Header */}
            <div className="pt-3 border-t border-[rgba(242,209,109,0.15)]">
              <div className="text-[10px] uppercase tracking-widest text-text-3 font-mono pb-2">
                DISTRICT SUMMARY
              </div>

              {/* Districts List */}
              <div className="max-h-72 overflow-y-auto space-y-1.5">
                {sortedDistricts.map((district) => {
                  const colors = getRiskColor(district.risk_classification);
                  return (
                    <motion.div
                      key={district.district_name}
                      initial={{ opacity: 0, x: -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={`px-3 py-2 rounded text-xs border ${colors.bg} ${colors.border} font-mono`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[#ece8df] truncate text-sm">
                          {district.district_name}
                        </span>
                        <div className="flex items-center gap-2 ml-2">
                          <span
                            className={`${colors.text} text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded border ${colors.border}`}
                          >
                            {district.risk_classification}
                          </span>
                        </div>
                      </div>

                      {/* Extra Data */}
                      <div className="mt-3 grid grid-cols-3 gap-1 text-[11px] text-[rgba(236,232,223,0.7)]">
                        <div>
                          <span className="text-[#f2d16d]">POP: </span>
                          {(district.population || 0).toLocaleString()}
                        </div>
                        <div className="text-center">
                          <span className="text-[#f2d16d]">RISK: </span>
                          <span className={`${colors.text} font-bold`}>
                            {district.risk_score}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-[#f2d16d]">AREA: </span>
                          {district.area_km2 || "N/A"} km²
                        </div>
                      </div>

                      {district.contributing_factors?.length > 0 && (
                        <div className="mt-2 text-[10px] text-[rgba(236,232,223,0.55)] leading-relaxed">
                          {district.contributing_factors
                            .slice(0, 3)
                            .join(" • ")}
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            </div>

            {/* Reset Button */}
            <button
              onClick={() => {
                useRiskStore.getState().clearRiskData();
                setLocation("");
                setPreStart("2024-06-01");
                setPreEnd("2024-06-15");
                setPostStart("2024-07-01");
                setPostEnd("2024-07-15");
                setThreshold("-1.25");
              }}
              className="relative group w-full mt-3 overflow-hidden flex justify-center"
              style={{ padding: "0.6rem 1rem", cursor: "pointer" }}
            >
              <span
                className="absolute inset-0 transition-colors"
                style={{ border: "1px solid rgba(242,209,109,0.15)" }}
              />
              <span
                className="absolute inset-0 translate-x-full group-hover:translate-x-0 transition-transform duration-300"
                style={{ background: "rgba(242,209,109,0.1)" }}
              />
              <span className="relative z-10 font-mono tracking-[0.2em] uppercase transition-colors text-[10px] text-[rgba(236,232,223,0.4)] group-hover:text-[#f2d16d]">
                NEW ANALYSIS
              </span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
