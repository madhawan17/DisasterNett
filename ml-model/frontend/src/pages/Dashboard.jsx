import React, { useEffect, useMemo, useState } from "react";
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
import { useInsightsStore } from "../stores/insightsStore.js";
import { useForecastStore } from "../stores/forecastStore.js";
import { useRiskStore } from "../stores/riskStore.js";
import { useLifelineStore } from "../stores/lifelineStore.js";

const DEFAULT_FORECAST_BBOX = [72.65, 18.85, 73.25, 19.45];

const ALERT_SCORE = {
  LOW: 25,
  MODERATE: 52,
  MEDIUM: 52,
  HIGH: 74,
  WARNING: 74,
  CRITICAL: 92,
};

const STATUS_LABEL = {
  LOW: "Watch",
  MODERATE: "Elevated",
  MEDIUM: "Elevated",
  HIGH: "Warning",
  WARNING: "Warning",
  CRITICAL: "Critical",
};

function buildBboxAroundPoint(lat, lon, delta = 0.3) {
  return [lon - delta, lat - delta, lon + delta, lat + delta];
}

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

function formatCompact(value) {
  if (value == null || Number.isNaN(Number(value))) return "N/A";
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value));
}

function formatNumber(value, digits = 0) {
  if (value == null || Number.isNaN(Number(value))) return "N/A";
  return Number(value).toLocaleString("en", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatPercent(value, digits = 0) {
  if (value == null || Number.isNaN(Number(value))) return "N/A";
  return `${Number(value).toFixed(digits)}%`;
}

function formatDateTime(value) {
  if (!value) return "No timestamp";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatRuntime(seconds) {
  if (seconds == null || Number.isNaN(Number(seconds))) return "N/A";
  const totalSeconds = Math.round(Number(seconds));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}m ${secs}s`;
}

function toSentenceCase(value) {
  if (!value) return "Unknown";
  const normalized = String(value).replace(/_/g, " ").toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function deriveRiskScore(status, fallback = 0) {
  if (fallback) return Math.round(fallback);
  return ALERT_SCORE[String(status).toUpperCase()] ?? 0;
}

function summarizeRegion(region, latestRun, lifelineData) {
  if (!region) {
    return "Run a forecast, risk analysis, or SAR detection to turn this board into a live command view.";
  }

  const parts = [];

  if (region.forecastProb != null) {
    parts.push(
      `${region.name} is carrying a forecast peak probability of ${formatPercent(region.forecastProb * 100, 1)}${region.peakDate ? ` around ${region.peakDate}` : ""}.`,
    );
  }

  if (region.population != null) {
    parts.push(`${formatCompact(region.population)} people sit inside the current risk envelope.`);
  } else if (latestRun?.population_exposed != null) {
    parts.push(`${formatCompact(latestRun.population_exposed)} people were exposed in the latest SAR-confirmed run.`);
  }

  if (region.factors?.length) {
    parts.push(`Primary drivers include ${region.factors.slice(0, 2).join(" and ")}.`);
  } else if (latestRun?.flood_area_km2 != null) {
    parts.push(
      `The latest completed detection mapped ${formatNumber(latestRun.flood_area_km2, 1)} km2 of flooded area across ${formatNumber(latestRun.zones_count)} zones.`,
    );
  }

  if (lifelineData?.total_features) {
    parts.push(`${formatNumber(lifelineData.total_features)} infrastructure features are in the latest scan footprint.`);
  }

  return parts.join(" ");
}

function buildActions(region, latestRun, lifelineData) {
  const actions = [];

  if (region?.forecastProb != null) {
    actions.push(
      `Validate ${region.name}'s ${formatPercent(region.forecastProb * 100, 1)} forecast peak against district-level timing.`,
    );
  }

  if (latestRun?.zones_count != null) {
    actions.push(
      `Review the latest SAR run for ${latestRun.location} with ${formatNumber(latestRun.zones_count)} detected flood zones.`,
    );
  }

  if (lifelineData?.summary?.hospital != null || lifelineData?.summary?.building != null) {
    actions.push(
      `Check the newest infrastructure scan covering ${formatNumber(lifelineData.summary?.hospital ?? 0)} hospitals and ${formatNumber(lifelineData.summary?.building ?? 0)} buildings.`,
    );
  }

  if (actions.length === 0) {
    actions.push("Open forecast to generate district rankings.");
    actions.push("Run globe analysis to load risk and infrastructure overlays.");
    actions.push("Trigger SAR detection to populate flood extent and recent activity.");
  }

  return actions.slice(0, 3);
}

