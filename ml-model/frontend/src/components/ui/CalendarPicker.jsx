import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Google Calendar–style date picker: month grid, today highlight, clean typography.
 * Returns date as YYYY-MM-DD via onChange.
 */
export default function CalendarPicker({ value, onChange, label = "Date" }) {
  const [open, setOpen] = useState(false);
  const [showYearPicker, setShowYearPicker] = useState(false);
  const [viewDate, setViewDate] = useState(() => {
    if (value) {
      const [y, m] = value.split("-").map(Number);
      return new Date(y, m - 1, 1);
    }
    return new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  });

  const displayLabel =
    value ?
      (() => {
        const d = new Date(value);
        return d.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
      })()
    : "Select date";

  const { year, month, weeks } = useMemo(() => {
    const y = viewDate.getFullYear();
    const m = viewDate.getMonth();
    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0);
    const startPad = first.getDay();
    const daysInMonth = last.getDate();
    const totalCells = startPad + daysInMonth;
    const rows = Math.ceil(totalCells / 7);
    const weeks = [];
    let day = 1;
    for (let r = 0; r < rows; r++) {
      const week = [];
      for (let c = 0; c < 7; c++) {
        const i = r * 7 + c;
        if (i < startPad || day > daysInMonth) {
          week.push(null);
        } else {
          week.push(day++);
        }
      }
      weeks.push(week);
    }
    return {
      year: y,
      month: m,
      monthName: viewDate.toLocaleDateString("en-US", { month: "long" }),
      weeks,
    };
  }, [viewDate]);

  const today = useMemo(() => {
    const t = new Date();
    return t.getFullYear() === year && t.getMonth() === month ?
        t.getDate()
      : null;
  }, [year, month]);

  const selectDay = (day) => {
    if (!day) return;
    const yyyy = year;
    const mm = String(month + 1).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    onChange(`${yyyy}-${mm}-${dd}`);
    setOpen(false);
  };

  const prevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1));

  return (
    <div className="relative">
      {label && (
        <label
          className="text-[10px] uppercase font-mono tracking-[0.2em] mb-2 block"
          style={{ color: "rgba(236,232,223,0.5)" }}
        >
          {label}
        </label>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 transition-all outline-none text-xs font-mono tracking-wide"
        style={{
          background: "rgba(236,232,223,0.03)",
          border: `1px solid ${open ? "#f2d16d" : "rgba(242,209,109,0.15)"}`,
          color: value ? "#ece8df" : "rgba(236,232,223,0.4)",
        }}
      >
        <span>{displayLabel}</span>
        <span style={{ color: "rgba(242,209,109,0.5)" }}>▾</span>
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div
              className="fixed inset-0 z-40"
              aria-hidden="true"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="absolute z-50 top-full left-0 mt-1 w-[280px]"
              style={{
                background: "#0a0907",
                border: "1px solid rgba(242,209,109,0.3)",
                borderTop: "none",
              }}
            >
              {/* Month header */}
              <div
                className="flex items-center justify-between px-3 py-2.5 border-b"
                style={{ borderColor: "rgba(242,209,109,0.15)" }}
              >
                <button
                  type="button"
                  onClick={prevMonth}
                  className="p-1 px-2 hover:bg-[rgba(242,209,109,0.1)] transition-colors text-[10px]"
                  style={{ color: "#f2d16d", fontFamily: "monospace" }}
                  aria-label="Previous month"
                >
                  [‹]
                </button>
                <div className="flex items-center gap-2">
                  <span
                    className="text-[10px] uppercase font-mono tracking-widest"
                    style={{ color: "#ece8df" }}
                  >
                    {viewDate.toLocaleDateString("en-US", { month: "short" })}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowYearPicker(true)}
                    className="text-[10px] uppercase font-mono tracking-widest hover:bg-[rgba(242,209,109,0.1)] transition-colors px-1 rounded"
                    style={{ color: "#ece8df" }}
                  >
                    {year} ▾
                  </button>
                </div>
                <button
                  type="button"
                  onClick={nextMonth}
                  className="p-1 px-2 hover:bg-[rgba(242,209,109,0.1)] transition-colors text-[10px]"
                  style={{ color: "#f2d16d", fontFamily: "monospace" }}
                  aria-label="Next month"
                >
                  [›]
                </button>
              </div>

              {/* Days Grid OR Year Picker */}
              {showYearPicker ?
                <div className="p-3">
                  <div
                    className="flex items-center justify-between mb-3 border-b pb-2"
                    style={{ borderColor: "rgba(242,209,109,0.15)" }}
                  >
                    <span
                      className="text-[10px] uppercase font-mono tracking-widest"
                      style={{ color: "#f2d16d" }}
                    >
                      Select Year
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowYearPicker(false)}
                      className="text-[10px] uppercase font-mono tracking-widest hover:text-[#ece8df]"
                      style={{ color: "rgba(236,232,223,0.5)" }}
                    >
                      [Close]
                    </button>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {Array.from({ length: 24 }, (_, i) => {
                      const yr = new Date().getFullYear() - 12 + i;
                      const isCurrentYear = yr === year;
                      return (
                        <button
                          key={yr}
                          type="button"
                          onClick={() => {
                            setViewDate(new Date(yr, month, 1));
                            setShowYearPicker(false);
                          }}
                          className="py-1.5 text-[10px] font-mono transition-colors"
                          style={{
                            background:
                              isCurrentYear ?
                                "rgba(242,209,109,0.2)"
                              : "rgba(236,232,223,0.03)",
                            color: isCurrentYear ? "#f2d16d" : "#ece8df",
                            border: `1px solid ${isCurrentYear ? "#f2d16d" : "rgba(242,209,109,0.15)"}`,
                          }}
                          onMouseEnter={(e) => {
                            if (!isCurrentYear) {
                              e.currentTarget.style.background =
                                "rgba(242,209,109,0.1)";
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!isCurrentYear) {
                              e.currentTarget.style.background =
                                "rgba(236,232,223,0.03)";
                            }
                          }}
                        >
                          {yr}
                        </button>
                      );
                    })}
                  </div>
                </div>
              : <>
                  {/* Weekday headers */}
                  <div className="grid grid-cols-7 gap-px px-2 pt-2 pb-1">
                    {WEEKDAYS.map((d) => (
                      <div
                        key={d}
                        className="text-center text-[8px] uppercase tracking-wider font-mono py-1"
                        style={{ color: "rgba(236,232,223,0.3)" }}
                      >
                        {d}
                      </div>
                    ))}
                  </div>

                  {/* Days */}
                  <div className="grid grid-cols-7 gap-0.5 px-2 pb-3">
                    {weeks.flatMap((week, wi) =>
                      week.map((day, di) => {
                        const key = `${wi}-${di}-${day ?? "e"}`;
                        const isToday = day === today;
                        const selected =
                          value &&
                          day !== null &&
                          value ===
                            `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => selectDay(day)}
                            disabled={!day}
                            className={`
                            w-8 h-8 text-[11px] font-mono transition-colors
                            ${!day ? "invisible" : ""}
                          `}
                            style={{
                              ...(selected ?
                                {
                                  background: "rgba(242,209,109,0.2)",
                                  color: "#f2d16d",
                                  border: "1px solid #f2d16d",
                                }
                              : isToday ?
                                {
                                  background: "rgba(236,232,223,0.05)",
                                  color: "#ece8df",
                                  border: "1px solid rgba(236,232,223,0.2)",
                                }
                              : {
                                  color: "rgba(236,232,223,0.5)",
                                  border: "1px solid transparent",
                                }),
                            }}
                            onMouseEnter={(e) => {
                              if (!selected && day) {
                                e.currentTarget.style.background =
                                  "rgba(242,209,109,0.1)";
                                e.currentTarget.style.color = "#ece8df";
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (!selected && day) {
                                e.currentTarget.style.background =
                                  isToday ?
                                    "rgba(236,232,223,0.05)"
                                  : "transparent";
                                e.currentTarget.style.color =
                                  isToday ? "#ece8df" : "rgba(236,232,223,0.5)";
                              }
                            }}
                          >
                            {day ?? ""}
                          </button>
                        );
                      }),
                    )}
                  </div>
                </>
              }
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
