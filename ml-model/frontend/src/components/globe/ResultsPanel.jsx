import React from "react";
import { motion } from "framer-motion";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie,
} from "recharts";
import { useGlobeStore } from "../../stores/globeStore.js";
import { generateDetectionReport } from "../../utils/reports/generateDetectionReport.js";

const SEVERITY_COLORS = {
  critical: "#c0392b",
  high: "#dc7828",
  medium: "#f2d16d",
  low: "#22c55e",
};
const SEVERITY_ORDER = ["critical", "high", "medium", "low"];

// ── Alert level config ──────────────────────────────────────────────────────
const ALERT_STYLES = {
  LOW: { bg: "rgba(34,197,94,0.08)", border: "#22c55e", text: "#22c55e", label: "LOW" },
  MEDIUM: { bg: "rgba(242,209,109,0.08)", border: "#f2d16d", text: "#f2d16d", label: "MODERATE" },
  HIGH: { bg: "rgba(220,120,40,0.12)", border: "#dc7828", text: "#dc7828", label: "HIGH" },
  CRITICAL: { bg: "rgba(192,57,43,0.12)", border: "#c0392b", text: "#c0392b", label: "CRITICAL" },
};

function deriveAlertLevel(summary) {
  const pct = summary?.total_flood_area_km2 ?? 0;
  const zones = summary?.zones_count ?? 0;
  if (pct > 100 || zones > 5) return "CRITICAL";
  if (pct > 30 || zones > 3) return "HIGH";
  if (pct > 5 || zones > 1) return "MEDIUM";
  return "LOW";
}

function AlertBadge({ alertLevel }) {
  const style = ALERT_STYLES[alertLevel] ?? ALERT_STYLES.MEDIUM;
  return (
    <div
      className="inline-flex items-center gap-2 px-3 py-2 border rounded"
      style={{ background: style.bg, borderColor: style.border }}
    >
      <span className="w-2 h-2 rounded-full" style={{ background: style.text }} />
      <span
        className="text-[11px] font-mono font-bold tracking-widest uppercase"
        style={{ color: style.text }}
      >
        {style.label}
      </span>
    </div>
  );
}

// ── SAR Change Detection Image ──────────────────────────────────────────────
function SarImagePanel({ src, location, sceneId }) {
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState(false);

  if (!src) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        style={{ border: "1px solid rgba(242,209,109,0.10)" }}
      >
        <div
          className="px-4 py-2 border-b flex items-center justify-between"
          style={{ borderColor: "rgba(242,209,109,0.10)", background: "rgba(242,209,109,0.02)" }}
        >
          <span className="font-mono text-[9px] uppercase tracking-[0.3em]" style={{ color: "rgba(242,209,109,0.35)" }}>
            SAR Change Detection
          </span>
        </div>
        <div className="flex items-center justify-center py-6">
          <span className="font-mono text-[8px] uppercase tracking-widest" style={{ color: "rgba(236,232,223,0.2)" }}>
            No SAR image available for this run
          </span>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="overflow-hidden"
      style={{ border: "1px solid rgba(242,209,109,0.15)" }}
    >
      {/* Header */}
      <div
        className="px-4 py-2 border-b flex items-center justify-between"
        style={{
          borderColor: "rgba(242,209,109,0.15)",
          background: "rgba(242,209,109,0.03)",
        }}
      >
        <span
          className="font-mono text-[9px] uppercase tracking-[0.3em]"
          style={{ color: "#f2d16d" }}
        >
          SAR Change Detection
        </span>
        <span
          className="font-mono text-[7px] tracking-widest"
          style={{ color: "rgba(236,232,223,0.3)" }}
        >
          GEE THUMBNAIL
        </span>
      </div>

      {/* Image */}
      <div className="relative bg-black" style={{ minHeight: 180 }}>
        {!loaded && !error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <div className="w-5 h-5 border-2 border-t-transparent border-[#f2d16d] rounded-full animate-spin" />
              <span
                className="font-mono text-[8px] uppercase tracking-widest"
                style={{ color: "rgba(236,232,223,0.2)" }}
              >
                Loading satellite imagery...
              </span>
            </div>
          </div>
        )}
        {error && (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ background: "rgba(216,64,64,0.04)", minHeight: 120 }}
          >
            <span
              className="font-mono text-[9px] uppercase tracking-widest"
              style={{ color: "rgba(216,64,64,0.6)" }}
            >
              Image unavailable
            </span>
          </div>
        )}
        {!error && (
          <img
            src={src}
            alt={`SAR change detection for ${location}`}
            className={`w-full object-contain transition-opacity duration-500 ${loaded ? "opacity-100" : "opacity-0"}`}
            style={{ maxHeight: 280 }}
            onLoad={() => setLoaded(true)}
            onError={() => setError(true)}
          />
        )}
      </div>

      {/* Footer metadata */}
      <div
        className="px-4 py-2 border-t flex items-center justify-between"
        style={{ borderColor: "rgba(242,209,109,0.1)" }}
      >
        <span
          className="font-mono text-[7px] uppercase tracking-widest truncate"
          style={{ color: "rgba(236,232,223,0.35)", maxWidth: "70%" }}
          title={sceneId}
        >
          {sceneId ? `Scene: ${sceneId.slice(0, 40)}…` : location}
        </span>
        <span
          className="font-mono text-[7px] tracking-widest flex-shrink-0"
          style={{ color: "rgba(74,176,216,0.5)" }}
        >
          SENTINEL-1
        </span>
      </div>
    </motion.div>
  );
}

