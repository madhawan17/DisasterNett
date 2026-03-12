import React, { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import {
  Activity,
  Bell,
  Box,
  BrainCircuit,
  Cpu,
  Database,
  Globe,
  Layers,
  Map,
  Radar,
  Route,
  Satellite,
  ShieldCheck,
  Sparkles,
  Users,
  Waves,
  Zap,
} from "lucide-react";
import CobeGlobe from "../components/globe/CobeGlobe";
import { useAppStore } from "../stores/appStore.js";
import { BackgroundPaths } from "../components/ui/background-paths.jsx";

const signalCards = [
  { icon: Satellite, title: "SAR Detection", desc: "Confirm flood extent through cloud cover.", tone: "bg-sky-50 text-sky-600" },
  { icon: Waves, title: "Forecasting", desc: "Project risk up to 14 days ahead.", tone: "bg-cyan-50 text-cyan-600" },
  { icon: Route, title: "Lifeline Routing", desc: "Protect access corridors and response routes.", tone: "bg-emerald-50 text-emerald-600" },
  { icon: BrainCircuit, title: "Decision Support", desc: "Translate model output into action.", tone: "bg-indigo-50 text-indigo-600" },
];

const workflowSteps = [
  { num: "01", icon: Database, title: "Ingest live inputs", desc: "Satellite, weather, and local context are combined into one operating picture." },
  { num: "02", icon: Radar, title: "Detect flood spread", desc: "The platform confirms active water signatures and maps likely inundation." },
  { num: "03", icon: Cpu, title: "Forecast escalation", desc: "Probability curves show how the next 14 days may evolve." },
  { num: "04", icon: Zap, title: "Act with clarity", desc: "Teams see exposure, route pressure, and response priorities in one place." },
];

const impactCards = [
  { title: "Emergency Operations", desc: "A shared command view for flood spread, exposed communities, and timing.", bgClass: "from-sky-500 via-cyan-400 to-blue-300" },
  { title: "Infrastructure Protection", desc: "Spot which roads and critical services are most exposed before failure.", bgClass: "from-emerald-500 via-teal-400 to-cyan-300" },
  { title: "Public Warning", desc: "Move from technical signal to clear, location-aware public alerts.", bgClass: "from-slate-700 via-slate-800 to-slate-900" },
];

function Reveal({ children, className = "", delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.65, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function SectionTitle({ eyebrow, title, desc, center = false }) {
  return (
    <div className={center ? "mx-auto max-w-3xl text-center" : "max-w-2xl"}>
      <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-blue-700">
        <span className="h-2 w-2 rounded-full bg-blue-500" />
        {eyebrow}
      </div>
      <h2 className="mt-5 text-4xl font-black tracking-tight text-gray-900 md:text-5xl">{title}</h2>
      <p className="mt-5 text-lg leading-8 text-gray-600">{desc}</p>
    </div>
  );
}

function DashboardShowcase() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [40, -40]);

  return (
    <div ref={ref}>
      <motion.div style={{ y }} className="overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-950 p-3 shadow-[0_30px_80px_rgba(15,23,42,0.2)]">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
          <div className="h-3 w-3 rounded-full bg-rose-400" />
          <div className="h-3 w-3 rounded-full bg-amber-400" />
          <div className="h-3 w-3 rounded-full bg-emerald-400" />
          <div className="ml-3 text-xs font-bold uppercase tracking-[0.22em] text-slate-400">Disaternet Command View</div>
        </div>
        <div className="grid gap-3 p-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-[radial-gradient(circle_at_top_left,#0f3b68_0%,#091424_45%,#05080f_100%)] p-5">
            <div className="mb-4 flex items-center justify-between text-white">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-sky-300">Live Flood Surface</div>
                <div className="mt-2 text-2xl font-black">Larkana Basin</div>
              </div>
              <div className="rounded-full bg-rose-500 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-white">Critical</div>
            </div>
            <div className="relative h-[320px] overflow-hidden rounded-[1.5rem] border border-white/10">
              <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(148,163,184,0.3)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.3)_1px,transparent_1px)] [background-size:26px_26px]" />
              <div className="absolute left-[10%] top-[16%] h-44 w-64 rounded-[45%] bg-rose-500/25 blur-xl" />
              <div className="absolute left-[18%] top-[28%] h-32 w-48 rounded-[44%] bg-rose-500/45" />
              <svg viewBox="0 0 560 300" className="absolute inset-0 h-full w-full">
                <path d="M60 250 C150 210, 210 185, 280 168 S410 128, 510 70" fill="none" stroke="#38bdf8" strokeWidth="5" strokeDasharray="8 8" />
                <path d="M72 270 C170 238, 250 220, 338 202 S440 182, 512 142" fill="none" stroke="#e2e8f0" strokeWidth="3" strokeDasharray="4 8" />
              </svg>
            </div>
          </div>
          <div className="grid gap-3">
            <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-5 text-white">
              <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">Key Exposure</div>
              <div className="mt-5 grid grid-cols-2 gap-3">
                {[
                  { label: "Population", value: "42.5K" },
                  { label: "Flooded area", value: "18.4 km2" },
                  { label: "Road cut-offs", value: "3" },
                  { label: "Confidence", value: "94%" },
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">{item.label}</div>
                    <div className="mt-3 text-2xl font-black">{item.value}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-5 text-white">
              <div className="mb-4 text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">Recommended Actions</div>
              <div className="space-y-3">
                {["Confirm the latest SAR flood footprint", "Review the 14-day escalation window", "Prepare alternative response routes"].map((item, index) => (
                  <div key={item} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-cyan-400/20 text-xs font-black text-cyan-200">{index + 1}</div>
                    <div className="text-sm leading-6 text-slate-200">{item}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default function Landing() {
  const setActiveTab = useAppStore((s) => s.setActiveTab);

  return (
    <div className="min-h-screen bg-white font-sans text-gray-900 selection:bg-blue-100 selection:text-blue-900">
      <nav className="sticky top-0 z-50 border-b border-gray-100 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600">
              <Layers className="h-5 w-5 text-white" />
            </div>
            <span className="brand-wordmark text-gray-900">Disaternet</span>
          </div>
          <div className="hidden items-center gap-8 text-sm font-medium text-gray-600 md:flex">
            <a href="#platform" className="transition-colors hover:text-blue-600">Platform</a>
            <a href="#data-room" className="transition-colors hover:text-blue-600">Workflow</a>
            <a href="#accuracy" className="transition-colors hover:text-blue-600">Accuracy</a>
            <a href="#impact" className="transition-colors hover:text-blue-600">Impact</a>
          </div>
          <div className="flex items-center gap-4">
            <button className="text-sm font-medium transition-colors hover:text-blue-600">Sign In</button>
            <button onClick={() => setActiveTab("globe")} className="rounded-full bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-blue-500/20 transition-all hover:bg-blue-700">
              Get Early Access
            </button>
          </div>
        </div>
      </nav>

      <main>
        <section id="top" className="relative overflow-hidden bg-white pt-20 pb-32">
          <BackgroundPaths />
          <div className="relative z-10 mx-auto grid max-w-7xl items-center gap-12 px-6 lg:grid-cols-2">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="max-w-xl">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
                <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500"></span>
                Real-Time • 14-Day Forecast
              </div>
              <h1 className="mb-6 text-6xl font-extrabold tracking-tight leading-[1.05] text-gray-900 md:text-7xl">
                The <span className="text-blue-600">intelligence</span> <br />
                layer behind <br />
                flood prediction.
              </h1>
              <p className="mb-10 max-w-lg text-lg leading-relaxed text-gray-600">
                Combining SAR satellite imagery, weather forecasts and community reports to predict floods and protect lives up to 14 days in advance.
              </p>
              <div className="flex flex-wrap items-center gap-4">
                <button onClick={() => setActiveTab("globe")} className="rounded-full bg-blue-600 px-8 py-4 text-lg font-medium text-white shadow-xl shadow-blue-500/20 transition-all hover:bg-blue-700">
                  Get Early Access
                </button>
                <button onClick={() => setActiveTab("globe")} className="rounded-full border border-gray-200 bg-white px-8 py-4 text-lg font-medium text-gray-900 transition-all hover:bg-gray-50">
                  View Live Demo
                </button>
              </div>
            </motion.div>
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.8, delay: 0.2 }} className="relative flex justify-center lg:justify-end">
              <div className="relative flex aspect-square w-full max-w-[600px] items-center justify-center rounded-full">
                <div className="absolute inset-0 scale-90 rounded-full bg-gradient-to-tr from-blue-500/20 to-cyan-400/10 blur-3xl"></div>
                <CobeGlobe className="relative z-10 h-full w-full" />
              </div>
            </motion.div>
          </div>
        </section>

        <section className="border-y border-slate-200 bg-slate-950 py-8">
          <div className="mx-auto grid max-w-7xl gap-4 px-6 md:grid-cols-4">
            {[
              { label: "Flood detection", value: "SAR-first", icon: Radar },
              { label: "Forecast horizon", value: "14-day", icon: Activity },
              { label: "Operational focus", value: "Route + risk", icon: Route },
              { label: "Decision output", value: "Actionable", icon: Bell },
            ].map((item) => (
              <Reveal key={item.label} className="rounded-2xl border border-white/10 bg-white/5 p-5 text-white">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">{item.label}</div>
                  <item.icon className="h-4 w-4 text-cyan-300" />
                </div>
                <div className="mt-3 text-2xl font-black">{item.value}</div>
              </Reveal>
            ))}
          </div>
        </section>

        <section id="platform" className="relative overflow-hidden bg-white py-28">
          <div className="absolute inset-x-0 top-0 h-40 bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.10),transparent_65%)]" />
          <div className="mx-auto grid max-w-7xl gap-16 px-6 lg:grid-cols-[0.95fr_1.05fr]">
            <Reveal>
              <SectionTitle eyebrow="Platform" title="A cleaner scroll story from signal to decision." desc="The sections after the hero now flow like the product itself. Users first understand the inputs, then the analysis, then the operational outcome." />
            </Reveal>
            <div className="grid gap-5 sm:grid-cols-2">
              {signalCards.map((card, index) => (
                <Reveal key={card.title} delay={index * 0.08} className="group rounded-[1.75rem] border border-gray-100 bg-white p-7 shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-blue-100/60">
                  <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${card.tone}`}>
                    <card.icon className="h-6 w-6" />
                  </div>
                  <h3 className="mt-6 text-xl font-black text-gray-900">{card.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-gray-600">{card.desc}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section id="data-room" className="bg-slate-50 py-32">
          <div className="mx-auto max-w-7xl px-6">
            <Reveal className="mb-16">
              <SectionTitle eyebrow="Workflow" title="The page now explains how Disaternet works in sequence." desc="Instead of abrupt stacked sections, the content now moves through monitoring, detection, forecasting, and response with better pacing and reveal motion." center />
            </Reveal>
            <div className="relative grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
              <Reveal className="lg:sticky lg:top-28 lg:h-fit">
                <div className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
                  <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-blue-700">
                    <Sparkles className="h-3.5 w-3.5" />
                    Scroll Narrative
                  </div>
                  <h3 className="mt-5 text-3xl font-black tracking-tight text-gray-900">Better spacing, better hierarchy, better momentum.</h3>
                  <p className="mt-5 text-base leading-8 text-gray-600">
                    Section headers are larger, content blocks breathe more, and each row enters progressively as the user scrolls.
                  </p>
                </div>
              </Reveal>
              <div className="relative">
                <div className="absolute left-[1.15rem] top-4 bottom-4 w-px bg-gradient-to-b from-blue-200 via-cyan-200 to-transparent" />
                <div className="space-y-6">
                  {workflowSteps.map((step, index) => (
                    <Reveal key={step.num} delay={index * 0.07}>
                      <div className="relative rounded-[2rem] border border-slate-200 bg-white p-7 pl-16 shadow-sm transition-all hover:shadow-lg hover:shadow-blue-100/50">
                        <div className="absolute left-4 top-7 flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-sm font-black text-white shadow-lg shadow-blue-500/20">
                          {step.num}
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="rounded-2xl bg-blue-50 p-3 text-blue-600">
                            <step.icon className="h-5 w-5" />
                          </div>
                          <h3 className="text-2xl font-black text-gray-900">{step.title}</h3>
                        </div>
                        <p className="mt-4 max-w-2xl text-base leading-8 text-gray-600">{step.desc}</p>
                      </div>
                    </Reveal>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="accuracy" className="overflow-hidden border-y border-slate-200 bg-white py-28">
          <div className="mx-auto max-w-7xl px-6">
            <Reveal className="mb-14">
              <SectionTitle eyebrow="Accuracy" title="Strong visuals that still reflect the actual product." desc="The redesigned content stays tied to real platform capabilities: flood detection, forecast confidence, route awareness, and decision support." />
            </Reveal>
            <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="grid gap-6 md:grid-cols-3">
                {[
                  { title: "Multi-sensor fusion", value: "3 streams", desc: "SAR, weather, and local context combine into one model." },
                  { title: "Warning runway", value: "14 days", desc: "Teams act before peak flood pressure arrives." },
                  { title: "Confidence scoring", value: "94%", desc: "Users can see when to escalate and when to monitor." },
                ].map((card, index) => (
                  <Reveal key={card.title} delay={index * 0.08} className="rounded-[1.75rem] border border-slate-200 bg-slate-50 p-7">
                    <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-blue-700">{card.title}</div>
                    <div className="mt-5 text-4xl font-black tracking-tight text-gray-900">{card.value}</div>
                    <p className="mt-4 text-sm leading-7 text-gray-600">{card.desc}</p>
                  </Reveal>
                ))}
              </div>
              <Reveal className="rounded-[2rem] border border-slate-200 bg-[linear-gradient(135deg,#eff6ff_0%,#ecfeff_55%,#f8fafc_100%)] p-8 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-blue-700">Confidence Drivers</div>
                    <h3 className="mt-3 text-3xl font-black tracking-tight text-gray-900">Why the platform believes risk is rising</h3>
                  </div>
                  <ShieldCheck className="h-7 w-7 text-blue-600" />
                </div>
                <div className="mt-8 space-y-5">
                  {[
                    { label: "Rainfall anomaly", value: 86 },
                    { label: "Soil saturation", value: 74 },
                    { label: "Terrain vulnerability", value: 65 },
                    { label: "Recent SAR detections", value: 91 },
                  ].map((item) => (
                    <div key={item.label}>
                      <div className="mb-2 flex items-center justify-between text-sm font-semibold text-gray-700">
                        <span>{item.label}</span>
                        <span>{item.value}%</span>
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-white/80">
                        <motion.div initial={{ width: 0 }} whileInView={{ width: `${item.value}%` }} viewport={{ once: true, amount: 0.5 }} transition={{ duration: 0.8, ease: "easeOut" }} className="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400" />
                      </div>
                    </div>
                  ))}
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        <section className="bg-slate-950 py-32">
          <div className="mx-auto grid max-w-7xl items-center gap-16 px-6 lg:grid-cols-[1.05fr_0.95fr]">
            <Reveal>
              <DashboardShowcase />
            </Reveal>
            <Reveal>
              <div className="max-w-xl text-white">
                <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-cyan-200">
                  <Map className="h-3.5 w-3.5" />
                  Dashboard Preview
                </div>
                <h2 className="mt-6 text-4xl font-black tracking-tight md:text-5xl">One command view for detection, forecasting, and response.</h2>
                <p className="mt-6 text-lg leading-8 text-slate-300">
                  The page now has a stronger visual payoff after the information sections, with a dashboard mock that moves subtly on scroll and makes the product feel tangible.
                </p>
                <div className="mt-8 space-y-4">
                  {[
                    "Clear flood footprint and route overlays",
                    "Exposure metrics with confidence context",
                    "Action-oriented prompts instead of static filler cards",
                  ].map((item) => (
                    <div key={item} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="mt-1 rounded-full bg-cyan-400/20 p-1.5 text-cyan-200">
                        <Box className="h-3.5 w-3.5" />
                      </div>
                      <p className="text-sm leading-7 text-slate-200">{item}</p>
                    </div>
                  ))}
                </div>
                <button onClick={() => setActiveTab("globe")} className="mt-10 rounded-full bg-white px-8 py-3.5 font-bold text-slate-950 transition-transform hover:-translate-y-0.5">
                  Explore Dashboard
                </button>
              </div>
            </Reveal>
          </div>
        </section>

        <section id="impact" className="bg-white py-28">
          <div className="mx-auto max-w-7xl px-6">
            <Reveal className="mb-16">
              <SectionTitle eyebrow="Impact" title="Designed around the decisions flood teams actually make." desc="The closing section now reinforces the real project outcomes: emergency coordination, infrastructure protection, and clearer community warning." center />
            </Reveal>
            <div className="grid gap-6 md:grid-cols-3">
              {impactCards.map((card, index) => (
                <Reveal key={card.title} delay={index * 0.08} className="group overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-blue-100/60">
                  <div className={`h-56 bg-gradient-to-br ${card.bgClass}`} />
                  <div className="p-7">
                    <h3 className="text-2xl font-black text-gray-900">{card.title}</h3>
                    <p className="mt-4 text-sm leading-7 text-gray-600">{card.desc}</p>
                    <button className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-blue-600 transition-colors group-hover:text-blue-700">
                      Learn More
                      <Globe className="h-4 w-4" />
                    </button>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-gray-200 bg-slate-50 py-16">
        <div className="mx-auto grid max-w-7xl gap-12 px-6 md:grid-cols-4">
          <div className="md:col-span-2">
            <div className="mb-6 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600">
                <Layers className="h-5 w-5 text-white" />
              </div>
              <span className="brand-wordmark text-gray-900">Disaternet</span>
            </div>
            <p className="mb-8 max-w-sm text-sm text-gray-500">
              Building a clearer flood intelligence experience for detection, forecasting, and response coordination.
            </p>
            <div className="flex gap-4">
              {["Facebook", "Twitter", "LinkedIn"].map((a, i) => (
                <div key={i} className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-gray-200 text-gray-400 transition-colors hover:border-blue-500 hover:text-blue-500">
                  <Globe className="h-4 w-4" />
                </div>
              ))}
            </div>
          </div>
          <div>
            <h4 className="mb-6 text-xs font-bold uppercase tracking-wider text-gray-900">Product</h4>
            <ul className="space-y-4 text-sm text-gray-600">
              <li><a href="#" className="hover:text-blue-500">Dashboard</a></li>
              <li><a href="#" className="hover:text-blue-500">API Docs</a></li>
              <li><a href="#" className="hover:text-blue-500">Pricing</a></li>
            </ul>
          </div>
          <div>
            <h4 className="mb-6 text-xs font-bold uppercase tracking-wider text-gray-900">Company</h4>
            <ul className="space-y-4 text-sm text-gray-600">
              <li><a href="#" className="hover:text-blue-500">About Us</a></li>
              <li><a href="#" className="hover:text-blue-500">Careers</a></li>
              <li><a href="#" className="hover:text-blue-500">Contact</a></li>
            </ul>
          </div>
        </div>
      </footer>
    </div>
  );
}
