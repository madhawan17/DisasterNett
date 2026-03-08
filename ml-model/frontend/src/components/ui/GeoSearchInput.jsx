import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

export default function GeoSearchInput({
  label,
  placeholder,
  value,
  onChange,
  results,
  onSelect,
  isSearching,
  onClear,
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Open when results arrive
  useEffect(() => {
    if (results.length > 0) setOpen(true);
  }, [results]);

  return (
    <div ref={wrapRef} className="relative">
      <label
        className="text-[10px] uppercase font-mono tracking-[0.2em] mb-2 block"
        style={{ color: "rgba(236,232,223,0.5)" }}
      >
        {label}
      </label>
      <div className="relative flex items-center">
        <input
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (results.length > 0) setOpen(true);
          }}
          placeholder={placeholder}
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
          autoComplete="off"
        />
        {isSearching && (
          <span
            className="absolute right-3 text-[10px] font-mono tracking-widest animate-pulse"
            style={{ color: "rgba(242,209,109,0.5)" }}
          >
            ...
          </span>
        )}
        {!isSearching && value && (
          <button
            type="button"
            onClick={() => {
              onClear();
              setOpen(false);
            }}
            className="absolute right-3 text-xs"
            style={{ color: "rgba(236,232,223,0.4)", fontFamily: "monospace" }}
          >
            [X]
          </button>
        )}
      </div>

      <AnimatePresence>
        {open && results.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute z-50 w-full mt-1 overflow-hidden"
            style={{
              background: "#0a0907",
              border: "1px solid rgba(242,209,109,0.3)",
              borderTop: "none",
              maxHeight: "200px",
              overflowY: "auto",
            }}
          >
            {results.map((item) => {
              const parts = item.display_name.split(",").map((s) => s.trim());
              const primary = parts[0];
              const secondary = parts.slice(1, 3).join(", ");
              return (
                <button
                  key={item.place_id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSelect(item);
                    setOpen(false);
                  }}
                  className="w-full text-left px-3 py-2.5 flex flex-col hover:bg-[rgba(242,209,109,0.05)] transition-colors"
                  style={{ borderBottom: "1px solid rgba(242,209,109,0.08)" }}
                >
                  <span
                    className="text-[11px] font-mono uppercase tracking-widest truncate"
                    style={{ color: "#ece8df" }}
                  >
                    {primary}
                  </span>
                  {secondary && (
                    <span
                      className="text-[9px] font-mono uppercase tracking-wider truncate"
                      style={{ color: "rgba(236,232,223,0.4)" }}
                    >
                      {secondary}
                    </span>
                  )}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
