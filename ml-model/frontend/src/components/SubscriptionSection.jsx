/**
 * SubscriptionSection — AMBROSIA pricing + outlook
 * Direct Razorpay integration (frontend only, no backend)
 */

import React, { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { useAppStore } from "../stores/appStore.js";
import { useAuth } from "../hooks/useAuth.js";

// ── Colour tokens ─────────────────────────────────────────────────────────────
const C = {
  bg: "#060504",
  bgCard: "#0a0907",
  bgFeat: "#0d0b08",
  cream: "#ece8df",
  gold: "#f2d16d",
  red: "#c0392b",
  muted: "rgba(236,232,223,0.55)",
  border: "rgba(242,209,109,0.14)",
  featBorder: "rgba(242,209,109,0.52)",
};

// ── Business Outlook stats ────────────────────────────────────────────────
const STATS = [
  { value: "140+", color: C.cream, label: "Countries Monitored" },
  { value: "94.7%", color: C.red, label: "Predictive Accuracy" },
  { value: "2.4s", color: C.cream, label: "Mean Time to Signal" },
  { value: "2,400+", color: C.gold, label: "Proprietary Sources" },
];

// ── Plan definitions ─────────────────────────────────────────────────────
const PLANS = [
  {
    key: "free",
    tier: "Observer",
    name: "Free",
    price: "$0",
    period: "forever",
    desc: "Entry-level access for individual intelligence consumers.",
    features: [
      "5 verifications per day",
      "1 concurrent session",
      "All signal types",
      "Educational briefings",
    ],
    cta: "Enroll — No Cost",
    guarantee: "No credit card required",
    featured: false,
  },
  {
    key: "plus",
    tier: "Analyst",
    name: "Plus",
    price: "$4.99",
    period: "per month",
    desc: "Expanded capacity for professional intelligence analysts.",
    features: [
      "10 verifications per day",
      "5 concurrent sessions",
      "All signal types",
      "Full briefing archive",
    ],
    cta: "Upgrade Clearance",
    guarantee: "Cancel anytime",
    featured: true,
    badge: "RECOMMENDED",
  },
  {
    key: "pro",
    tier: "Sovereign",
    name: "Pro",
    price: "$9.99",
    period: "per month",
    desc: "Unrestricted access for institutional and state-level actors.",
    features: [
      "25 verifications per day",
      "20 concurrent sessions",
      "Priority processing",
      "Full premium capabilities",
    ],
    cta: "Upgrade to Sovereign",
    guarantee: "Cancel anytime",
    featured: false,
  },
];

// ── Small utilities ───────────────────────────────────────────────────────────
function GoldCheck() {
  return (
    <svg
      width="12"
      height="10"
      viewBox="0 0 12 10"
      fill="none"
      style={{ flexShrink: 0, marginTop: "2px" }}
    >
      <path
        d="M1 5l3.5 3.5L11 1"
        stroke={C.gold}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Main export ───────────────────────────────────────────────────────────
export default function SubscriptionSection() {
  const { setActiveTab, showNotification } = useAppStore();
  const { user: authUser } = useAuth();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [rzpLoaded, setRzpLoaded] = useState(false);
  const [rzpKeyId, setRzpKeyId] = useState(null);

  const sectionRef = useRef(null);
  const [statsVisible, setStatsVisible] = useState(false);

  // ── Stat animation ──────────────────────────────────────────────────────
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setStatsVisible(true);
      },
      { threshold: 0.2 },
    );
    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  // ── Load Razorpay SDK ────────────────────────────────────────────────────
  useEffect(() => {
    // Set Razorpay key ID with fallbacks
    const envKey =
      import.meta.env?.VITE_RAZORPAY_ID ||
      import.meta.env?.VITE_RAZORPAY_KEY ||
      "rzp_test_mock";
    console.log("🔑 Razorpay Key ID set to:", envKey);
    setRzpKeyId(envKey);

    // Check if script already exists
    const existing = document.querySelector(
      'script[src="https://checkout.razorpay.com/v1/checkout.js"]',
    );
    if (existing) {
      console.log("✅ Razorpay script already exists in DOM");
      setRzpLoaded(true);
      return;
    }

    // Load Razorpay script
    console.log("📦 Loading Razorpay script from CDN...");
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => {
      console.log("✅ Razorpay script loaded successfully!");
      setRzpLoaded(true);
    };
    script.onerror = (err) => {
      console.error("❌ Failed to load Razorpay script:", err);
      setError("Failed to load payment gateway.");
    };
    document.body.appendChild(script);

    // Cleanup
    return () => {
      const s = document.querySelector(
        'script[src="https://checkout.razorpay.com/v1/checkout.js"]',
      );
      if (s) {
        console.log("🧹 Cleaning up Razorpay script");
        document.body.removeChild(s);
      }
    };
  }, []);

  // ── Handle plan upgrade (direct Razorpay) ───────────────────────────────
  const handlePlanClick = (plan) => {
    setError(null);
    setSuccess(null);

    // Check auth
    if (!authUser) {
      setError("You must be signed in to choose a plan. Redirecting...");
      showNotification("Please sign in to continue", "info");
      setTimeout(() => setActiveTab("login"), 1500);
      return;
    }

    // Free tier
    if (plan.name === "Free") {
      setSuccess("Free tier activated!");
      showNotification("Observer tier activated!", "success");
      return;
    }

    // Check Razorpay ready
    if (!rzpLoaded || !rzpKeyId) {
      console.warn("⚠️ Razorpay not ready:", { rzpLoaded, rzpKeyId });
      setError("Payment gateway not ready. Please refresh and try again.");
      return;
    }

    console.log("💳 Opening Razorpay checkout for plan:", plan.tier);
    setLoading(true);

    // Amount in paise (₹1 = 100 paise)
    const options = {
      key: rzpKeyId,
      amount: 100,
      currency: "INR",
      name: "Ambrosia Intelligence",
      description: `${plan.tier} Clearance — Monthly Subscription`,
      prefill: {
        email: authUser?.email || "",
        name: authUser?.email?.split("@")[0] || "User",
      },
      theme: { color: C.red },
      handler: function (response) {
        console.log("✅ Payment successful! ID:", response.razorpay_payment_id);
        setSuccess(`✓ Payment successful! ${plan.tier} clearance activated.`);
        showNotification(
          `Welcome to ${plan.tier}! Payment ID: ${response.razorpay_payment_id}`,
          "success",
        );
        setLoading(false);
        window.scrollTo({ top: 0, behavior: "smooth" });
      },
      modal: {
        ondismiss: function () {
          console.log("❌ Checkout modal dismissed by user");
          setLoading(false);
        },
      },
    };

    try {
      console.log("🚀 Initializing Razorpay with options:", options);
      const razorpay = new window.Razorpay(options);
      razorpay.on("payment.failed", function (response) {
        const errorMsg =
          response?.error?.description ||
          response?.error?.reason ||
          "Payment declined";
        console.error("❌ Payment failed:", response);
        setError(`Payment failed: ${errorMsg}`);
        showNotification(errorMsg, "error");
        setLoading(false);
      });
      console.log("📲 Opening Razorpay checkout modal...");
      razorpay.open();
    } catch (err) {
      console.error("❌ Error opening payment gateway:", err);
      setError(err.message || "Failed to open payment gateway");
      setLoading(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div ref={sectionRef} style={{ background: C.bg, fontFamily: "inherit" }}>
      {/* SECTION A: Business Intelligence Outlook */}
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={statsVisible ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        <div
          className="w-full h-px"
          style={{
            background: `linear-gradient(to right, ${C.gold} 0%, rgba(242,209,109,0.15) 60%, transparent 100%)`,
          }}
        />

        <div className="flex flex-col lg:flex-row items-start gap-16 px-10 sm:px-16 lg:px-24 py-24">
          <div className="lg:w-[55%] shrink-0">
            <p
              className="tracking-[0.35em] uppercase mb-6"
              style={{
                fontSize: "0.6rem",
                color: C.gold,
                fontFamily: "monospace",
              }}
            >
              Intelligence Platform — Operational Metrics
            </p>
            <h2
              className="font-display font-extralight leading-[1.05]"
              style={{
                fontSize: "clamp(2.4rem, 5vw, 4.8rem)",
                color: C.cream,
                letterSpacing: "-0.02em",
              }}
            >
              Intelligence
              <br />
              at Scale.
            </h2>
            <div
              className="mt-8 h-px w-20"
              style={{
                background: `linear-gradient(to right, ${C.red}, transparent)`,
              }}
            />
            <p
              className="mt-6 font-light leading-relaxed max-w-md"
              style={{
                fontSize: "0.9rem",
                color: C.muted,
                letterSpacing: "0.02em",
                lineHeight: "1.8",
              }}
            >
              Ambrosia processes billions of signals across every timezone,
              language, and channel. What you act on is already verified.
            </p>
          </div>

          <div
            className="flex-1 grid grid-cols-2 gap-px"
            style={{ border: `1px solid ${C.border}` }}
          >
            {STATS.map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 20 }}
                animate={statsVisible ? { opacity: 1, y: 0 } : {}}
                transition={{
                  delay: 0.3 + i * 0.1,
                  duration: 0.6,
                  ease: "easeOut",
                }}
                className="flex flex-col justify-center px-8 py-10"
                style={{
                  background: C.bgCard,
                  borderRight: i % 2 === 0 ? `1px solid ${C.border}` : "none",
                  borderBottom: i < 2 ? `1px solid ${C.border}` : "none",
                }}
              >
                <span
                  className="font-display font-extralight leading-none mb-2"
                  style={{
                    fontSize: "clamp(2rem, 4vw, 3.2rem)",
                    color: stat.color,
                    letterSpacing: "-0.02em",
                  }}
                >
                  {stat.value}
                </span>
                <span
                  className="tracking-[0.3em] uppercase"
                  style={{
                    fontSize: "0.56rem",
                    color: C.gold,
                    fontFamily: "monospace",
                  }}
                >
                  {stat.label}
                </span>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* SECTION B: Access Tiers (Pricing) */}
      <div className="px-10 sm:px-16 lg:px-24 pb-28 pt-4">
        <div className="mb-16 text-center">
          <p
            className="tracking-[0.4em] uppercase mb-5"
            style={{
              fontSize: "0.57rem",
              color: C.gold,
              fontFamily: "monospace",
            }}
          >
            Access Tiers
          </p>
          <h2
            className="font-display font-extralight leading-tight"
            style={{
              fontSize: "clamp(2rem, 4.5vw, 4rem)",
              color: C.cream,
              letterSpacing: "-0.02em",
            }}
          >
            Choose Your Clearance.
          </h2>
          <div
            className="mx-auto mt-4 h-px w-16"
            style={{
              background: `linear-gradient(to right, transparent, ${C.red}, transparent)`,
            }}
          />
          <p
            className="mt-4 tracking-[0.15em] uppercase"
            style={{
              fontSize: "0.6rem",
              color: "rgba(242,209,109,0.5)",
              fontFamily: "monospace",
            }}
          >
            Structured access for every level of operational need
          </p>
        </div>

        {/* Error / Success banners */}
        {error && (
          <div
            className="mb-8 mx-auto max-w-2xl px-5 py-4"
            style={{
              border: `1px solid rgba(192,57,43,0.4)`,
              background: "rgba(192,57,43,0.06)",
            }}
          >
            <p
              style={{
                fontSize: "0.75rem",
                color: "#e07060",
                fontFamily: "monospace",
                letterSpacing: "0.05em",
              }}
            >
              ⚠ {error}
            </p>
          </div>
        )}
        {success && (
          <div
            className="mb-8 mx-auto max-w-2xl px-5 py-4"
            style={{
              border: `1px solid rgba(242,209,109,0.4)`,
              background: "rgba(242,209,109,0.06)",
            }}
          >
            <p
              style={{
                fontSize: "0.75rem",
                color: C.gold,
                fontFamily: "monospace",
                letterSpacing: "0.05em",
              }}
            >
              ✓ {success}
            </p>
          </div>
        )}

        {/* Plan cards */}
        <div
          className="grid grid-cols-1 md:grid-cols-3 gap-px"
          style={{ border: `1px solid ${C.border}` }}
        >
          {PLANS.map((plan, idx) => (
            <motion.div
              key={plan.key}
              initial={{ opacity: 0, y: 30 }}
              animate={statsVisible ? { opacity: 1, y: 0 } : {}}
              transition={{
                delay: 0.5 + idx * 0.12,
                duration: 0.6,
                ease: "easeOut",
              }}
              className="relative flex flex-col"
              style={{
                background: plan.featured ? C.bgFeat : C.bgCard,
                borderRight: idx < 2 ? `1px solid ${C.border}` : "none",
                borderTop:
                  plan.featured ?
                    `2px solid ${C.gold}`
                  : `2px solid transparent`,
              }}
            >
              {plan.badge && (
                <div
                  className="absolute top-0 right-0 px-3 py-1.5"
                  style={{ background: C.gold }}
                >
                  <span
                    style={{
                      fontSize: "0.52rem",
                      color: "#060504",
                      fontFamily: "monospace",
                      letterSpacing: "0.25em",
                      fontWeight: 700,
                    }}
                  >
                    {plan.badge}
                  </span>
                </div>
              )}

              <div className="flex flex-col flex-1 p-8 pt-10">
                <p
                  className="tracking-[0.4em] uppercase mb-3"
                  style={{
                    fontSize: "0.58rem",
                    color: C.gold,
                    fontFamily: "monospace",
                  }}
                >
                  {plan.tier}
                </p>

                <div className="flex items-baseline gap-2 mb-2">
                  <span
                    className="font-display font-extralight"
                    style={{
                      fontSize: "clamp(2.2rem, 3.5vw, 3rem)",
                      color: C.cream,
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {plan.price}
                  </span>
                  {plan.period !== "forever" && (
                    <span
                      style={{
                        fontSize: "0.72rem",
                        color: "rgba(236,232,223,0.4)",
                      }}
                    >
                      / {plan.period}
                    </span>
                  )}
                </div>

                <p
                  className="mb-8 font-light leading-relaxed"
                  style={{
                    fontSize: "0.78rem",
                    color: C.muted,
                    lineHeight: "1.7",
                  }}
                >
                  {plan.desc}
                </p>

                <div
                  className="mb-6 h-px w-full"
                  style={{ background: C.border }}
                />

                <ul className="space-y-3 flex-1 mb-8">
                  {plan.features.map((feat) => (
                    <li key={feat} className="flex items-start gap-3">
                      <GoldCheck />
                      <span
                        style={{
                          fontSize: "0.78rem",
                          color: "rgba(236,232,223,0.70)",
                          lineHeight: "1.6",
                        }}
                      >
                        {feat}
                      </span>
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => handlePlanClick(plan)}
                  disabled={loading && plan.name !== "Free"}
                  className="relative group w-full overflow-hidden mt-auto"
                  style={{
                    padding: "0.8rem 1rem",
                    cursor:
                      loading && plan.name !== "Free" ? "wait" : "pointer",
                  }}
                >
                  <span
                    className="absolute inset-0"
                    style={{
                      border: `1px solid ${
                        plan.featured ? C.gold : "rgba(236,232,223,0.25)"
                      }`,
                    }}
                  />
                  <span
                    className="absolute inset-0 translate-x-full group-hover:translate-x-0 transition-transform duration-300"
                    style={{
                      background:
                        plan.featured ? C.red : "rgba(236,232,223,0.07)",
                    }}
                  />
                  <span
                    className="relative z-10 font-light tracking-[0.22em] uppercase"
                    style={{
                      fontSize: "0.64rem",
                      color: C.cream,
                      fontFamily: "monospace",
                    }}
                  >
                    {loading && plan.name !== "Free" ? "Processing…" : plan.cta}
                  </span>
                </button>

                {plan.guarantee && (
                  <p
                    className="mt-4 text-center tracking-[0.2em]"
                    style={{
                      fontSize: "0.58rem",
                      color: "rgba(242,209,109,0.45)",
                      fontFamily: "monospace",
                    }}
                  >
                    {plan.guarantee.toUpperCase()}
                  </p>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Footer rule */}
      <div className="px-10 sm:px-16 lg:px-24 pb-16">
        <div
          className="h-px w-full"
          style={{
            background: `linear-gradient(to right, transparent, rgba(242,209,109,0.5) 30%, rgba(242,209,109,0.5) 70%, transparent)`,
          }}
        />
        <div className="mt-8 flex items-center justify-between">
          <span
            className="tracking-[0.35em] uppercase"
            style={{
              fontSize: "0.57rem",
              color: "rgba(242,209,109,0.8)",
              fontFamily: "monospace",
            }}
          >
            Ambrosia © {new Date().getFullYear()}
          </span>
          <span
            className="tracking-[0.35em] uppercase"
            style={{
              fontSize: "0.57rem",
              color: "rgba(242,209,109,0.8)",
              fontFamily: "monospace",
            }}
          >
            Intelligence. Precision. Clarity.
          </span>
        </div>
      </div>
    </div>
  );
}
