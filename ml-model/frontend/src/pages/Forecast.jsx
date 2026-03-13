import React, { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  TrendingUp,
  SlidersHorizontal,
  CloudRain,
  Thermometer,
  Layers,
  Map as MapIcon,
  Search,
  Loader2,
  AlertTriangle,
  ChevronRight,
  Mountain,
  Droplets,
  Calendar,
  ArrowUpRight,
  BarChart3,
  Crosshair,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  BarChart,
  Bar,
  Cell,
  ReferenceLine,
  Area,
  AreaChart,
} from "recharts";
import PageHeader from "../components/common/PageHeader.jsx";
import { useForecastStore } from "../stores/forecastStore.js";
import { geocodeApi, parseNominatimResult, sortResultsByBoundary } from "../api/geocodeApi.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

const ALERT_CONFIG = {
  LOW:      { color: "text-emerald-600", bg: "bg-emerald-50", badge: "bg-emerald-500 text-white", ring: "ring-emerald-200" },
  MODERATE: { color: "text-amber-600",   bg: "bg-amber-50",   badge: "bg-amber-500 text-white",   ring: "ring-amber-200" },
  HIGH:     { color: "text-orange-600",  bg: "bg-orange-50",  badge: "bg-orange-500 text-white",  ring: "ring-orange-200" },
  CRITICAL: { color: "text-red-600",     bg: "bg-red-50",     badge: "bg-red-500 text-white",     ring: "ring-red-200" },
};

const getAlertStyle = (level) => ALERT_CONFIG[level] || ALERT_CONFIG.LOW;

const getLineColor = (level) => {
  const map = { LOW: "#10b981", MODERATE: "#f59e0b", HIGH: "#f97316", CRITICAL: "#ef4444" };
  return map[level] || "#10b981";
};

const formatProb = (p) => `${(p * 100).toFixed(1)}%`;

const FEATURES_LABELS = [
  { key: "Rain_24h",      label: "Rain 24h",      color: "#ef4444" },
  { key: "Rain_12h",      label: "Rain 12h",      color: "#f97316" },
  { key: "Soil_Moisture",  label: "Soil Moisture",  color: "#eab308" },
  { key: "Precipitation_mm", label: "Precipitation", color: "#3b82f6" },
  { key: "Temperature_C",  label: "Temperature",   color: "#8b5cf6" },
];

// ─── Sub-Components ─────────────────────────────────────────────────────────

