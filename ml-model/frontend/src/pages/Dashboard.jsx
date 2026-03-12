import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  Brain,
  Building2,
  CalendarRange,
  CheckCircle2,
  CloudRain,
  Eye,
  Globe2,
  Layers,
  Map as MapIcon,
  Radar,
  Route,
  Satellite,
  ShieldAlert,
  Sparkles,
  Users,
  Waves,
} from "lucide-react";
import PageHeader from "../components/common/PageHeader.jsx";
import { useAppStore } from "../stores/appStore.js";

const REGIONS = [
  {
    id: "larkana",
    name: "Larkana Basin",
    status: "Critical",
    riskScore: 91,
    population: "42.5K",
    floodArea: "18.4 km2",
    infra: 14,
    confidence: "94%",
    rainfall: "176 mm / 24h",
    window: "Next 12-18 hours",
    summary:
      "Multiple flood indicators are aligning: heavy rainfall, saturated soil, and recent SAR signatures near populated wards.",
    actions: [
      "Launch SAR detection for the latest imagery window",
      "Review lifeline routes before evacuation planning",
      "Notify district operations of likely road interruptions",
    ],
  },
  {
    id: "south",
    name: "South Delta Corridor",
    status: "Warning",
    riskScore: 72,
    population: "27.1K",
    floodArea: "9.6 km2",
    infra: 8,
    confidence: "88%",
    rainfall: "118 mm / 24h",
    window: "Next 24-36 hours",
    summary:
      "Flood probability is elevated along transport and low-lying urban edges, but evacuation urgency remains moderate for now.",
    actions: [
      "Compare 14-day forecast trend against current detections",
      "Inspect vulnerable schools and clinics in the corridor",
      "Prepare public alert copy for rapid escalation",
    ],
  },
  {
    id: "coastal",
    name: "Coastal Highway Belt",
    status: "Watch",
    riskScore: 48,
    population: "13.8K",
    floodArea: "4.1 km2",
    infra: 5,
    confidence: "79%",
    rainfall: "62 mm / 24h",
    window: "Next 48 hours",
    summary:
      "Localized surface water is possible near transport links, but current signals suggest monitoring rather than immediate response.",
    actions: [
      "Keep infrastructure layer active for road condition checks",
      "Monitor incoming rainfall and tidal exposure changes",
      "Hold response teams on standby without deployment",
    ],
  },
];

const WORKFLOW = [
  {
    id: "detect",
    title: "Detect Flood Extent",
    desc: "Run SAR image analysis to confirm active water spread and identify flood zones.",
    icon: Satellite,
    tab: "detection",
  },
  {
    id: "forecast",
    title: "Forecast Escalation",
    desc: "Review the 14-day probability curve and the meteorological drivers behind it.",
    icon: CloudRain,
    tab: "forecast",
  },
  {
    id: "insights",
    title: "Share Intelligence",
    desc: "Translate the signal into a plain-language operational brief for responders.",
    icon: Brain,
    tab: "insights",
  },
];

const MODULES = [
  {
    title: "Live Detection",
    desc: "SAR-based flood identification from fresh satellite passes.",
    stat: "3 active sensors",
    icon: Radar,
    tab: "detection",
    accent: "from-blue-500 to-cyan-400",
  },
  {
    title: "Trajectory Forecast",
    desc: "14-day risk outlook built from rainfall, terrain, and exposure features.",
    stat: "Peak on day 6",
    icon: Waves,
    tab: "forecast",
    accent: "from-amber-500 to-orange-400",
  },
  {
    title: "Operational Insights",
    desc: "AI summaries and decision support for government and response teams.",
    stat: "2 briefing templates",
    icon: Sparkles,
    tab: "insights",
    accent: "from-emerald-500 to-lime-400",
  },
];

