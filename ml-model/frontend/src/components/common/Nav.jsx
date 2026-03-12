import React, { useState, useRef, useEffect } from "react";
import { useAppStore } from "../../stores/appStore.js";
import { useAuth } from "../../hooks/useAuth.js";
import { Layers } from "lucide-react";

const TABS = [
  { id: "landing", label: "Briefing", icon: "◉", emoji: "⬛" },
  { id: "globe", label: "Dashboard", icon: "⊕", emoji: "🌍" },
  { id: "detection", label: "Detection", icon: "◉", emoji: "🛰️" },
  { id: "forecast", label: "Forecast", icon: "◈", emoji: "📈" },
  { id: "insights", label: "Insights", icon: "◈", emoji: "📊" },
];

const SUBSCRIPTION_TIERS = {
  free: {
    label: "Observer",
    color: "#ece8df",
    lightColor: "#6b7280",
    border: "rgba(236,232,223,0.2)",
    lightBorder: "rgba(107,114,128,0.2)",
  },
  plus: {
    label: "Analyst",
    color: "#f2d16d",
    lightColor: "#22c55e",
    border: "rgba(242,209,109,0.4)",
    lightBorder: "rgba(34,197,94,0.4)",
  },
  pro: {
    label: "Sovereign",
    color: "#c0392b",
    lightColor: "#ef4444",
    border: "rgba(192,57,43,0.4)",
    lightBorder: "rgba(239,68,68,0.4)",
  },
  enterprise: {
    label: "Sovereign",
    color: "#c0392b",
    lightColor: "#ef4444",
    border: "rgba(192,57,43,0.4)",
    lightBorder: "rgba(239,68,68,0.4)",
  },
};
const defaultTier = SUBSCRIPTION_TIERS.free;

function TierBadge({ level, isLight }) {
  const tier = SUBSCRIPTION_TIERS[level] ?? defaultTier;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 tracking-widest uppercase rounded"
      style={{
        fontSize: "0.55rem",
        fontWeight: "bold",
        fontFamily: "monospace",
        color: isLight ? tier.lightColor : tier.color,
        border: `1px solid ${isLight ? tier.lightBorder : tier.border}`,
        backgroundColor: isLight ? 'rgba(0,0,0,0.02)' : 'transparent'
      }}
    >
      {tier.label}
    </span>
  );
}

