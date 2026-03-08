import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useGlobeStore } from "../../stores/globeStore.js";
import { useRiskStore } from "../../stores/riskStore.js";
import { useLifelineStore } from "../../stores/lifelineStore.js";

const DETECTION_STAGES = [
  { id: "queued", label: "Queued", icon: "Q" },
  { id: "preprocessing", label: "Preprocessing", icon: "P" },
  { id: "detecting", label: "Flood Detection", icon: "D" },
  { id: "scoring", label: "Risk Scoring", icon: "R" },
];

const RISK_STAGES = [
  { id: "fetching", label: "Fetching Census Data", icon: "C" },
  { id: "scoring", label: "Scoring District Risk", icon: "S" },
];

const LIFELINE_STAGES = [
  { id: "scanning", label: "Scanning Infrastructure", icon: "S" },
  { id: "indexing", label: "Indexing Points", icon: "I" },
];

export default function ProgressOverlay({ activeView = "detection" }) {
  const dStatus = useGlobeStore((s) => s.status);
  const dProgress = useGlobeStore((s) => s.progress);
  const dError = useGlobeStore((s) => s.error);

  const rLoading = useRiskStore((s) => s.isLoading);
  const rError = useRiskStore((s) => s.error);

  const lLoading = useLifelineStore((s) => s.isLoading);
  const lError = useLifelineStore((s) => s.error);

  const [fakeProgress, setFakeProgress] = useState(0);

  useEffect(() => {
    if (activeView === "risk" && rLoading) {
      setFakeProgress(0);
      const int = setInterval(
        () => setFakeProgress((p) => (p < 95 ? p + 5 : p)),
        200,
      );
      return () => clearInterval(int);
    } else if (activeView === "lifeline" && lLoading) {
      setFakeProgress(0);
      const int = setInterval(
        () => setFakeProgress((p) => (p < 95 ? p + 5 : p)),
        300,
      );
      return () => clearInterval(int);
    }
  }, [activeView, rLoading, lLoading]);

  let status, progress, error, stages, title, failedLabel;

  if (activeView === "detection") {
    status = dStatus;
    progress = dProgress;
    error = dError;
    stages = DETECTION_STAGES;
    title = "Scanning Area...";
    failedLabel = "Detection Failed";
  } else if (activeView === "risk") {
    status =
      rError ? "failed"
      : rLoading ?
        fakeProgress > 50 ?
          "scoring"
        : "fetching"
      : "idle";
    progress = rLoading ? fakeProgress : 0;
    error = rError;
    stages = RISK_STAGES;
    title = "Calculating Risk...";
    failedLabel = "Risk Analysis Failed";
  } else if (activeView === "lifeline") {
    status =
      lError ? "failed"
      : lLoading ?
        fakeProgress > 50 ?
          "indexing"
        : "scanning"
      : "idle";
    progress = lLoading ? fakeProgress : 0;
    error = lError;
    stages = LIFELINE_STAGES;
    title = "Mapping Infrastructure...";
    failedLabel = "Lifeline Scan Failed";
  }

  const currentIdx = stages.findIndex((s) => s.id === status);

  if (status === "failed") {
    return (
      <div
        className="absolute inset-x-4 bottom-4 p-4 z-10"
        style={{ background: "#0a0907", border: "1px solid #c0392b" }}
      >
        <div
          className="text-[10px] font-mono tracking-widest uppercase mb-1"
          style={{ color: "#c0392b" }}
        >
          {failedLabel}
        </div>
        <div
          className="text-[9px] font-mono tracking-widest uppercase"
          style={{ color: "rgba(236,232,223,0.5)" }}
        >
          {error ?? "Unknown error"}
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="absolute inset-x-4 bottom-4 p-4 z-10"
      style={{
        background: "#0a0907",
        border: "1px solid rgba(242,209,109,0.52)",
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <span
          className="text-[9px] font-mono tracking-[0.2em] uppercase"
          style={{ color: "#f2d16d" }}
        >
          {title}
        </span>
        <span
          className="text-[10px] font-mono tracking-widest"
          style={{ color: "#ece8df" }}
        >
          {progress}%
        </span>
      </div>

      {/* Progress bar */}
      <div
        className="h-0.5 overflow-hidden mb-4"
        style={{ background: "rgba(236,232,223,0.1)" }}
      >
        <motion.div
          className="h-full"
          style={{ background: "#f2d16d" }}
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>

      {/* Stage indicators */}
      <div className="flex items-center gap-4">
        {stages.map((stage, i) => {
          const isDone = i < currentIdx;
          const isCurrent = i === currentIdx;
          return (
            <div
              key={stage.id}
              className="flex items-center gap-2 text-[9px] font-mono uppercase tracking-widest"
              style={{
                color:
                  isDone ? "rgba(236,232,223,0.5)"
                  : isCurrent ? "#f2d16d"
                  : "rgba(236,232,223,0.2)",
              }}
            >
              {isDone ?
                <span
                  className="w-3 h-3 flex items-center justify-center text-[8px]"
                  style={{
                    background: "rgba(236,232,223,0.1)",
                    color: "#ece8df",
                  }}
                >
                  X
                </span>
              : isCurrent ?
                <span
                  className="w-3 h-3 flex items-center justify-center"
                  style={{
                    border: "1px solid #f2d16d",
                    background: "rgba(242,209,109,0.1)",
                  }}
                >
                  <span
                    className="w-1.5 h-1.5 animate-pulse"
                    style={{ background: "#f2d16d" }}
                  />
                </span>
              : <span
                  className="w-3 h-3 flex items-center justify-center text-[7px]"
                  style={{ border: "1px solid rgba(236,232,223,0.2)" }}
                >
                  {stage.icon}
                </span>
              }
              <span className="hidden sm:inline">{stage.label}</span>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