const LAYERS = [
  { label: "Flood extent", active: true, tone: "bg-red-50 text-red-600 border-red-100" },
  { label: "Population exposure", active: true, tone: "bg-violet-50 text-violet-600 border-violet-100" },
  { label: "Lifeline routes", active: true, tone: "bg-sky-50 text-sky-600 border-sky-100" },
  { label: "Critical buildings", active: false, tone: "bg-slate-50 text-slate-600 border-slate-200" },
];

const FEED = [
  { time: "08:12", label: "Sentinel-1 pass ingested", kind: "ok" },
  { time: "08:34", label: "Rainfall anomaly rose 14% in Larkana Basin", kind: "warn" },
  { time: "09:05", label: "3 routes flagged as likely disrupted", kind: "critical" },
  { time: "09:18", label: "Forecast confidence updated to 94%", kind: "ok" },
];

function getRiskTone(score) {
  if (score >= 85) {
    return {
      badge: "bg-red-500 text-white",
      text: "text-red-600",
      soft: "bg-red-50 border-red-100",
      bar: "bg-red-500",
    };
  }
  if (score >= 60) {
    return {
      badge: "bg-orange-500 text-white",
      text: "text-orange-600",
      soft: "bg-orange-50 border-orange-100",
      bar: "bg-orange-500",
    };
  }
  return {
    badge: "bg-emerald-500 text-white",
    text: "text-emerald-600",
    soft: "bg-emerald-50 border-emerald-100",
    bar: "bg-emerald-500",
  };
}

