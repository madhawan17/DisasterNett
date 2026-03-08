import React from "react";
import { motion } from "framer-motion";
import { useGlobeStore } from "../../stores/globeStore.js";
import { generateDetectionReport } from "../../utils/reports/generateDetectionReport.js";

const ALERT_STYLES = {
  LOW: {
    bg: "rgba(34,197,94,0.08)",
    border: "#22c55e",
    text: "#22c55e",
    label: "LOW",
  },
  MEDIUM: {
    bg: "rgba(242,209,109,0.08)",
    border: "#f2d16d",
    text: "#f2d16d",
    label: "MODERATE",
  },
  HIGH: {
    bg: "rgba(220,120,40,0.12)",
    border: "#dc7828",
    text: "#dc7828",
    label: "HIGH",
  },
  CRITICAL: {
    bg: "rgba(192,57,43,0.12)",
    border: "#c0392b",
    text: "#c0392b",
    label: "CRITICAL",
  },
};

function AlertBadge({ alertLevel }) {
  const style = ALERT_STYLES[alertLevel] ?? ALERT_STYLES.MEDIUM;
  return (
    <div
      className="inline-flex items-center gap-2 px-3 py-2 border rounded"
      style={{ background: style.bg, borderColor: style.border }}
    >
      <span
        className="w-2 h-2 rounded-full"
        style={{ background: style.text }}
      />
      <span
        className="text-[11px] font-mono font-bold tracking-widest uppercase"
        style={{ color: style.text }}
      >
        {style.label}
      </span>
    </div>
  );
}

export default function ResultsPanel() {
  const result = useGlobeStore((s) => s.result);
  const geocoded = useGlobeStore((s) => s.geocoded);

  if (!result) return null;

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
      className="flex flex-col flex-1"
      style={{
        background: "#0a0907",
        border: "1px solid rgba(242,209,109,0.15)",
      }}
    >
      {/* Header */}
      <div
        className="px-4 py-3 border-b"
        style={{ borderColor: "rgba(242,209,109,0.15)" }}
      >
        <div
          className="text-[9px] font-mono uppercase tracking-[0.3em] mb-4"
          style={{ color: "rgba(242,209,109,0.6)" }}
        >
          Flood Risk Forecast
        </div>

        {/* Alert Level & Probability */}
        <div className="space-y-3">
          <AlertBadge alertLevel={alert_level} />

          <div className="flex items-baseline gap-2">
            <div
              className="text-4xl font-mono font-bold"
              style={{ color: "#f2d16d" }}
            >
              {probabilityPercent}
            </div>
            <div
              className="text-sm font-mono"
              style={{ color: "rgba(236,232,223,0.5)" }}
            >
              Flood Probability
            </div>
          </div>

          <button
            onClick={() => generateDetectionReport(result, geocoded)}
            className="text-[9px] font-mono uppercase tracking-widest px-3 py-1.5 border rounded transition-colors hover:bg-[rgba(242,209,109,0.1)]"
            style={{
              borderColor: "rgba(242,209,109,0.4)",
              color: "#f2d16d",
            }}
          >
            Export PDF
          </button>
        </div>
      </div>

      {/* Metadata */}
      <div
        className="px-4 py-3 border-b space-y-2"
        style={{ borderColor: "rgba(242,209,109,0.15)" }}
      >
        <div className="flex items-center justify-between">
          <span
            className="text-[9px] font-mono tracking-widest uppercase"
            style={{ color: "rgba(236,232,223,0.4)" }}
          >
            Forecast Window
          </span>
          <span className="text-[9px] font-mono" style={{ color: "#f2d16d" }}>
            {forecast_horizon_hours}H
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span
            className="text-[9px] font-mono tracking-widest uppercase"
            style={{ color: "rgba(236,232,223,0.4)" }}
          >
            Peak Flood Est.
          </span>
          <span className="text-[9px] font-mono" style={{ color: "#c0392b" }}>
            {peak_flood_time}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span
            className="text-[9px] font-mono tracking-widest uppercase"
            style={{ color: "rgba(236,232,223,0.4)" }}
          >
            Latest Data
          </span>
          <span
            className="text-[9px] font-mono"
            style={{ color: "rgba(236,232,223,0.6)" }}
          >
            {based_on_data_until?.replace("+00:00", "")}
          </span>
        </div>
      </div>

      {/* Features Snapshot Grid */}
      <div className="flex-1 overflow-y-auto">
        <div
          className="px-4 py-3 border-b sticky top-0 bg-[#0a0907]/90 backdrop-blur-sm z-10"
          style={{ borderColor: "rgba(242,209,109,0.15)" }}
        >
          <span
            className="text-[9px] font-mono tracking-widest uppercase"
            style={{ color: "rgba(236,232,223,0.4)" }}
          >
            Meteorological Features
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 p-4">
          {[
            {
              label: "Precipitation",
              value: features_snapshot.Precipitation_mm,
              unit: "mm",
              color: "#4ab0d8",
            },
            {
              label: "Soil Moisture",
              value: features_snapshot.Soil_Moisture,
              unit: "",
              color: "#8b6f47",
              decimals: 2,
            },
            {
              label: "Temperature",
              value: features_snapshot.Temperature_C,
              unit: "°C",
              color: "#f2d16d",
            },
            {
              label: "Elevation",
              value: features_snapshot.Elevation_m,
              unit: "m",
              color: "rgba(236,232,223,0.6)",
            },
            {
              label: "Rain (24H)",
              value: features_snapshot.Rain_24h,
              unit: "mm",
              color: "#d4900a",
            },
            {
              label: "Rain (12H)",
              value: features_snapshot.Rain_12h,
              unit: "mm",
              color: "#e8a338",
            },
          ].map((feature) => {
            const displayValue =
              feature.decimals !== undefined ?
                feature.value?.toFixed(feature.decimals)
              : Math.round(feature.value ?? 0);

            return (
              <div
                key={feature.label}
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
                  {feature.label}
                </div>
                <div
                  className="text-sm font-mono font-bold"
                  style={{ color: feature.color }}
                >
                  {displayValue} {feature.unit}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