// ── AI Insight Narrative ────────────────────────────────────────────────────
function AiInsightPanel({ text, alertLevel }) {
  const [expanded, setExpanded] = React.useState(false);

  if (!text) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        style={{ border: "1px solid rgba(242,209,109,0.10)" }}
      >
        <div
          className="px-4 py-2.5 border-b flex items-center gap-3"
          style={{ borderColor: "rgba(242,209,109,0.10)", background: "rgba(242,209,109,0.02)" }}
        >
          <div className="w-7 h-7 rounded flex items-center justify-center" style={{ background: "rgba(242,209,109,0.08)" }}>
            <span style={{ fontSize: 14 }}>🔍</span>
          </div>
          <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "rgba(242,209,109,0.35)" }}>
            AI Analysis Report
          </span>
        </div>
        <div className="flex items-center justify-center py-5">
          <span className="font-mono text-[8px] uppercase tracking-widest" style={{ color: "rgba(236,232,223,0.2)" }}>
            No AI insight available — run a new analysis
          </span>
        </div>
      </motion.div>
    );
  }

  const riskColor = ALERT_STYLES[alertLevel]?.text ?? "#f2d16d";

  // Parse markdown-like text
  const renderInsight = (raw) => {
    const lines = raw.split("\n").filter((l) => l.trim());
    return lines.map((line, i) => {
      const trimmed = line.trim();

      // Bold headers like **Situation Overview**
      const headerMatch = trimmed.match(/^\*\*(.+?)\*\*$/);
      if (headerMatch) {
        return (
          <p
            key={i}
            className="font-mono text-[10px] tracking-[0.2em] uppercase mt-4 mb-1 first:mt-0"
            style={{ color: "#f2d16d" }}
          >
            {headerMatch[1]}
          </p>
        );
      }

      // Bullet points
      const bulletMatch = trimmed.match(/^\* (.+)/);
      if (bulletMatch) {
        return (
          <div
            key={i}
            className="flex gap-2 pl-2 text-[11px] leading-relaxed"
            style={{ color: "rgba(191,207,216,0.8)" }}
          >
            <span style={{ color: "rgba(242,209,109,0.5)", flexShrink: 0 }}>›</span>
            <span>{bulletMatch[1]}</span>
          </div>
        );
      }

      // Normal paragraph
      return (
        <p key={i} className="text-[11px] leading-relaxed" style={{ color: "rgba(191,207,216,0.6)" }}>
          {trimmed}
        </p>
      );
    });
  };

  const lines = text.split("\n").filter((l) => l.trim());
  const previewLines = lines.slice(0, 6).join("\n");
  const hasMore = lines.length > 6;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      style={{
        border: `1px solid ${riskColor}30`,
        overflow: "hidden",
        background: `${riskColor}06`,
      }}
    >
      {/* Header */}
      <div
        className="px-4 py-2.5 border-b flex items-center gap-3"
        style={{ borderColor: `${riskColor}18`, background: `${riskColor}0a` }}
      >
        <div
          className="w-7 h-7 rounded flex items-center justify-center"
          style={{ background: `${riskColor}15` }}
        >
          <span style={{ fontSize: 14 }}>🔍</span>
        </div>
        <div className="flex-1">
          <div
            className="text-[10px] font-mono uppercase tracking-widest"
            style={{ color: riskColor }}
          >
            AI Analysis Report
          </div>
          <div
            className="text-[8px] font-mono"
            style={{ color: "rgba(236,232,223,0.35)" }}
          >
            Generated by Groq LLM from SAR detection data
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-3 space-y-1">
        {renderInsight(expanded || !hasMore ? text : previewLines)}

        {hasMore && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-2 text-[9px] font-mono uppercase tracking-widest transition-colors"
            style={{ color: "#f2d16d" }}
          >
            {expanded ? "▲ Show less" : "▼ Read full report"}
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ── Processing Time Badge ───────────────────────────────────────────────────
function ProcessingBadge({ seconds, analysisDate }) {
  if (!seconds) return null;
  return (
    <div
      className="flex items-center justify-between px-3 py-2"
      style={{
        background: "rgba(56,160,88,0.05)",
        border: "1px solid rgba(56,160,88,0.15)",
      }}
    >
      <span
        className="font-mono text-[9px] uppercase tracking-widest"
        style={{ color: "#38a058" }}
      >
        ✓ Pipeline completed in {seconds.toFixed(1)}s
      </span>
      {analysisDate && (
        <span
          className="font-mono text-[8px] tracking-widest"
          style={{ color: "rgba(236,232,223,0.3)" }}
        >
          {analysisDate}
        </span>
      )}
    </div>
  );
}

// ── Severity Breakdown Chart ────────────────────────────────────────────────
function SeverityBreakdownChart({ zones }) {
  // Aggregate area by severity level
  const areaMap = { critical: 0, high: 0, medium: 0, low: 0 };
  (zones ?? []).forEach((z) => {
    const sev = (z.properties?.severity ?? "low").toLowerCase();
    areaMap[sev] = (areaMap[sev] || 0) + (z.properties?.area_km2 ?? 0);
  });

  const chartData = SEVERITY_ORDER
    .map((sev) => ({
      severity: sev.charAt(0).toUpperCase() + sev.slice(1),
      area: parseFloat(areaMap[sev].toFixed(2)),
      color: SEVERITY_COLORS[sev],
    }))
    .filter((d) => d.area > 0);

  // If no meaningful breakdown (single zone or no zones), show a summary
  if (chartData.length === 0) return null;

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
      <div
        className="bg-[#0a0907] border rounded px-3 py-2 text-xs font-mono"
        style={{ borderColor: "rgba(242,209,109,0.3)" }}
      >
        <span style={{ color: d.color, fontWeight: 700 }}>{d.severity}</span>
        <span style={{ color: "rgba(236,232,223,0.6)" }}> — {d.area} km²</span>
      </div>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 }}
      style={{
        border: "1px solid rgba(242,209,109,0.15)",
        background: "#0a0907",
      }}
    >
      <div
        className="px-4 py-2 border-b"
        style={{
          borderColor: "rgba(242,209,109,0.15)",
          background: "rgba(242,209,109,0.03)",
        }}
      >
        <span
          className="font-mono text-[9px] uppercase tracking-[0.3em]"
          style={{ color: "rgba(242,209,109,0.6)" }}
        >
          Severity Breakdown
        </span>
      </div>
      <div className="px-2 py-3">
        <ResponsiveContainer width="100%" height={chartData.length * 44 + 16}>
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 4, right: 20, left: 8, bottom: 4 }}
          >
            <XAxis
              type="number"
              tick={{ fontSize: 9, fontFamily: "monospace", fill: "rgba(236,232,223,0.35)" }}
              axisLine={false}
              tickLine={false}
              unit=" km²"
            />
            <YAxis
              type="category"
              dataKey="severity"
              tick={{ fontSize: 10, fontFamily: "monospace", fill: "rgba(236,232,223,0.6)" }}
              axisLine={false}
              tickLine={false}
              width={65}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(242,209,109,0.04)" }} />
            <Bar dataKey="area" radius={[0, 4, 4, 0]} barSize={18}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.color} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
}