function RegionSearch({ onRegionSelected, isLoading }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searching, setSearching] = useState(false);

  const doSearch = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    const { data } = await geocodeApi.search(query, { limit: 6 });
    if (data) {
      setResults(sortResultsByBoundary(data));
      setShowDropdown(true);
    }
    setSearching(false);
  }, [query]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter") doSearch();
  };

  const handleSelect = (item) => {
    const parsed = parseNominatimResult(item);
    setQuery(parsed.display_name.split(",").slice(0, 2).join(","));
    setShowDropdown(false);
    setResults([]);
    onRegionSelected(parsed);
  };

  return (
    <div className="relative w-full">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search city, state, or region..."
            className="w-full pl-9 pr-4 py-2.5 text-sm font-medium bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500 transition-all"
            id="forecast-region-search"
          />
        </div>
        <button
          onClick={doSearch}
          disabled={searching || !query.trim()}
          className="px-4 py-2.5 bg-gray-900 hover:bg-black text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-40 flex items-center gap-2"
          id="forecast-search-btn"
        >
          {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Search
        </button>
      </div>

      <AnimatePresence>
        {showDropdown && results.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-60 overflow-y-auto"
          >
            {results.map((item, idx) => (
              <button
                key={idx}
                onClick={() => handleSelect(item)}
                className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 border-b border-gray-50 last:border-0 transition-colors"
              >
                <span className="font-semibold text-gray-900">
                  {item.display_name?.split(",").slice(0, 2).join(",")}
                </span>
                <span className="text-gray-400 text-xs block mt-0.5 truncate">
                  {item.display_name}
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


function DistrictRankedTable({ districts, selectedDistrict, onSelect }) {
  if (!districts.length) return null;

  return (
    <div className="space-y-1.5">
      {districts.map((d, idx) => {
        const style = getAlertStyle(d.overall_alert_level);
        const isSelected = selectedDistrict?.name === d.name;

        return (
          <motion.button
            key={d.name}
            onClick={() => onSelect(d)}
            className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${
              isSelected
                ? `${style.bg} border-current ${style.color} ring-2 ${style.ring}`
                : "bg-white border-gray-100 hover:border-gray-200 hover:shadow-sm"
            }`}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={`text-xs font-black w-6 h-6 rounded-full flex items-center justify-center ${
                  idx === 0 ? "bg-red-500 text-white" : idx === 1 ? "bg-orange-500 text-white" : "bg-gray-200 text-gray-600"
                }`}>
                  {idx + 1}
                </span>
                <div>
                  <span className="text-sm font-bold text-gray-900">{d.name}</span>
                  <span className="text-[10px] text-gray-400 block">
                    {d.lat.toFixed(2)}°, {d.lon.toFixed(2)}°
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-lg font-black ${style.color}`}>
                  {formatProb(d.overall_max_prob)}
                </span>
                <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${style.badge}`}>
                  {d.overall_alert_level}
                </span>
              </div>
            </div>
            {d.peak_day > 0 && (
              <div className="mt-1.5 text-[10px] font-medium text-gray-400 flex items-center gap-1 ml-9">
                <Calendar className="w-3 h-3" />
                Peak risk: Day {d.peak_day} ({d.peak_date})
              </div>
            )}
          </motion.button>
        );
      })}
    </div>
  );
}


function TimelineChart({ districts, selectedDistrict }) {
  if (!selectedDistrict?.daily_forecasts?.length) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        Select a district to view its 14-day timeline
      </div>
    );
  }

  const chartData = selectedDistrict.daily_forecasts.map((d) => ({
    day: `Day ${d.day}`,
    date: d.date,
    prob: +(d.max_prob * 100).toFixed(1),
    avg: +(d.avg_prob * 100).toFixed(1),
    alert: d.alert_level,
  }));

  const lineColor = getLineColor(selectedDistrict.overall_alert_level);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={chartData}>
        <defs>
          <linearGradient id="probGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={lineColor} stopOpacity={0.3} />
            <stop offset="95%" stopColor={lineColor} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
        <XAxis
          dataKey="day"
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 10, fontWeight: 600, fill: "#9ca3af" }}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 10, fontWeight: 600, fill: "#9ca3af" }}
          domain={[0, 100]}
          tickFormatter={(v) => `${v}%`}
        />
        <ReferenceLine y={50} stroke="#f59e0b" strokeDasharray="4 4" strokeOpacity={0.5} label={{ value: "Moderate", fill: "#f59e0b", fontSize: 9, position: "insideTopRight" }} />
        <ReferenceLine y={80} stroke="#ef4444" strokeDasharray="4 4" strokeOpacity={0.5} label={{ value: "Critical", fill: "#ef4444", fontSize: 9, position: "insideTopRight" }} />
        <Tooltip
          contentStyle={{
            borderRadius: "12px",
            border: "1px solid #f3f4f6",
            boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
            fontSize: "12px",
          }}
          formatter={(value, name) => [`${value}%`, name === "prob" ? "Peak Risk" : "Avg Risk"]}
          labelFormatter={(label, payload) => {
            const item = payload?.[0]?.payload;
            return item ? `${label} (${item.date})` : label;
          }}
        />
        <Area
          type="monotone"
          dataKey="prob"
          stroke={lineColor}
          strokeWidth={3}
          fill="url(#probGrad)"
          dot={{ fill: lineColor, r: 4, strokeWidth: 2, stroke: "#fff" }}
          activeDot={{ r: 7, stroke: lineColor, strokeWidth: 2 }}
          name="Peak Risk"
        />
        <Line
          type="monotone"
          dataKey="avg"
          stroke="#9ca3af"
          strokeWidth={1.5}
          strokeDasharray="4 4"
          dot={false}
          name="Avg Risk"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}


function WhatIfPanel({ onResult }) {
  const [features, setFeatures] = useState({ precip: 10, soil: 0.3, temp: 25, elev: 50 });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const fetchWhatIf = useForecastStore((s) => s.fetchWhatIf);
  const whatIfResult = useForecastStore((s) => s.whatIfResult);

  const handleSliderChange = (key, val) => {
    setFeatures((prev) => ({ ...prev, [key]: val }));
  };

  const runPrediction = async () => {
    setLoading(true);
    await fetchWhatIf(features.precip, features.soil, features.temp, features.elev);
    setLoading(false);
  };

  const prob = whatIfResult?.flood_probability ?? null;
  const alertLevel = whatIfResult?.alert_level ?? "LOW";
  const style = getAlertStyle(alertLevel);

  return (
    <div className="space-y-5">
      {/* Precipitation */}
      <div>
        <div className="flex justify-between text-xs font-bold text-gray-700 mb-2">
          <span className="flex items-center gap-1.5">
            <CloudRain className="w-4 h-4 text-blue-500" /> Precipitation
          </span>
          <span className="bg-gray-100 px-2 py-0.5 rounded text-gray-900">{features.precip} mm/h</span>
        </div>
        <input
          type="range" min="0" max="100" step="0.5" value={features.precip}
          onChange={(e) => handleSliderChange("precip", parseFloat(e.target.value))}
          className="w-full accent-blue-500 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer"
        />
      </div>

      {/* Soil Moisture */}
      <div>
        <div className="flex justify-between text-xs font-bold text-gray-700 mb-2">
          <span className="flex items-center gap-1.5">
            <Droplets className="w-4 h-4 text-cyan-500" /> Soil Moisture
          </span>
          <span className="bg-gray-100 px-2 py-0.5 rounded text-gray-900">{features.soil.toFixed(2)}</span>
        </div>
        <input
          type="range" min="0" max="1" step="0.01" value={features.soil}
          onChange={(e) => handleSliderChange("soil", parseFloat(e.target.value))}
          className="w-full accent-cyan-500 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer"
        />
      </div>

      {/* Temperature */}
      <div>
        <div className="flex justify-between text-xs font-bold text-gray-700 mb-2">
          <span className="flex items-center gap-1.5">
            <Thermometer className="w-4 h-4 text-red-500" /> Temperature
          </span>
          <span className="bg-gray-100 px-2 py-0.5 rounded text-gray-900">{features.temp} °C</span>
        </div>
        <input
          type="range" min="-10" max="50" step="0.5" value={features.temp}
          onChange={(e) => handleSliderChange("temp", parseFloat(e.target.value))}
          className="w-full accent-red-500 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer"
        />
      </div>

      {/* Elevation */}
      <div>
        <div className="flex justify-between text-xs font-bold text-gray-700 mb-2">
          <span className="flex items-center gap-1.5">
            <Mountain className="w-4 h-4 text-green-600" /> Elevation
          </span>
          <span className="bg-gray-100 px-2 py-0.5 rounded text-gray-900">{features.elev} m</span>
        </div>
        <input
          type="range" min="0" max="2000" step="10" value={features.elev}
          onChange={(e) => handleSliderChange("elev", parseFloat(e.target.value))}
          className="w-full accent-green-600 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer"
        />
      </div>

      {/* Run button */}
      <button
        onClick={runPrediction}
        disabled={loading}
        className="w-full py-2.5 bg-gray-900 hover:bg-black text-white rounded-xl text-sm font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <SlidersHorizontal className="w-4 h-4" />}
        {loading ? "Predicting..." : "Run What-If Prediction"}
      </button>

      {/* Result */}
      <AnimatePresence>
        {prob !== null && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`rounded-xl border p-4 text-center ${style.bg} border-current/10`}
          >
            <span className={`text-3xl font-black ${style.color}`}>
              {(prob * 100).toFixed(1)}%
            </span>
            <span className={`block text-xs font-bold mt-1 uppercase tracking-widest ${style.color}`}>
              {alertLevel}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


// ─── Main Component ─────────────────────────────────────────────────────────

export default function Forecast() {
  const {
    districts,
    selectedDistrict,
    isLoading,
    error,
    fetchDistrictForecasts,
    selectDistrict,
  } = useForecastStore();

  const [selectedRegion, setSelectedRegion] = useState(null);

  const handleRegionSelected = useCallback((parsed) => {
    setSelectedRegion(parsed);
    if (parsed.bbox) {
      fetchDistrictForecasts(parsed.bbox, 14, 9);
    }
  }, [fetchDistrictForecasts]);

  // Derived data
  const selStyle = getAlertStyle(selectedDistrict?.overall_alert_level || "LOW");

  return (
    <div className="flex flex-col min-h-screen pt-14 bg-gray-50 font-sans selection:bg-green-100 selection:text-green-900">

      <PageHeader
        title="14-Day District Forecast"
        subtitle="Multi-day predictive flood modeling — powered by LSTM + Open-Meteo NWP data."
        icon={Activity}
      >
        <div className="w-full max-w-lg">
          <RegionSearch onRegionSelected={handleRegionSelected} isLoading={isLoading} />
        </div>
      </PageHeader>

      {/* Error Banner */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-red-50 border-b border-red-100 px-6 py-3 flex items-center gap-3"
          >
            <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
            <span className="text-sm font-medium text-red-700">{error}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading State */}
      {isLoading && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 py-20">
          <Loader2 className="w-10 h-10 text-green-500 animate-spin" />
          <div className="text-center">
            <p className="text-sm font-bold text-gray-900">Running 14-day district forecasts...</p>
            <p className="text-xs text-gray-500 mt-1">
              Fetching weather data from Open-Meteo and sliding LSTM model across 336 hours.
              <br />This may take 30-90 seconds for 9 districts.
            </p>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !districts.length && !error && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 py-20 text-center px-6">
          <div className="w-16 h-16 rounded-2xl bg-green-50 flex items-center justify-center">
            <MapIcon className="w-8 h-8 text-green-500" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900">Search a Region to Begin</h3>
            <p className="text-sm text-gray-500 mt-1 max-w-md">
              Enter a city or region above to run a 14-day district-level flood forecast.
              The system will divide the area into a 3×3 grid, fetch weather data for each zone,
              and produce day-by-day flood risk predictions using the LSTM model.
            </p>
          </div>
        </div>
      )}

      {/* Main Content */}
      {!isLoading && districts.length > 0 && (
        <div className="flex-1 max-w-[1600px] mx-auto w-full p-6 grid lg:grid-cols-12 gap-6">

          {/* ── Left: District Ranked List ── */}
          <div className="lg:col-span-3 flex flex-col gap-4">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
              <h3 className="text-xs font-bold text-gray-900 uppercase tracking-widest mb-4 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-gray-400" />
                District Risk Ranking
                <span className="ml-auto bg-gray-100 text-gray-600 text-[10px] px-2 py-0.5 rounded-full font-bold">
                  {districts.length}
                </span>
              </h3>
              <DistrictRankedTable
                districts={districts}
                selectedDistrict={selectedDistrict}
                onSelect={selectDistrict}
              />
            </div>
          </div>

          {/* ── Center: Timeline Chart ── */}
          <div className="lg:col-span-5 flex flex-col gap-6">

            {/* Selected District Header */}
            {selectedDistrict && (
              <motion.div
                key={selectedDistrict.name}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className={`rounded-2xl p-5 border ${selStyle.bg} border-current/10`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Selected District</span>
                    <h2 className="text-xl font-black text-gray-900 mt-0.5">{selectedDistrict.name}</h2>
                    <span className="text-xs text-gray-500">
                      {selectedDistrict.lat.toFixed(4)}°, {selectedDistrict.lon.toFixed(4)}°
                    </span>
                  </div>
                  <div className="text-right">
                    <span className={`text-4xl font-black ${selStyle.color}`}>
                      {formatProb(selectedDistrict.overall_max_prob)}
                    </span>
                    <span className={`block text-[10px] font-bold uppercase tracking-widest mt-1 px-3 py-1 rounded-full ${selStyle.badge} w-fit ml-auto`}>
                      {selectedDistrict.overall_alert_level}
                    </span>
                  </div>
                </div>
                {selectedDistrict.peak_day > 0 && (
                  <div className="mt-3 flex items-center gap-2 text-xs font-medium text-gray-500">
                    <ArrowUpRight className="w-3.5 h-3.5" />
                    Peak risk on <strong className="text-gray-900">Day {selectedDistrict.peak_day}</strong> ({selectedDistrict.peak_date})
                  </div>
                )}
              </motion.div>
            )}

            {/* Timeline Chart */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 flex-1 min-h-[350px]">
              <h3 className="text-xs font-bold text-gray-900 uppercase tracking-widest mb-4 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-gray-400" />
                14-Day Flood Probability Timeline
              </h3>
              <div className="w-full h-[calc(100%-2rem)]">
                <TimelineChart districts={districts} selectedDistrict={selectedDistrict} />
              </div>
            </div>

            {/* Daily Breakdown Table */}
            {selectedDistrict?.daily_forecasts?.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
                  <h3 className="text-xs font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-gray-400" />
                    Day-by-Day Breakdown
                  </h3>
                </div>
                <div className="divide-y divide-gray-50 max-h-[280px] overflow-y-auto">
                  {selectedDistrict.daily_forecasts.map((day) => {
                    const dStyle = getAlertStyle(day.alert_level);
                    return (
                      <div key={day.day} className="px-4 py-2.5 flex items-center justify-between text-sm hover:bg-gray-50 transition-colors">
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-black text-gray-400 w-8">D{day.day}</span>
                          <span className="text-xs text-gray-600 font-medium">{day.date}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="w-24 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${Math.min(100, day.max_prob * 100)}%`,
                                backgroundColor: getLineColor(day.alert_level),
                              }}
                            />
                          </div>
                          <span className={`text-xs font-bold w-12 text-right ${dStyle.color}`}>
                            {formatProb(day.max_prob)}
                          </span>
                          <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${dStyle.badge}`}>
                            {day.alert_level}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ── Right Sidebar: What-If ── */}
          <aside className="lg:col-span-4 flex flex-col gap-6">

            {/* Summary Stats */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 text-center">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Districts</span>
                <span className="text-2xl font-black text-gray-900 block mt-1">{districts.length}</span>
              </div>
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 text-center">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Critical</span>
                <span className="text-2xl font-black text-red-500 block mt-1">
                  {districts.filter((d) => d.overall_alert_level === "CRITICAL").length}
                </span>
              </div>
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 text-center">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">High</span>
                <span className="text-2xl font-black text-orange-500 block mt-1">
                  {districts.filter((d) => d.overall_alert_level === "HIGH").length}
                </span>
              </div>
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 text-center">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Forecast</span>
                <span className="text-2xl font-black text-gray-900 block mt-1">14d</span>
              </div>
            </div>

            {/* What-If Interactive Panel */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 border-t-4 border-t-green-500 flex-1">
              <h3 className="text-xs font-bold text-gray-900 uppercase tracking-widest mb-1.5 flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-gray-400" />
                What-If Scenario Simulator
              </h3>
              <p className="text-[11px] text-gray-500 mb-5 font-medium">
                Adjust weather parameters to see instant flood risk predictions from the LSTM model.
              </p>
              <WhatIfPanel />
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
