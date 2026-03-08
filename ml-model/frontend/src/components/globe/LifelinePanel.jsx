import React, { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { insightsApi } from "../../api/insightsApi.js";
import { useLifelineStore } from "../../stores/lifelineStore.js";
import { mockLifelineData } from "../../data/mockLifelineData.js";
import GeoSearchInput from "../ui/GeoSearchInput.jsx";
import { geocodeApi } from "../../api/geocodeApi.js";
import { generateLifelineReport } from "../../utils/reports/generateLifelineReport.js";

export default function LifelinePanel() {
  const [location, setLocation] = useState("");
  const [lat, setLat] = useState(19.033);
  const [lon, setLon] = useState(73.0297);
  const [radius, setRadius] = useState(1000);

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
    setLat(parseFloat(item.lat));
    setLon(parseFloat(item.lon));
    setLocationResults([]);
  };

  const isLoading = useLifelineStore((s) => s.isLoading);
  const error = useLifelineStore((s) => s.error);
  const data = useLifelineStore((s) => s.data);
  const setLifelineData = useLifelineStore((s) => s.setLifelineData);
  const setStoreLoading = useLifelineStore((s) => s.setLoading);
  const setStoreError = useLifelineStore((s) => s.setError);

  // Placeholder for showNotification, assuming it's defined elsewhere or will be added by the user
  const showNotification = (message, type) => {
    console.log(`Notification (${type}): ${message}`);
    // In a real app, this would trigger a toast or similar notification system
  };

  const handleAnalyze = async () => {
    if (!lat || !lon) {
      setStoreError("Please select a specific location from the dropdown");
      return;
    }

    setStoreLoading(true);
    try {
      const payload = {
        center_lat: lat,
        center_lon: lon,
        radius_m: parseInt(radius, 10),
        output_dir: ".",
        output_prefix: "flood_infrastructure",
        max_retries: 4,
        retry_sleep: 10,
        tag_sleep: 1.5,
      };

      const { data, error: apiError } =
        await insightsApi.analyzeLifeline(payload);

      if (apiError) {
        showNotification(
          "Live infrastructure scan failed. Analyzing simulated data subset.",
          "warning",
        );
        const stages = ["surveying", "mapping", "diagnosing", "compiling"];
        let idx = 0;
        const timer = setInterval(() => {
          idx++;
          if (idx < stages.length) {
            // Simulated loading, handled by ProgressOverlay's built-in progress simulation
          }
          if (idx === stages.length) {
            clearInterval(timer);
            setLifelineData(mockLifelineData);
            showNotification("Simulated scanning complete", "success");
            setStoreLoading(false);
          }
        }, 1200);
        return; // Early return to let setInterval finish the mock flow
      }

      setLifelineData(data);
      setStoreLoading(false);
    } catch (err) {
      setStoreError(err?.message || "Failed to fetch infrastructure data");
      setStoreLoading(false);
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

      {!data && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="space-y-3"
        >
          <div className="text-[10px] uppercase tracking-widest text-[rgba(242,209,109,0.6)] font-mono border-b border-[rgba(242,209,109,0.15)] pb-2 flex items-center justify-between">
            <span>INFRASTRUCTURE ANALYSIS</span>
          </div>

          <GeoSearchInput
            label="Center Location"
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

          <div>
            <label
              className="text-[10px] uppercase font-mono tracking-[0.2em] mb-2 block"
              style={{ color: "rgba(236,232,223,0.5)" }}
            >
              Search Radius (meters)
            </label>
            <input
              type="number"
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
              step="100"
              className="w-full text-xs font-mono tracking-wide px-3 py-2.5 transition-all outline-none"
              style={{
                background: "rgba(236,232,223,0.03)",
                border: "1px solid rgba(242,209,109,0.15)",
                color: "#ece8df",
              }}
              onFocusCapture={(e) => (e.target.style.borderColor = "#f2d16d")}
              onBlurCapture={(e) =>
                (e.target.style.borderColor = "rgba(242,209,109,0.15)")
              }
            />
          </div>

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
                  ANALYZING INFRA...
                </>
              : "SCAN INFRASTRUCTURE"}
            </span>
          </button>
        </motion.div>
      )}

      {/* Metrics Section */}
      <AnimatePresence>
        {data && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            className="space-y-3"
          >
            <div className="text-[10px] uppercase tracking-widest text-text-3 font-mono border-b border-[rgba(242,209,109,0.15)] pb-2 flex justify-between items-center gap-2">
              <span>SCAN SUMMARY</span>
              <span className="text-green-500 font-bold">
                {data.total_features} DETECTED
              </span>
              <button
                onClick={() =>
                  generateLifelineReport(data, lat, lon, parseInt(radius, 10))
                }
                className="text-[9px] font-mono uppercase tracking-widest px-2 py-1 border rounded transition-colors hover:bg-[rgba(242,209,109,0.1)] whitespace-nowrap"
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
                  Hospitals
                </div>
                <div className="text-red-400 font-mono text-sm font-semibold">
                  {data?.summary?.hospital ?? 0}
                </div>
              </div>

              <div className="px-3 py-2 bg-[#0a0907] border border-[rgba(242,209,109,0.15)] rounded">
                <div className="text-[#f2d16d] uppercase tracking-widest font-mono text-[9px] mb-1">
                  Schools
                </div>
                <div className="text-blue-400 font-mono text-sm font-semibold">
                  {data?.summary?.school ?? 0}
                </div>
              </div>

              <div className="px-3 py-2 bg-[#0a0907] border border-[rgba(242,209,109,0.15)] rounded">
                <div className="text-[#f2d16d] uppercase tracking-widest font-mono text-[9px] mb-1">
                  Places of Worship
                </div>
                <div className="text-purple-400 font-mono text-sm font-semibold">
                  {data?.summary?.place_of_worship ?? 0}
                </div>
              </div>

              <div className="px-3 py-2 bg-[#0a0907] border border-[rgba(242,209,109,0.15)] rounded">
                <div className="text-[#f2d16d] uppercase tracking-widest font-mono text-[9px] mb-1">
                  Residential
                </div>
                <div className="text-green-400 font-mono text-sm font-semibold">
                  {data?.summary?.residential_building ?? 0}
                </div>
              </div>

              <div className="px-3 py-2 bg-[#0a0907] border border-[rgba(242,209,109,0.15)] rounded">
                <div className="text-[#f2d16d] uppercase tracking-widest font-mono text-[9px] mb-1">
                  Commercial
                </div>
                <div className="text-yellow-400 font-mono text-sm font-semibold">
                  {data?.summary?.commercial_building ?? 0}
                </div>
              </div>

              <div className="px-3 py-2 bg-[#0a0907] border border-[rgba(242,209,109,0.15)] rounded">
                <div className="text-[#f2d16d] uppercase tracking-widest font-mono text-[9px] mb-1">
                  Total Buildings
                </div>
                <div className="text-[#ece8df] font-mono text-sm font-semibold">
                  {data?.summary?.building ?? 0}
                </div>
              </div>
            </div>

            <button
              onClick={() => {
                useLifelineStore.getState().clearLifelineData();
                setLocation("");
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
                NEW INFRA SCAN
              </span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