// ── Confidence Gauge (Donut) ────────────────────────────────────────────────
function ConfidenceGauge({ confidence }) {
  const pct = Math.min(Math.max((confidence ?? 0) * 100, 0), 100);
  const gaugeColor =
    pct >= 70 ? "#22c55e"
    : pct >= 40 ? "#f2d16d"
    : "#c0392b";

  const pieData = [
    { name: "Confidence", value: pct },
    { name: "Remaining", value: 100 - pct },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      style={{
        border: "1px solid rgba(242,209,109,0.15)",
        background: "#0a0907",
      }}
    >
      <div
        className="px-4 py-2 border-b"
        style={{
          borderColor: "rgba(242,209,109,0.15)",
          background: "rgba(242,209,109,0.03)",
        }}
      >
        <span
          className="font-mono text-[9px] uppercase tracking-[0.3em]"
          style={{ color: "rgba(242,209,109,0.6)" }}
        >
          Detection Confidence
        </span>
      </div>
      <div className="flex items-center justify-center py-4" style={{ position: "relative" }}>
        <ResponsiveContainer width={160} height={160}>
          <PieChart>
            <Pie
              data={pieData}
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={68}
              startAngle={90}
              endAngle={-270}
              paddingAngle={2}
              dataKey="value"
              stroke="none"
              animationBegin={200}
              animationDuration={1000}
            >
              <Cell fill={gaugeColor} fillOpacity={0.9} />
              <Cell fill="rgba(236,232,223,0.06)" />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        {/* Center label */}
        <div
          className="absolute flex flex-col items-center justify-center"
          style={{
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            pointerEvents: "none",
          }}
        >
          <span
            className="font-mono text-2xl font-bold"
            style={{ color: gaugeColor, lineHeight: 1 }}
          >
            {pct.toFixed(1)}
          </span>
          <span
            className="font-mono text-[8px] uppercase tracking-widest mt-1"
            style={{ color: "rgba(236,232,223,0.4)" }}
          >
            % Confidence
          </span>
        </div>
      </div>
    </motion.div>
  );
}