export default function Nav() {
  const { activeTab, setActiveTab } = useAppStore();
  const { user, isAuthenticated, logout } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target))
        setProfileOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const tier = user?.subscription_level ?? "free";
  
  // Force light theme globally for the new application redesign
  const isLightTheme = true;

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 h-14 flex items-center px-4 sm:px-6 transition-colors duration-300 ${isLightTheme ? 'bg-white border-b border-gray-100 shadow-sm' : ''}`}
      style={!isLightTheme ? {
        background: "#060504",
        borderBottom: "1px solid rgba(242,209,109,0.15)",
      } : {}}
    >
      {/* Brand */}
      <div
        className="flex items-center gap-2 mr-6 sm:mr-10 cursor-pointer group"
        onClick={() => setActiveTab("landing")}
      >
        {isLightTheme ? (
           <>
             <div className="w-8 h-8 rounded-lg bg-green-500 flex items-center justify-center transition-transform group-hover:scale-105 shadow-md shadow-green-500/20">
               <Layers className="text-white w-4 h-4" />
             </div>
             <span className="brand-wordmark text-gray-900">Disaternet</span>
           </>
        ) : (
          <div>
            <div
              className="font-display font-light tracking-[0.25em] leading-none"
              style={{ color: "#ece8df", fontSize: "1.05rem" }}
            >
              DISATERNET
            </div>
            <div
              className="mt-1 tracking-[0.3em] uppercase"
              style={{
                fontSize: "0.45rem",
                color: "#f2d16d",
                fontFamily: "monospace",
              }}
            >
              Intelligence Platform
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 sm:gap-2 flex-1 pt-1">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          
          if (isLightTheme) {
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative px-4 py-2 font-semibold text-sm transition-colors ${isActive ? 'text-green-600' : 'text-gray-500 hover:text-gray-900'}`}
              >
                {tab.label}
                {isActive && (
                  <span className="absolute bottom-[-10px] left-0 right-0 h-0.5 bg-green-500 rounded-t-full" />
                )}
              </button>
            )
          }

          // Dark theme tabs
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="relative px-3 sm:px-4 py-2 flex items-center gap-2 transition-colors duration-300"
              style={{
                color: isActive ? "#f2d16d" : "rgba(236,232,223,0.4)",
              }}
            >
              <span className="md:hidden text-xs leading-none">
                {tab.emoji}
              </span>
              <span
                className="hidden md:inline font-light tracking-[0.2em] uppercase hover:text-[#ece8df] transition-colors"
                style={{
                  fontSize: "0.6rem",
                  fontFamily: "monospace",
                  color: "inherit",
                }}
              >
                {tab.label}
              </span>
              {isActive && (
                <span
                  className="absolute bottom-0 left-0 w-full h-[1px]"
                  style={{ background: "#c0392b" }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Right */}
      <div className="flex items-center gap-3 sm:gap-5">
        {isAuthenticated ?
          <div ref={profileRef} className="relative flex items-center gap-3">
            <div className="hidden sm:block">
              <TierBadge level={tier} isLight={isLightTheme} />
            </div>
            <button
              onClick={() => setProfileOpen((o) => !o)}
              className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm transition-colors ${
                isLightTheme 
                  ? profileOpen ? 'bg-green-100 text-green-700 pointer-events-none' : 'bg-gray-100 text-gray-700 hover:bg-gray-200 cursor-pointer'
                  : profileOpen ? 'border pointer-events-none' : 'border cursor-pointer'
              }`}
              style={!isLightTheme ? {
                background:
                  profileOpen ?
                    "rgba(242,209,109,0.2)"
                  : "rgba(242,209,109,0.1)",
                border: "1px solid rgba(242,209,109,0.3)",
                color: "#f2d16d"
              } : {}}
            >
              {(user?.email ?? "?").charAt(0).toUpperCase()}
            </button>

            {profileOpen && (
              <div
                className={`absolute right-0 top-full mt-3 w-56 py-2 shadow-xl rounded-xl border ${isLightTheme ? 'bg-white border-gray-100' : ''}`}
                style={!isLightTheme ? {
                  background: "#0a0907",
                  border: "1px solid rgba(242,209,109,0.2)",
                  borderRadius: "0",
                } : {}}
              >
                <div
                  className={`px-4 py-3 border-b ${isLightTheme ? 'border-gray-100' : ''}`}
                  style={!isLightTheme ? { borderColor: "rgba(236,232,223,0.1)" } : {}}
                >
                  <p
                    className={`font-semibold truncate ${isLightTheme ? 'text-gray-900 text-sm' : 'font-light'}`}
                    style={!isLightTheme ? { fontSize: "0.75rem", color: "#ece8df" } : {}}
                  >
                    {user?.email}
                  </p>
                  <p
                    className={`mt-1 tracking-widest uppercase ${isLightTheme ? 'text-[10px] text-gray-400 font-bold' : ''}`}
                    style={!isLightTheme ? {
                      fontSize: "0.5rem",
                      color: "rgba(236,232,223,0.5)",
                      fontFamily: "monospace",
                    } : {}}
                  >
                    ID: {user?.id?.slice(0, 8) || "UNKNOWN"}
                  </p>
                </div>
                <button
                  onClick={async () => {
                    await logout();
                    setProfileOpen(false);
                    // Force navigation back to landing page to clear UI state
                    setActiveTab("landing");
                  }}
                  className={`w-full text-left px-4 py-3 tracking-widest uppercase transition-colors ${isLightTheme ? 'text-xs font-bold text-red-500 hover:bg-red-50' : 'hover:bg-white/5'}`}
                  style={!isLightTheme ? {
                    fontSize: "0.6rem",
                    color: "#c0392b",
                    fontFamily: "monospace",
                  } : {}}
                >
                  {isLightTheme ? 'Sign Out' : 'DISAVOW (Sign Out)'}
                </button>
              </div>
            )}
          </div>
        : <button
            onClick={() => setActiveTab("login")}
            className={isLightTheme ? "bg-gray-100 hover:bg-gray-200 text-gray-900 px-4 py-1.5 rounded-full text-xs font-bold transition-colors" : "relative group overflow-hidden"}
            style={!isLightTheme ? { padding: "0.4rem 1.25rem" } : {}}
          >
            {!isLightTheme && (
              <>
                <span
                  className="absolute inset-0"
                  style={{ border: "1px solid rgba(242,209,109,0.4)" }}
                />
                <span
                  className="absolute inset-0 translate-x-full group-hover:translate-x-0 transition-transform duration-300"
                  style={{ background: "#f2d16d" }}
                />
              </>
            )}
            <span
              className={isLightTheme ? "" : "relative z-10 tracking-[0.2em] uppercase transition-colors text-[#f2d16d] group-hover:text-black"}
              style={!isLightTheme ? {
                fontSize: "0.6rem",
                fontFamily: "monospace",
              } : {}}
            >
              {isLightTheme ? 'Sign In' : 'Authenticate'}
            </span>
          </button>
        }
      </div>
    </nav>
  );
}
