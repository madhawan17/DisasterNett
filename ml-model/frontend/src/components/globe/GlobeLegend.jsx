import React from "react";
import { motion, AnimatePresence } from "framer-motion";

export default function GlobeLegend({ activeView }) {
  const getLegendContent = () => {
    switch (activeView) {
      case "detection":
        return (
          <>
            <div className="text-[9px] uppercase tracking-widest text-[#f2d16d]/70 mb-2 font-mono">
              Detection Alert Levels
            </div>
            <div className="flex flex-col gap-1.5 min-w-[120px]">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#c0392b] border border-white/20" />
                <span className="text-[10px] text-[#ece8df] font-mono">
                  CRITICAL
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#dc7828] border border-white/20" />
                <span className="text-[10px] text-[#ece8df] font-mono">
                  HIGH
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#f2d16d] border border-white/20" />
                <span className="text-[10px] text-[#ece8df] font-mono">
                  MEDIUM
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#22c55e] border border-white/20" />
                <span className="text-[10px] text-[#ece8df] font-mono">
                  LOW
                </span>
              </div>
            </div>
          </>
        );
      case "risk":
        return (
          <>
            <div className="text-[9px] uppercase tracking-widest text-[#f2d16d]/70 mb-2 font-mono">
              Risk Dashboard
            </div>
            <div className="flex flex-col gap-1.5 min-w-[120px] mb-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#c0392b] shadow-[0_0_8px_rgba(192,57,43,0.8)]" />
                <span className="text-[10px] text-[#ece8df] font-mono">
                  CRITICAL RISK
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#dc7828] shadow-[0_0_8px_rgba(220,120,40,0.8)]" />
                <span className="text-[10px] text-[#ece8df] font-mono">
                  HIGH RISK
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#f2d16d] shadow-[0_0_8px_rgba(242,209,109,0.8)]" />
                <span className="text-[10px] text-[#ece8df] font-mono">
                  MEDIUM RISK
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#22c55e] shadow-[0_0_8px_rgba(34,197,94,0.8)]" />
                <span className="text-[10px] text-[#ece8df] font-mono">
                  LOW RISK
                </span>
              </div>
            </div>
            <div className="text-[9px] uppercase tracking-widest text-[#f2d16d]/70 mb-2 font-mono border-t border-[rgba(242,209,109,0.15)] pt-2">
              Scale
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 border border-[#ece8df]/40 rounded-full flex items-center justify-center">
                <div className="w-1 h-1 bg-[#ece8df]/40 rounded-full"></div>
              </div>
              <span className="text-[10px] text-[#ece8df] font-mono">
                POPULATION SIZE
              </span>
            </div>
          </>
        );
      case "lifeline":
        return (
          <>
            <div className="text-[9px] uppercase tracking-widest text-[#f2d16d]/70 mb-2 font-mono">
              Lifeline Infrastructure
            </div>
            <div className="flex flex-col gap-1.5 min-w-[150px]">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#ff0000] border border-black/50" />
                <span className="text-[10px] text-[#ece8df] font-mono">
                  HOSPITAL
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#1e90ff] border border-black/50" />
                <span className="text-[10px] text-[#ece8df] font-mono">
                  SCHOOL
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#800080] border border-black/50" />
                <span className="text-[10px] text-[#ece8df] font-mono">
                  PLACE OF WORSHIP
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#32cd32] border border-black/50" />
                <span className="text-[10px] text-[#ece8df] font-mono">
                  RESIDENTIAL
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#ffd700] border border-black/50" />
                <span className="text-[10px] text-[#ece8df] font-mono">
                  COMMERCIAL
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#808080] opacity-80 border border-black/50" />
                <span className="text-[10px] text-[#ece8df] font-mono">
                  GENERAL BUILDING
                </span>
              </div>
            </div>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={activeView}
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -10 }}
        transition={{ duration: 0.3 }}
        className="absolute top-4 left-4 z-20 bg-[#0a0907]/80 backdrop-blur-md border border-[rgba(242,209,109,0.2)] p-3 rounded"
      >
        {getLegendContent()}
      </motion.div>
    </AnimatePresence>
  );
}