// ── Shared subcomponents ────────────────────────────────────────────────────
function MetaRow({ label, value, color }) {
  return (
    <div className="flex items-center justify-between">
      <span
        className="text-[9px] font-mono tracking-widest uppercase"
        style={{ color: "rgba(236,232,223,0.4)" }}
      >
        {label}
      </span>
      <span
        className="text-[9px] font-mono"
        style={{ color: color ?? "rgba(236,232,223,0.6)" }}
      >
        {value ?? "—"}
      </span>
    </div>
  );
}

function FeatureCard({ label, value, unit, color, decimals }) {
  const displayValue =
    decimals !== undefined
      ? (value ?? 0).toFixed(decimals)
      : Math.round(value ?? 0);

  return (
    <div
      className="p-3 border rounded"
      style={{
        borderColor: "rgba(242,209,109,0.15)",
        background: "rgba(242,209,109,0.03)",
      }}
    >
      <div
        className="text-[8px] font-mono uppercase tracking-widest mb-2"
        style={{ color: "rgba(236,232,223,0.4)" }}
      >
        {label}
      </div>
      <div className="text-sm font-mono font-bold" style={{ color }}>
        {displayValue} {unit}
      </div>
    </div>
  );
}

// ── Main ResultsPanel ───────────────────────────────────────────────────────
export default function ResultsPanel() {
  const result = useGlobeStore((s) => s.result);
  const geocoded = useGlobeStore((s) => s.geocoded);

  if (!result) return null;

  // ── Support BOTH response shapes ──
  // Shape A: Forecast API → { flood_probability, alert_level, ... }
  // Shape B: SAR Insights API → { summary, flood_zones, sar_image_url, ai_insight, ... }
  const isForecastShape = result.flood_probability !== undefined;

  if (isForecastShape) {
    const {
      flood_probability,
      alert_level,
      forecast_horizon_hours,
      based_on_data_until,
      peak_flood_time,
      features_snapshot = {},
    } = result;

    const probabilityPercent = (flood_probability * 100).toFixed(2);

    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col flex-1 gap-4"
        style={{ background: "#0a0907" }}
      >
        <div style={{ border: "1px solid rgba(242,209,109,0.15)" }}>
          <div className="px-4 py-3 border-b" style={{ borderColor: "rgba(242,209,109,0.15)" }}>
            <div className="text-[9px] font-mono uppercase tracking-[0.3em] mb-4" style={{ color: "rgba(242,209,109,0.6)" }}>
              Flood Risk Forecast
            </div>
            <div className="space-y-3">
              <AlertBadge alertLevel={alert_level} />
              <div className="flex items-baseline gap-2">
                <div className="text-4xl font-mono font-bold" style={{ color: "#f2d16d" }}>{probabilityPercent}</div>
                <div className="text-sm font-mono" style={{ color: "rgba(236,232,223,0.5)" }}>Flood Probability</div>
              </div>
              <button
                onClick={() => generateDetectionReport(result, geocoded)}
                className="text-[9px] font-mono uppercase tracking-widest px-3 py-1.5 border rounded transition-colors hover:bg-[rgba(242,209,109,0.1)]"
                style={{ borderColor: "rgba(242,209,109,0.4)", color: "#f2d16d" }}
              >
                Export PDF
              </button>
            </div>
          </div>
          <div className="px-4 py-3 border-b space-y-2" style={{ borderColor: "rgba(242,209,109,0.15)" }}>
            <MetaRow label="Forecast Window" value={`${forecast_horizon_hours}H`} color="#f2d16d" />
            <MetaRow label="Peak Flood Est." value={peak_flood_time} color="#c0392b" />
            <MetaRow label="Latest Data" value={based_on_data_until?.replace("+00:00", "")} />
          </div>
          <div className="grid grid-cols-2 gap-3 p-4">
            {[
              { label: "Precipitation", value: features_snapshot.Precipitation_mm, unit: "mm", color: "#4ab0d8" },
              { label: "Soil Moisture", value: features_snapshot.Soil_Moisture, unit: "", color: "#8b6f47", decimals: 2 },
              { label: "Temperature", value: features_snapshot.Temperature_C, unit: "°C", color: "#f2d16d" },
              { label: "Elevation", value: features_snapshot.Elevation_m, unit: "m", color: "rgba(236,232,223,0.6)" },
            ].map((f) => <FeatureCard key={f.label} {...f} />)}
          </div>
        </div>
      </motion.div>
    );
  }

  // ── SAR Insights API display ──────────────────────────────────────────────
  const summary = result.summary ?? {};
  const floodZones = result.flood_zones?.features ?? [];
  const alertLevel = deriveAlertLevel(summary);

  const floodArea = summary.total_flood_area_km2 ?? 0;
  const popExposed = summary.population_exposed ?? 0;
  const confidence = summary.confidence_avg ?? 0;
  const zonesCount = summary.zones_count ?? 0;
  const avgDepth = summary.avg_depth_m ?? 0;
  const maxDepth = summary.max_depth_m ?? 0;
  const regionName = summary.region_name ?? geocoded?.display_name ?? "";

  // Extra fields from the API (merged in RegionForm)
  const sarImageUrl = result.sar_image_url;
  const aiInsight = result.ai_insight;
  const processingTime = result.processing_time_s;
  const sceneId = result.scene_id;
  const meanDbDrop = result.mean_db_drop;
  const analysisDate = result.analysis_date;
  const sensor = result.sensor ?? "S1_GRD";
  const detector = result.detector ?? "sar_logratio";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-4"
    >
      {/* Processing Time Badge */}
      <ProcessingBadge seconds={processingTime} analysisDate={analysisDate} />

      {/* Main Stats Card */}
      <div style={{ background: "#0a0907", border: "1px solid rgba(242,209,109,0.15)" }}>
        {/* Header */}
        <div className="px-4 py-3 border-b" style={{ borderColor: "rgba(242,209,109,0.15)" }}>
          <div
            className="text-[9px] font-mono uppercase tracking-[0.3em] mb-4"
            style={{ color: "rgba(242,209,109,0.6)" }}
          >
            SAR Flood Analysis
          </div>

          <div className="space-y-3">
            <AlertBadge alertLevel={alertLevel} />

            <div className="flex items-baseline gap-2">
              <div className="text-4xl font-mono font-bold" style={{ color: "#f2d16d" }}>
                {floodArea.toFixed(1)}
              </div>
              <div className="text-sm font-mono" style={{ color: "rgba(236,232,223,0.5)" }}>
                km² Flooded
              </div>
            </div>

            <button
              onClick={() => generateDetectionReport(result, geocoded)}
              className="text-[9px] font-mono uppercase tracking-widest px-3 py-1.5 border rounded transition-colors hover:bg-[rgba(242,209,109,0.1)]"
              style={{ borderColor: "rgba(242,209,109,0.4)", color: "#f2d16d" }}
            >
              Export PDF
            </button>
          </div>
        </div>

        {/* Metadata */}
        <div className="px-4 py-3 border-b space-y-2" style={{ borderColor: "rgba(242,209,109,0.15)" }}>
          <MetaRow label="Region" value={regionName} color="#ece8df" />
          <MetaRow label="Sensor" value={sensor} color="#f2d16d" />
          <MetaRow label="Detector" value={detector} />
          {meanDbDrop != null && (
            <MetaRow
              label="Mean dB Drop"
              value={`${meanDbDrop.toFixed(3)} dB`}
              color="#4ab0d8"
            />
          )}
        </div>

        {/* Statistics Grid */}
        <div
          className="px-4 py-2 border-b sticky top-0 bg-[#0a0907]/90 backdrop-blur-sm z-10"
          style={{ borderColor: "rgba(242,209,109,0.15)" }}
        >
          <span
            className="text-[9px] font-mono tracking-widest uppercase"
            style={{ color: "rgba(236,232,223,0.4)" }}
          >
            Detection Statistics
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 p-4">
          <FeatureCard label="Flood Area" value={floodArea} unit="km²" color="#4ab0d8" decimals={2} />
          <FeatureCard label="Flood Zones" value={zonesCount} unit="" color="#f2d16d" />
          <FeatureCard label="Population Exposed" value={popExposed} unit="" color="#c0392b" />
          <FeatureCard label="Confidence" value={confidence * 100} unit="%" color="#22c55e" decimals={1} />
          <FeatureCard label="Avg Depth" value={avgDepth} unit="m" color="#8b6f47" decimals={2} />
          <FeatureCard label="Max Depth" value={maxDepth} unit="m" color="#d4900a" decimals={2} />
        </div>
      </div>

      {/* Charts Section */}
      <SeverityBreakdownChart zones={floodZones} />
      <ConfidenceGauge confidence={confidence} />

      {/* SAR Image Panel */}
      <SarImagePanel src={sarImageUrl} location={regionName} sceneId={sceneId} />

      {/* AI Insight Narrative */}
      <AiInsightPanel text={aiInsight} alertLevel={alertLevel} />

      {/* Flood Zones Detail */}
      {floodZones.length > 0 && (
        <div style={{ border: "1px solid rgba(242,209,109,0.15)" }}>
          <div
            className="px-4 py-2 border-b"
            style={{
              borderColor: "rgba(242,209,109,0.15)",
              background: "rgba(242,209,109,0.03)",
            }}
          >
            <span
              className="text-[9px] font-mono tracking-widest uppercase"
              style={{ color: "rgba(236,232,223,0.4)" }}
            >
              Flood Zones ({floodZones.length})
            </span>
          </div>
          <div className="divide-y divide-[rgba(242,209,109,0.08)]">
            {floodZones.map((f, i) => {
              const p = f.properties ?? {};
              const sevColor =
                p.severity === "critical" ? "#c0392b"
                : p.severity === "high" ? "#dc7828"
                : p.severity === "medium" ? "#f2d16d"
                : "#22c55e";
              return (
                <motion.div
                  key={p.zone_id ?? i}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.06 }}
                  className="px-4 py-3"
                >
                  <div className="flex justify-between items-center mb-1">
                    <span
                      className="text-[9px] font-mono font-bold tracking-wider"
                      style={{ color: "#f2d16d" }}
                    >
                      {p.zone_id ?? `Zone ${i + 1}`}
                    </span>
                    <span
                      className="text-[8px] font-mono uppercase px-1.5 py-0.5 rounded border"
                      style={{
                        color: sevColor,
                        borderColor: `${sevColor}50`,
                        background: `${sevColor}10`,
                      }}
                    >
                      {p.severity ?? "unknown"}
                    </span>
                  </div>
                  <div
                    className="flex gap-4 text-[9px] font-mono"
                    style={{ color: "rgba(236,232,223,0.5)" }}
                  >
                    <span>{(p.area_km2 ?? 0).toFixed(2)} km²</span>
                    <span>Pop: {p.population_exposed ?? 0}</span>
                    {p.admin_name && <span>{p.admin_name}</span>}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}
    </motion.div>
  );
}
