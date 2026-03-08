import React, { useState } from "react";
import { motion } from "framer-motion";
import CesiumGlobe from "../components/globe/CesiumGlobe.jsx";
import RegionForm from "../components/globe/RegionForm.jsx";
import ResultsPanel from "../components/globe/ResultsPanel.jsx";
import ProgressOverlay from "../components/globe/ProgressOverlay.jsx";
import RiskDashboardPanel from "../components/globe/RiskDashboardPanel.jsx";
import LifelinePanel from "../components/globe/LifelinePanel.jsx";
import GlobeLegend from "../components/globe/GlobeLegend.jsx";
import { useGlobeStore } from "../stores/globeStore.js";
import { useRiskStore } from "../stores/riskStore.js";
import { useLifelineStore } from "../stores/lifelineStore.js";

const STATUS_CONFIG = {
  idle: { label: "IDLE", style: "text-text-3 border-white/10" },
  queued: { label: "QUEUED", style: "text-[#f2d16d] border-[#f2d16d]/30" },
  preprocessing: {
    label: "PREPROCESSING",
    style: "text-[#f2d16d] border-[#f2d16d]/30",
  },
  detecting: {
    label: "DETECTING",
    style: "text-[#f2d16d] border-[#f2d16d]/30",
  },
  scoring: { label: "SCORING", style: "text-[#f2d16d] border-[#f2d16d]/30" },
  completed: {
    label: "COMPLETED",
    style: "text-[#ece8df] border-[#ece8df]/40",
  },
  failed: { label: "FAILED", style: "text-[#c0392b] border-[#c0392b]/40" },
};