function buildFeedItem(run) {
  const time = formatDateTime(run.created_at);
  if (run.status === "completed") {
    return {
      time,
      kind: "ok",
      label: `${run.location}: ${formatNumber(run.flood_area_km2, 1)} km2 flooded across ${formatNumber(run.zones_count)} zones.`,
    };
  }
  if (run.status === "failed") {
    return {
      time,
      kind: "critical",
      label: `${run.location}: run failed${run.error ? ` (${run.error})` : ""}.`,
    };
  }
  return {
    time,
    kind: "warn",
    label: `${run.location}: ${toSentenceCase(run.status)} at ${run.processing_time_s ? formatRuntime(run.processing_time_s) : "in progress"}.`,
  };
}

function compactClassificationTone(classification) {
  const value = String(classification ?? "").toUpperCase();
  if (value === "CRITICAL") return "bg-red-500 text-white";
  if (value === "HIGH") return "bg-orange-500 text-white";
  if (value === "MODERATE" || value === "MEDIUM") return "bg-amber-500 text-white";
  return "bg-emerald-500 text-white";
}

export default function Dashboard() {
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const runs = useInsightsStore((s) => s.runs);
  const runsLoading = useInsightsStore((s) => s.runsLoading);
  const runsError = useInsightsStore((s) => s.runsError);
  const fetchRuns = useInsightsStore((s) => s.fetchRuns);
  const selectedRunId = useInsightsStore((s) => s.selectedRunId);
  const selectedRun = useInsightsStore((s) => s.selectedRun);
  const detailLoading = useInsightsStore((s) => s.detailLoading);
  const selectRun = useInsightsStore((s) => s.selectRun);
  const districts = useForecastStore((s) => s.districts);
  const bbox = useForecastStore((s) => s.bbox);
  const forecastLoading = useForecastStore((s) => s.isLoading);
  const forecastError = useForecastStore((s) => s.error);
  const fetchDistrictForecasts = useForecastStore((s) => s.fetchDistrictForecasts);
  const districtSummaries = useRiskStore((s) => s.districtSummaries);
  const globalMetrics = useRiskStore((s) => s.globalMetrics);
  const riskLoading = useRiskStore((s) => s.isLoading);
  const riskError = useRiskStore((s) => s.error);
  const lifelineData = useLifelineStore((s) => s.data);
  const lifelineError = useLifelineStore((s) => s.error);
  const [selectedRegionId, setSelectedRegionId] = useState(null);
  const [hasBootstrappedForecast, setHasBootstrappedForecast] = useState(false);

  useEffect(() => {
    if (!runs.length && !runsLoading) {
      fetchRuns();
    }
  }, [fetchRuns, runs.length, runsLoading]);

  const latestCompletedRun = useMemo(
    () => runs.find((run) => run.status === "completed") ?? null,
    [runs],
  );

  useEffect(() => {
    if (latestCompletedRun?.id && selectedRunId !== latestCompletedRun.id && !detailLoading) {
      selectRun(latestCompletedRun.id);
    }
  }, [detailLoading, latestCompletedRun?.id, selectRun, selectedRunId]);

  useEffect(() => {
    if (hasBootstrappedForecast || districts.length || forecastLoading || bbox) return;

    const sourceRun = runs.find((run) => run.lat != null && run.lon != null);
    const nextBbox = sourceRun
      ? buildBboxAroundPoint(Number(sourceRun.lat), Number(sourceRun.lon))
      : DEFAULT_FORECAST_BBOX;

    setHasBootstrappedForecast(true);
    fetchDistrictForecasts(nextBbox, 14, 6);
  }, [bbox, districts.length, fetchDistrictForecasts, forecastLoading, hasBootstrappedForecast, runs]);

  const topRiskRegions = useMemo(() => {
    const merged = new Map();

    districts.forEach((district) => {
      const key = district.name.toLowerCase();
      const riskScore = deriveRiskScore(
        district.overall_alert_level,
        (district.overall_max_prob ?? 0) * 100,
      );
      const existing = merged.get(key) ?? {
        id: `region-${key}`,
        name: district.name,
        status: STATUS_LABEL[district.overall_alert_level] ?? toSentenceCase(district.overall_alert_level),
        riskScore,
        forecastProb: district.overall_max_prob,
        peakDay: district.peak_day,
        peakDate: district.peak_date,
        sources: [],
      };

      merged.set(key, {
        ...existing,
        status: STATUS_LABEL[district.overall_alert_level] ?? existing.status,
        riskScore: Math.max(existing.riskScore ?? 0, riskScore),
        forecastProb: district.overall_max_prob,
        peakDay: district.peak_day,
        peakDate: district.peak_date,
        sources: [...new Set([...existing.sources, "forecast"])],
      });
    });

    districtSummaries.forEach((district) => {
      const key = String(district.district_name ?? "").toLowerCase();
      if (!key) return;

      const riskScore = deriveRiskScore(district.risk_classification, district.risk_score);
      const existing = merged.get(key) ?? {
        id: `region-${key}`,
        name: district.district_name,
        status: STATUS_LABEL[String(district.risk_classification).toUpperCase()] ?? toSentenceCase(district.risk_classification),
        riskScore,
        sources: [],
      };

      merged.set(key, {
        ...existing,
        status:
          STATUS_LABEL[String(district.risk_classification).toUpperCase()] ??
          existing.status,
        riskScore: Math.max(existing.riskScore ?? 0, riskScore),
        population: district.population,
        floodArea: district.area_km2,
        factors: district.contributing_factors ?? [],
        sources: [...new Set([...existing.sources, "risk"])],
      });
    });

    return [...merged.values()].sort((a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0));
  }, [districtSummaries, districts]);

  useEffect(() => {
    if (!topRiskRegions.length) {
      setSelectedRegionId(null);
      return;
    }

    if (!topRiskRegions.some((item) => item.id === selectedRegionId)) {
      setSelectedRegionId(topRiskRegions[0].id);
    }
  }, [selectedRegionId, topRiskRegions]);

  const region = useMemo(
    () => topRiskRegions.find((item) => item.id === selectedRegionId) ?? topRiskRegions[0] ?? null,
    [selectedRegionId, topRiskRegions],
  );

  const tone = getRiskTone(region?.riskScore ?? 0);
  const detectionRun = selectedRun?.status === "completed" ? selectedRun : latestCompletedRun;
  const workflow = useMemo(
    () => [
      {
        id: "detect",
        title: detectionRun ? `Inspect ${detectionRun.location}` : "Run SAR detection",
        desc: detectionRun
          ? `${formatNumber(detectionRun.zones_count)} flood zones and ${formatNumber(detectionRun.population_exposed)} exposed people in the latest completed run.`
          : "No completed SAR run loaded yet. Start a flood extent analysis to populate detection outputs.",
        icon: Satellite,
        tab: "detection",
      },
      {
        id: "forecast",
        title: region ? `Forecast ${region.name}` : "Generate district forecast",
        desc: region?.forecastProb != null
          ? `Current peak probability is ${formatPercent(region.forecastProb * 100, 1)}${region.peakDay ? ` with the strongest signal on day ${region.peakDay}` : ""}.`
          : "Use the forecast model to rank districts and surface the next escalation window.",
        icon: CloudRain,
        tab: "forecast",
      },
      {
        id: "insights",
        title: runs.length ? `Review ${runs.length} historical runs` : "Open operations history",
        desc: runs.length
          ? `Recent insights history is live${runsError ? ", but the latest refresh returned an error." : ""}`
          : "Historical insights runs will appear here once the backend has recorded analyses.",
        icon: Brain,
        tab: "insights",
      },
    ],
    [detectionRun, region, runs.length, runsError],
  );

  const moduleCards = useMemo(
    () => [
      {
        title: "Live Detection",
        desc: detectionRun
          ? `${formatNumber(detectionRun.flood_area_km2, 1)} km2 mapped in ${detectionRun.location}.`
          : "Awaiting a completed SAR run.",
        stat: detectionRun
          ? `${formatNumber(detectionRun.zones_count)} detected zones`
          : "No detection loaded",
        icon: Radar,
        tab: "detection",
        accent: "from-blue-500 to-cyan-400",
      },
      {
        title: "District Forecast",
        desc: region?.forecastProb != null
          ? `${region.name} currently leads district forecasts.`
          : "Forecast districts will appear once the model returns a ranked list.",
        stat: region?.forecastProb != null
          ? `${formatPercent(region.forecastProb * 100, 1)} peak risk`
          : "Forecast pending",
        icon: Waves,
        tab: "forecast",
        accent: "from-amber-500 to-orange-400",
      },
      {
        title: "Infrastructure Scan",
        desc: lifelineData
          ? `${formatNumber(lifelineData.total_features)} features in the latest infrastructure footprint.`
          : "Run a lifeline scan to surface hospitals, schools, and buildings.",
        stat: lifelineData
          ? `${formatNumber(lifelineData.summary?.hospital ?? 0)} hospitals`
          : "No infra scan loaded",
        icon: Building2,
        tab: "globe",
        accent: "from-emerald-500 to-lime-400",
      },
    ],
    [detectionRun, lifelineData, region],
  );

  const layers = useMemo(
    () => [
      {
        label: "Flood extent",
        active: Boolean(detectionRun?.patches?.length || detectionRun?.zones_count),
        tone: "bg-red-50 text-red-600 border-red-100",
      },
      {
        label: "District forecast",
        active: districts.length > 0,
        tone: "bg-sky-50 text-sky-600 border-sky-100",
      },
      {
        label: "Risk districts",
        active: districtSummaries.length > 0,
        tone: "bg-violet-50 text-violet-600 border-violet-100",
      },
      {
        label: "Infrastructure",
        active: Boolean(lifelineData),
        tone: "bg-emerald-50 text-emerald-600 border-emerald-100",
      },
    ],
    [detectionRun?.patches?.length, detectionRun?.zones_count, districts.length, districtSummaries.length, lifelineData],
  );

  const feed = useMemo(() => runs.slice(0, 6).map(buildFeedItem), [runs]);
  const dashboardErrors = [runsError, forecastError, riskError, lifelineError].filter(Boolean);

  return (
    <div className="min-h-screen bg-gray-50 pt-14 font-sans text-gray-900 selection:bg-green-100 selection:text-green-900">
      <PageHeader
        title="Disaternet Operations Dashboard"
        subtitle="A live command center for SAR detections, district forecasts, risk scoring, and infrastructure exposure."
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
        {!!dashboardErrors.length && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {dashboardErrors[0]}
          </div>
        )}

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
                  <h2 className="text-3xl font-black tracking-tight sm:text-4xl">
                    {region?.name ?? "Waiting for live region data"}
                  </h2>
                  <p className="mt-3 max-w-xl text-sm leading-7 text-slate-200 sm:text-base">
                    {summarizeRegion(region, detectionRun, lifelineData)}
                  </p>
                </div>
                <div className="rounded-3xl border border-white/10 bg-white/10 px-5 py-4 backdrop-blur">
                  <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-emerald-200">
                    Response Window
                  </div>
                  <div className="mt-2 text-xl font-black">
                    {region?.peakDay ? `Day ${region.peakDay}` : detectionRun ? formatDateTime(detectionRun.created_at) : "Awaiting forecast"}
                  </div>
                </div>
              </div>

              <div className="mt-8 grid gap-4 sm:grid-cols-4">
                {[
                  { label: "Risk score", value: region ? `${region.riskScore}` : "N/A", icon: AlertTriangle },
                  {
                    label: "Population exposed",
                    value:
                      region?.population != null
                        ? formatCompact(region.population)
                        : detectionRun?.population_exposed != null
                          ? formatCompact(detectionRun.population_exposed)
                          : "N/A",
                    icon: Users,
                  },
                  {
                    label: "Flooded area",
                    value:
                      region?.floodArea != null
                        ? `${formatNumber(region.floodArea, 1)} km2`
                        : detectionRun?.flood_area_km2 != null
                          ? `${formatNumber(detectionRun.flood_area_km2, 1)} km2`
                          : "N/A",
                    icon: MapIcon,
                  },
                  {
                    label: "Confidence",
                    value:
                      globalMetrics?.confidence_metrics?.confidence_level ??
                      (detectionRun?.confidence_avg != null
                        ? formatPercent(detectionRun.confidence_avg * 100, 0)
                        : "N/A"),
                    icon: CheckCircle2,
                  },
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
                  Review Run History
                  <Sparkles className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="border-t border-white/10 bg-white/80 p-6 backdrop-blur lg:border-t-0 lg:border-l">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-gray-500">Guided Workflow</p>
                  <h3 className="mt-2 text-xl font-black text-gray-900">What should the user do next?</h3>
                </div>
                <div className="rounded-2xl bg-green-50 p-3 text-green-600">
                  <Route className="h-5 w-5" />
                </div>
              </div>

              <div className="mt-6 space-y-4">
                {workflow.map((step, index) => (
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
                  value: region?.status ?? "No live region",
                  meta: region?.sources?.length ? `Backed by ${region.sources.join(" + ")}` : "Awaiting backend data",
                  icon: Bell,
                  toneClass: tone.badge,
                },
                {
                  label: "Forecast hotspot",
                  value: region?.forecastProb != null ? formatPercent(region.forecastProb * 100, 1) : "N/A",
                  meta: region?.peakDate ? `Peak date ${region.peakDate}` : "District forecast not loaded",
                  icon: CloudRain,
                  toneClass: "bg-sky-500 text-white",
                },
                {
                  label: "Infrastructure scan",
                  value: lifelineData ? `${formatNumber(lifelineData.total_features)} sites` : "N/A",
                  meta: lifelineData
                    ? `${formatNumber(lifelineData.summary?.hospital ?? 0)} hospitals and ${formatNumber(lifelineData.summary?.school ?? 0)} schools in scope`
                    : "No infrastructure scan has been run",
                  icon: Building2,
                  toneClass: "bg-amber-500 text-white",
                },
                {
                  label: "Latest SAR run",
                  value: detectionRun?.created_at ? formatDateTime(detectionRun.created_at) : "N/A",
                  meta: detectionRun ? `${formatRuntime(detectionRun.processing_time_s)} processing time` : "Historical insights feed is empty",
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
                    Live overlays reflect whatever the backend has already produced across detection, forecasting, risk, and infrastructure scans.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {layers.map((layer) => (
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
                    <div className="mt-2 text-lg font-black text-gray-900">{region?.name ?? "No region selected"}</div>
                    <div className="mt-2 flex items-center gap-3 text-sm text-gray-600">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${tone.badge}`}>
                        {region?.status ?? "Idle"}
                      </span>
                      <span className="font-medium">{region ? `Risk score ${region.riskScore}` : "Load forecast or risk analysis"}</span>
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
                      <li>The focus region is ranked from live forecast and risk-analysis responses.</li>
                      <li>The summary cards pull directly from historical SAR runs and infrastructure scans.</li>
                      <li>The activity feed is sourced from stored insights runs rather than demo events.</li>
                    </ul>
                  </div>

                  <div className="mt-5 space-y-3">
                    {buildActions(region, detectionRun, lifelineData).map((action) => (
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
              {moduleCards.map((module) => (
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
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">Top risk regions</p>
                  <h3 className="mt-2 text-lg font-black text-gray-900">Prioritize an operating area</h3>
                </div>
                <div className={`rounded-full px-3 py-1 text-[11px] font-bold uppercase ${tone.badge}`}>
                  {region?.status ?? "Idle"}
                </div>
              </div>
              <div className="mt-5 space-y-3">
                {topRiskRegions.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
                    {forecastLoading || riskLoading
                      ? "Loading live forecast and risk regions..."
                      : "Run a district forecast or risk analysis to populate this ranking."}
                  </div>
                )}

                {topRiskRegions.map((item) => {
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
                          <div className="mt-1 text-sm text-gray-500">
                            {item.peakDay ? `Forecast peak on day ${item.peakDay}` : item.factors?.[0] ?? "Awaiting more operational detail"}
                          </div>
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
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">Fused risk output</p>
                  <h3 className="mt-2 text-lg font-black text-gray-900">Operational district results</h3>
                </div>
                <div className="rounded-2xl bg-gray-50 p-3">
                  <Brain className="h-5 w-5 text-green-500" />
                </div>
              </div>

              {!districtSummaries.length && (
                <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
                  {riskLoading
                    ? "Loading fused district risk results..."
                    : "Risk API results will appear here after a risk analysis has been loaded into the store."}
                </div>
              )}

              {!!districtSummaries.length && (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                      <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-gray-500">Operational index</div>
                      <div className="mt-2 text-2xl font-black text-gray-900">
                        {globalMetrics?.risk_assessment?.operational_index ?? globalMetrics?.risk_assessment?.composite_risk_score ?? "N/A"}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                      <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-gray-500">Districts analyzed</div>
                      <div className="mt-2 text-2xl font-black text-gray-900">
                        {districtSummaries.length}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                      <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-gray-500">Confidence</div>
                      <div className="mt-2 text-2xl font-black text-gray-900">
                        {globalMetrics?.confidence_metrics?.confidence_level ?? "N/A"}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {districtSummaries.slice(0, 5).map((district) => (
                      <div key={district.district_name} className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-black text-gray-900">{district.district_name}</div>
                            <div className="mt-1 text-sm text-gray-500">
                              {(district.contributing_factors ?? []).slice(0, 2).join(" • ") || "No major factors reported"}
                            </div>
                          </div>
                          <div className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase ${compactClassificationTone(district.risk_classification)}`}>
                            {district.risk_classification}
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-4">
                          <div>
                            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400">Score</div>
                            <div className="mt-1 text-lg font-black text-gray-900">{district.risk_score ?? "N/A"}</div>
                          </div>
                          <div>
                            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400">Hazard</div>
                            <div className="mt-1 text-lg font-black text-gray-900">{formatNumber(district.component_scores?.hazard, 0)}</div>
                          </div>
                          <div>
                            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400">Exposure</div>
                            <div className="mt-1 text-lg font-black text-gray-900">{formatNumber(district.component_scores?.exposure, 0)}</div>
                          </div>
                          <div>
                            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400">Population</div>
                            <div className="mt-1 text-lg font-black text-gray-900">{formatCompact(district.population)}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">Live operations feed</p>
                  <h3 className="mt-2 text-lg font-black text-gray-900">Recent insights runs</h3>
                </div>
                <div className="rounded-2xl bg-gray-50 p-3">
                  <Activity className="h-5 w-5 text-green-500" />
                </div>
              </div>
              <div className="mt-6 space-y-4">
                {!feed.length && (
                  <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
                    {runsLoading ? "Loading recent runs..." : "Historical insights runs will appear here after the first analysis completes."}
                  </div>
                )}

                {feed.map((item) => (
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
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">Live service status</p>
                  <h3 className="mt-2 text-lg font-black text-gray-900">Backend-backed modules</h3>
                </div>
                <Layers className="h-5 w-5 text-green-500" />
              </div>
              <div className="mt-5 space-y-3">
                {[
                  {
                    name: "SAR Insights",
                    desc: detectionRun
                      ? `${detectionRun.location} completed with ${formatNumber(detectionRun.zones_count)} zones and ${formatNumber(detectionRun.population_exposed)} exposed people.`
                      : "Waiting on a completed SAR run.",
                    icon: Satellite,
                  },
                  {
                    name: "Forecast Districts",
                    desc: districts.length
                      ? `${formatNumber(districts.length)} districts ranked, led by ${districts[0]?.name}.`
                      : "District forecast has not returned any regions yet.",
                    icon: CloudRain,
                  },
                  {
                    name: "Risk Analysis",
                    desc: globalMetrics
                      ? `Composite score ${globalMetrics.risk_assessment?.composite_risk_score ?? "N/A"} with ${districtSummaries.length} district summaries.`
                      : "Risk analysis data is not loaded in this session.",
                    icon: Brain,
                  },
                  {
                    name: "Infrastructure Scan",
                    desc: lifelineData
                      ? `${formatNumber(lifelineData.total_features)} mapped features in the latest scan.`
                      : "Infrastructure scan data is not loaded in this session.",
                    icon: Building2,
                  },
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