export default function Dashboard() {
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const [selectedRegionId, setSelectedRegionId] = useState(REGIONS[0].id);

  const region = useMemo(
    () => REGIONS.find((item) => item.id === selectedRegionId) ?? REGIONS[0],
    [selectedRegionId],
  );
  const tone = getRiskTone(region.riskScore);

  return (
    <div className="min-h-screen bg-gray-50 pt-14 font-sans text-gray-900 selection:bg-green-100 selection:text-green-900">
      <PageHeader
        title="Disaternet Operations Dashboard"
        subtitle="A single command view for detection, forecasting, exposure tracking, and response planning."
        icon={Globe2}
      >
        <button
          onClick={() => setActiveTab("detection")}
          className="rounded-full bg-green-500 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-green-500/20 transition-colors hover:bg-green-600"
        >
          Start New Scan
        </button>
        <button
          onClick={() => setActiveTab("forecast")}
          className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 transition-colors hover:border-green-200 hover:text-green-600"
        >
          Open Forecast
        </button>
      </PageHeader>

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-6">
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="overflow-hidden rounded-[28px] border border-gray-200 bg-[linear-gradient(135deg,#0f172a_0%,#10231c_45%,#f8fafc_150%)] shadow-[0_24px_80px_rgba(15,23,42,0.18)]"
        >
          <div className="grid gap-0 lg:grid-cols-[1.4fr_0.9fr]">
            <div className="p-8 text-white sm:p-10">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-emerald-200">
                <ShieldAlert className="h-3.5 w-3.5" />
                Active Risk Region
              </div>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="max-w-2xl">
                  <h2 className="text-3xl font-black tracking-tight sm:text-4xl">{region.name}</h2>
                  <p className="mt-3 max-w-xl text-sm leading-7 text-slate-200 sm:text-base">
                    {region.summary}
                  </p>
                </div>
                <div className="rounded-3xl border border-white/10 bg-white/10 px-5 py-4 backdrop-blur">
                  <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-emerald-200">
                    Response Window
                  </div>
                  <div className="mt-2 text-xl font-black">{region.window}</div>
                </div>
              </div>

              <div className="mt-8 grid gap-4 sm:grid-cols-4">
                {[
                  { label: "Risk score", value: region.riskScore, icon: AlertTriangle },
                  { label: "Population exposed", value: region.population, icon: Users },
                  { label: "Flooded area", value: region.floodArea, icon: MapIcon },
                  { label: "Confidence", value: region.confidence, icon: CheckCircle2 },
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
                    <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-300">
                      <item.icon className="h-3.5 w-3.5 text-emerald-300" />
                      {item.label}
                    </div>
                    <div className="mt-3 text-2xl font-black">{item.value}</div>
                  </div>
                ))}
              </div>

              <div className="mt-8 flex flex-wrap gap-3">
                <button
                  onClick={() => setActiveTab("detection")}
                  className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-bold text-slate-900 transition-transform hover:-translate-y-0.5"
                >
                  Inspect Detection
                  <ArrowRight className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setActiveTab("insights")}
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-5 py-3 text-sm font-bold text-white backdrop-blur transition-colors hover:bg-white/15"
                >
                  Generate Brief
                  <Sparkles className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="border-t border-white/10 bg-white/80 p-6 backdrop-blur lg:border-t-0 lg:border-l">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-gray-500">
                    Guided Workflow
                  </p>
                  <h3 className="mt-2 text-xl font-black text-gray-900">What should the user do next?</h3>
                </div>
                <div className="rounded-2xl bg-green-50 p-3 text-green-600">
                  <Route className="h-5 w-5" />
                </div>
              </div>

              <div className="mt-6 space-y-4">
                {WORKFLOW.map((step, index) => (
                  <button
                    key={step.id}
                    onClick={() => setActiveTab(step.tab)}
                    className="group flex w-full items-start gap-4 rounded-2xl border border-gray-100 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-green-200 hover:shadow-lg hover:shadow-green-100/60"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gray-900 text-white">
                      <step.icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-gray-400">
                          Step {index + 1}
                        </span>
                      </div>
                      <h4 className="mt-1 text-sm font-bold text-gray-900">{step.title}</h4>
                      <p className="mt-1 text-sm leading-6 text-gray-600">{step.desc}</p>
                    </div>
                    <ArrowRight className="mt-1 h-4 w-4 text-gray-300 transition-transform group-hover:translate-x-1 group-hover:text-green-600" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </motion.section>

        <section className="grid gap-6 xl:grid-cols-[1.35fr_0.95fr]">
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                {
                  label: "Alert status",
                  value: region.status,
                  meta: "Updated 6 mins ago",
                  icon: Bell,
                  toneClass: tone.badge,
                },
                {
                  label: "Rainfall load",
                  value: region.rainfall,
                  meta: "Accumulated in selected basin",
                  icon: CloudRain,
                  toneClass: "bg-sky-500 text-white",
                },
                {
                  label: "Impacted infrastructure",
                  value: `${region.infra}`,
                  meta: "Roads, utilities, and public sites",
                  icon: Building2,
                  toneClass: "bg-amber-500 text-white",
                },
                {
                  label: "Next forecast checkpoint",
                  value: "14:30",
                  meta: "Model refresh with latest drivers",
                  icon: CalendarRange,
                  toneClass: "bg-emerald-500 text-white",
                },
              ].map((item) => (
                <div key={item.label} className="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">{item.label}</p>
                    <div className={`rounded-xl p-2 ${item.toneClass}`}>
                      <item.icon className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-5 text-2xl font-black tracking-tight text-gray-900">{item.value}</div>
                  <p className="mt-2 text-sm leading-6 text-gray-500">{item.meta}</p>
                </div>
              ))}
            </div>

            <div className="overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm">
              <div className="flex flex-col gap-4 border-b border-gray-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-lg font-black text-gray-900">Situation Overview</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    A visual summary of flood spread, exposed communities, and route pressure.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {LAYERS.map((layer) => (
                    <span
                      key={layer.label}
                      className={`rounded-full border px-3 py-1 text-xs font-bold ${layer.active ? layer.tone : "border-gray-200 bg-white text-gray-400"}`}
                    >
                      {layer.label}
                    </span>
                  ))}
                </div>
              </div>

              <div className="grid gap-0 lg:grid-cols-[1.15fr_0.85fr]">
                <div className="relative min-h-[360px] overflow-hidden bg-[radial-gradient(circle_at_top_left,#e2fbe8_0%,#f8fafc_38%,#eef2ff_100%)] p-6">
                  <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(15,23,42,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.06)_1px,transparent_1px)] [background-size:30px_30px]" />
                  <div className="absolute left-[8%] top-[16%] h-52 w-72 rounded-[42%] border border-red-200 bg-red-400/25 blur-[2px]" />
                  <div className="absolute left-[18%] top-[28%] h-36 w-52 rounded-[48%] border border-red-300 bg-red-500/40" />
                  <div className="absolute left-[52%] top-[18%] h-24 w-24 rounded-full border-8 border-emerald-300/40" />
                  <div className="absolute left-[52%] top-[18%] h-24 w-24 animate-ping rounded-full border border-emerald-500/20" />
                  <div className="absolute left-[58%] top-[25%] h-3 w-3 rounded-full bg-emerald-500 shadow-[0_0_18px_rgba(16,185,129,0.8)]" />

                  <svg viewBox="0 0 600 360" className="relative z-10 h-full w-full">
                    <path
                      d="M70 285 C150 250, 180 220, 242 205 S355 168, 410 132 S520 84, 560 62"
                      fill="none"
                      stroke="#0ea5e9"
                      strokeDasharray="8 7"
                      strokeWidth="6"
                      strokeLinecap="round"
                    />
                    <path
                      d="M66 308 C148 274, 221 256, 286 244 S401 222, 494 194"
                      fill="none"
                      stroke="#475569"
                      strokeDasharray="3 8"
                      strokeWidth="4"
                      strokeLinecap="round"
                    />
                    <circle cx="208" cy="208" r="10" fill="#ef4444" />
                    <circle cx="308" cy="170" r="8" fill="#f97316" />
                    <circle cx="472" cy="108" r="8" fill="#0ea5e9" />
                    <circle cx="520" cy="84" r="9" fill="#22c55e" />
                  </svg>

                  <div className="absolute bottom-5 left-5 rounded-2xl border border-white/60 bg-white/80 p-4 shadow-lg backdrop-blur">
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">Focus region</div>
                    <div className="mt-2 text-lg font-black text-gray-900">{region.name}</div>
                    <div className="mt-2 flex items-center gap-3 text-sm text-gray-600">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${tone.badge}`}>
                        {region.status}
                      </span>
                      <span className="font-medium">Risk score {region.riskScore}</span>
                    </div>
                  </div>
                </div>

                <div className="border-t border-gray-100 p-6 lg:border-t-0 lg:border-l">
                  <div className="rounded-3xl border border-gray-100 bg-gray-50 p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">Explain this view</p>
                        <h4 className="mt-2 text-lg font-black text-gray-900">How to read the dashboard</h4>
                      </div>
                      <Eye className="h-5 w-5 text-green-500" />
                    </div>
                    <ul className="mt-4 space-y-3 text-sm leading-6 text-gray-600">
                      <li>Red zones show the current or expected flood footprint.</li>
                      <li>Blue lines highlight lifeline routes that matter for access planning.</li>
                      <li>Green pulse marks the highest-priority operational focus point.</li>
                    </ul>
                  </div>

                  <div className="mt-5 space-y-3">
                    {region.actions.map((action) => (
                      <div
                        key={action}
                        className="flex items-start gap-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm"
                      >
                        <div className="mt-0.5 rounded-xl bg-green-50 p-2 text-green-600">
                          <CheckCircle2 className="h-4 w-4" />
                        </div>
                        <p className="text-sm leading-6 text-gray-700">{action}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              {MODULES.map((module) => (
                <button
                  key={module.title}
                  onClick={() => setActiveTab(module.tab)}
                  className="group overflow-hidden rounded-3xl border border-gray-100 bg-white text-left shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-green-100/70"
                >
                  <div className={`h-2 w-full bg-gradient-to-r ${module.accent}`} />
                  <div className="p-6">
                    <div className="flex items-center justify-between">
                      <div className="rounded-2xl bg-gray-900 p-3 text-white">
                        <module.icon className="h-5 w-5" />
                      </div>
                      <ArrowRight className="h-4 w-4 text-gray-300 transition-transform group-hover:translate-x-1 group-hover:text-green-600" />
                    </div>
                    <h3 className="mt-5 text-xl font-black text-gray-900">{module.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-gray-600">{module.desc}</p>
                    <div className="mt-5 inline-flex rounded-full bg-gray-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-gray-500">
                      {module.stat}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">Region selector</p>
                  <h3 className="mt-2 text-lg font-black text-gray-900">Prioritize an operating area</h3>
                </div>
                <div className={`rounded-full px-3 py-1 text-[11px] font-bold uppercase ${tone.badge}`}>
                  {region.status}
                </div>
              </div>
              <div className="mt-5 space-y-3">
                {REGIONS.map((item) => {
                  const itemTone = getRiskTone(item.riskScore);
                  const isSelected = item.id === selectedRegionId;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setSelectedRegionId(item.id)}
                      className={`w-full rounded-2xl border p-4 text-left transition-all ${isSelected ? `${itemTone.soft} shadow-md` : "border-gray-100 hover:border-green-200 hover:bg-green-50/40"}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-black text-gray-900">{item.name}</div>
                          <div className="mt-1 text-sm text-gray-500">{item.window}</div>
                        </div>
                        <div className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase ${itemTone.badge}`}>
                          {item.status}
                        </div>
                      </div>
                      <div className="mt-4">
                        <div className="mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-[0.14em] text-gray-400">
                          <span>Risk score</span>
                          <span className={itemTone.text}>{item.riskScore}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                          <div className={`h-full rounded-full ${itemTone.bar}`} style={{ width: `${item.riskScore}%` }} />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">Live operations feed</p>
                  <h3 className="mt-2 text-lg font-black text-gray-900">Recent system events</h3>
                </div>
                <div className="rounded-2xl bg-gray-50 p-3">
                  <Activity className="h-5 w-5 text-green-500" />
                </div>
              </div>
              <div className="mt-6 space-y-4">
                {FEED.map((item) => (
                  <div key={`${item.time}-${item.label}`} className="flex gap-3">
                    <div className="mt-1 flex flex-col items-center">
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${
                          item.kind === "critical"
                            ? "bg-red-500"
                            : item.kind === "warn"
                              ? "bg-orange-500"
                              : "bg-green-500"
                        }`}
                      />
                      <span className="mt-2 h-full w-px bg-gray-100" />
                    </div>
                    <div className="pb-4">
                      <div className="text-xs font-bold uppercase tracking-[0.18em] text-gray-400">{item.time}</div>
                      <div className="mt-1 text-sm leading-6 text-gray-700">{item.label}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">Project modules</p>
                  <h3 className="mt-2 text-lg font-black text-gray-900">What each area is for</h3>
                </div>
                <Layers className="h-5 w-5 text-green-500" />
              </div>
              <div className="mt-5 space-y-3">
                {[
                  { name: "Dashboard", desc: "Overview of threats, exposure, and next steps.", icon: Globe2 },
                  { name: "Detection", desc: "Confirm flood extent from satellite imagery.", icon: Satellite },
                  { name: "Forecast", desc: "Estimate how risk evolves over the next 14 days.", icon: CloudRain },
                  { name: "Insights", desc: "Turn technical outputs into decision-ready summaries.", icon: Brain },
                ].map((item) => (
                  <div key={item.name} className="flex items-start gap-3 rounded-2xl border border-gray-100 bg-gray-50 p-4">
                    <div className="rounded-xl bg-white p-2 shadow-sm">
                      <item.icon className="h-4 w-4 text-green-600" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-gray-900">{item.name}</div>
                      <div className="mt-1 text-sm leading-6 text-gray-600">{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