export default function GlobeAnalysis() {
  const [activeView, setActiveView] = useState("detection");

  const status = useGlobeStore((s) => s.status);
  const result = useGlobeStore((s) => s.result);
  const geocoded = useGlobeStore((s) => s.geocoded);
  const hardResetGlobe = useGlobeStore((s) => s.hardReset);
  const clearRiskData = useRiskStore((s) => s.clearRiskData);
  const clearLifelineData = useLifelineStore((s) => s.clearLifelineData);

  const isRunning = [
    "queued",
    "preprocessing",
    "detecting",
    "scoring",
  ].includes(status);
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.idle;

  const isRiskLoading = useRiskStore((s) => s.isLoading);
  const riskError = useRiskStore((s) => s.error);

  const isLifelineLoading = useLifelineStore((s) => s.isLoading);
  const lifelineError = useLifelineStore((s) => s.error);

  const showOverlay = (() => {
    if (activeView === "detection") return isRunning || status === "failed";
    if (activeView === "risk") return isRiskLoading || !!riskError;
    if (activeView === "lifeline") return isLifelineLoading || !!lifelineError;
    return false;
  })();

  const handleGlobalReset = () => {
    hardResetGlobe();
    clearRiskData();
    clearLifelineData();
    setActiveView("detection");
  };

  const handleViewChange = (view) => {
    setActiveView(view);
    // Optionally clear other panel data when swapping views to keep globe clean
    if (view === "detection") {
      clearRiskData();
      clearLifelineData();
    } else if (view === "risk") {
      hardResetGlobe();
      clearLifelineData();
    } else if (view === "lifeline") {
      hardResetGlobe();
      clearRiskData();
    }
  };

  return (
    <div
      className="min-h-screen pt-14 flex flex-col"
      style={{ background: "#060504" }}
    >
      <div
        className="flex-1 flex flex-col max-w-[1700px] mx-auto w-full
                       px-4 sm:px-8 py-6 sm:py-8 gap-6"
      >
        {/* Header */}
        <div
          className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-4"
          style={{ borderBottom: "1px solid rgba(242,209,109,0.15)" }}
        >
          <div>
            <span
              className="tracking-[0.35em] uppercase mb-2 block"
              style={{
                fontSize: "0.6rem",
                color: "#f2d16d",
                fontFamily: "monospace",
              }}
            >
              Theater Operations
            </span>
            <h1
              className="font-display font-light uppercase tracking-[0.2em]"
              style={{ fontSize: "1.4rem", color: "#ece8df" }}
            >
              Global Flood Detection
            </h1>
          </div>

          <div className="flex flex-col items-end gap-3">
            <div className="flex items-center gap-3">
              {/* Reset button */}
              <button
                onClick={handleGlobalReset}
                className="px-2 py-0.5 text-[10px] uppercase font-mono tracking-widest border transition-colors border-red-900/40 text-red-500 hover:bg-red-900/20"
              >
                RESET GLOBE
              </button>

              {/* Status chip */}
              <div
                className={`px-2 py-0.5 text-[10px] uppercase font-mono tracking-widest border bg-transparent ${cfg.style}`}
              >
                {isRunning && (
                  <span className="w-1.5 h-1.5 bg-[#f2d16d] inline-block mb-[1px] mr-2" />
                )}
                {cfg.label}
              </div>
            </div>

            {/* Region display */}
            {geocoded?.display_name && (
              <div
                className="text-[10px] font-mono uppercase tracking-widest"
                style={{ color: "rgba(236,232,223,0.6)" }}
              >
                {geocoded.display_name}
              </div>
            )}
          </div>
        </div>

        {/* Main grid */}
        <div
          className="flex-1 flex flex-col lg:grid lg:grid-cols-12 gap-6"
          style={{ minHeight: "min(600px, 75vh)" }}
        >
          {/* Globe panel */}
          <div
            className="col-span-12 lg:col-span-8 relative min-h-[420px]"
            style={{ border: "1px solid rgba(242,209,109,0.4)" }}
          >
            <CesiumGlobe />
            {showOverlay && <ProgressOverlay activeView={activeView} />}

            <GlobeLegend activeView={activeView} />

            {/* Corner brackets */}
            <div className="absolute top-0 left-0 w-2 h-2 border-t-2 border-l-2 border-[#f2d16d] z-10" />
            <div className="absolute top-0 right-0 w-2 h-2 border-t-2 border-r-2 border-[#f2d16d] z-10" />
            <div className="absolute bottom-0 left-0 w-2 h-2 border-b-2 border-l-2 border-[#f2d16d] z-10" />
            <div className="absolute bottom-0 right-0 w-2 h-2 border-b-2 border-r-2 border-[#f2d16d] z-10" />
          </div>

          {/* Sidebar */}
          <div
            className="col-span-12 lg:col-span-4 flex flex-col gap-6
                          overflow-y-auto lg:max-h-[calc(100vh-10rem)] pr-2"
          >
            {/* Tab Switcher */}
            <div className="flex gap-2 border-b border-[rgba(242,209,109,0.15)] pb-4">
              <motion.button
                onClick={() => handleViewChange("detection")}
                className={`flex-1 px-2 py-2 text-[10px] uppercase tracking-widest font-mono border transition-all duration-200 ${
                  activeView === "detection" ?
                    "border-[#f2d16d] text-[#f2d16d] bg-[#0a0907]/50"
                  : "border-[rgba(242,209,109,0.15)] text-text-3 hover:border-[#f2d16d]/30"
                }`}
                whileHover={activeView !== "detection" ? { y: -1 } : {}}
              >
                DETECTION
              </motion.button>
              <motion.button
                onClick={() => handleViewChange("risk")}
                className={`flex-1 px-2 py-2 text-[10px] uppercase tracking-widest font-mono border transition-all duration-200 ${
                  activeView === "risk" ?
                    "border-[#f2d16d] text-[#f2d16d] bg-[#0a0907]/50"
                  : "border-[rgba(242,209,109,0.15)] text-text-3 hover:border-[#f2d16d]/30"
                }`}
                whileHover={activeView !== "risk" ? { y: -1 } : {}}
              >
                RISK
              </motion.button>
              <motion.button
                onClick={() => handleViewChange("lifeline")}
                className={`flex-1 px-2 py-2 text-[10px] uppercase tracking-widest font-mono border transition-all duration-200 ${
                  activeView === "lifeline" ?
                    "border-[#f2d16d] text-[#f2d16d] bg-[#0a0907]/50"
                  : "border-[rgba(242,209,109,0.15)] text-text-3 hover:border-[#f2d16d]/30"
                }`}
                whileHover={activeView !== "lifeline" ? { y: -1 } : {}}
              >
                LIFELINE
              </motion.button>
            </div>

            {/* Conditional Content */}
            {activeView === "detection" && (
              <>
                <RegionForm />
                {result && <ResultsPanel />}
              </>
            )}

            {activeView === "risk" && <RiskDashboardPanel />}

            {activeView === "lifeline" && <LifelinePanel />}
          </div>
        </div>
      </div>
    </div>
  );
}
