import React, { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import ScrollAnimationViewer from "../components/ScrollAnimationViewer.jsx";
import SubscriptionSection from "../components/SubscriptionSection.jsx";
import { useScrollAnimation } from "../hooks/useScrollAnimation.js";
import { useAppStore } from "../stores/appStore.js";
import { useAuth } from "../hooks/useAuth.js";

// ── Non-linear scroll keyframes ──────────────────────────────────────────────
// [rawScrollFraction, frameIndex]
// Text sections get MORE scroll runway (feel slower — user has time to read).
// Pure-animation transitions between sections get LESS runway (feel snappier).
//
// Distribution:
//   Hero       frames 0–39    → 0.00–0.10  (10%,  fast — it's just a title)
//   Doctrine   frames 40–79   → 0.10–0.27  (17%,  slow — lots of text)
//   Signal     frames 80–119  → 0.27–0.44  (17%,  slow)
//   Threat     frames 120–159 → 0.44–0.61  (17%,  slow)
//   Counsel    frames 160–199 → 0.61–0.78  (17%,  slow)
//   CTA        frames 200–239 → 0.78–1.00  (22%,  slower — linger on the end)
const SCROLL_KEYFRAMES = [
  [0.0, 0],
  [0.1, 39], // hero exits fast
  [0.27, 79], // doctrine lingers
  [0.44, 119], // signal lingers
  [0.61, 159], // threat lingers
  [0.78, 199], // counsel lingers
  [1.0, 239], // CTA lingers longest
];

// ── Section definitions ───────────────────────────────────────────────────────
// direction: 'left' | 'right' | 'bottom'
//   Alternating directions keep the canvas feeling fresh every scroll.
//   left  → panel anchored bottom-left, slides in from x:-80
//   right → panel anchored bottom-right, slides in from x:+80
//   bottom→ full-width strip, rises from y:+30
const SECTIONS = [
  {
    id: "hero",
    scrollStart: 0,
    scrollEnd: 0.1,
    title: "AMBROSIA",
    subtitle: "Intelligence, mapped at the scale of worlds.",
  },
  {
    id: "doctrine",
    label: "Doctrine",
    direction: "left",
    scrollStart: 0.1,
    scrollEnd: 0.27,
    title: "Not a platform.",
    subtitle: "A perspective.",
    description:
      "Ambrosia synthesises signal from noise at a planetary scale. We map the connections others miss, trace the patterns that precede events, and surface clarity where the world sees only chaos.",
  },
  {
    id: "signal",
    label: "Signal Intelligence",
    direction: "right",
    scrollStart: 0.27,
    scrollEnd: 0.44,
    title: "Signal Intelligence",
    description:
      "Real-time synthesis of open-source and proprietary data streams — every channel, every language, every timezone.",
  },
  {
    id: "threat",
    label: "Threat Mapping",
    direction: "bottom",
    scrollStart: 0.44,
    scrollEnd: 0.61,
    title: "Threat Mapping",
    description:
      "Predictive geopolitical risk, visualised at the precision of the frame. Events anticipated before they surface.",
  },
  {
    id: "counsel",
    label: "Strategic Counsel",
    direction: "left",
    scrollStart: 0.61,
    scrollEnd: 0.78,
    title: "Strategic Counsel",
    description:
      "Direct advisory for decisions that move at the speed of the world. A singular perspective when the stakes are absolute.",
  },
  {
    id: "cta",
    scrollStart: 0.78,
    scrollEnd: 1.0,
    title: "The world doesn't wait.",
    subtitle: "Neither do we.",
    description:
      "Ambrosia is available to a limited number of sovereign, institutional, and private clients. Engagements begin with a single conversation.",
    isAction: true,
  },
];

const TOTAL_FRAMES = 240;
const SCROLL_HEIGHT_MULTIPLIER = 5; // 5 × viewport height of scroll runway

// ── Direction-aware variant factory ─────────────────────────────────────────
// Each middle section flies in from its own axis, exits on the same axis.
// This makes every section feel spatially distinct despite sharing the same canvas.
const makeVariants = (direction) => ({
  hidden: {
    opacity: 0,
    x:
      direction === "left" ? -80
      : direction === "right" ? 80
      : 0,
    y: direction === "bottom" ? 36 : 0,
  },
  visible: {
    opacity: 1,
    x: 0,
    y: 0,
    transition: { duration: 0.55, ease: [0.25, 0.46, 0.45, 0.94] },
  },
  exit: {
    opacity: 0,
    x:
      direction === "left" ? -50
      : direction === "right" ? 50
      : 0,
    y: direction === "bottom" ? -20 : 8,
    transition: { duration: 0.28, ease: "easeIn" },
  },
});

const heroVariants = {
  hidden: { opacity: 0, y: 32 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.9, ease: [0.25, 0.46, 0.45, 0.94] },
  },
  exit: { opacity: 0, y: -20, transition: { duration: 0.35, ease: "easeIn" } },
};

// Shared text style tokens
const LABEL_STYLE = {
  fontSize: "0.6rem",
  color: "#f2d16d",
  fontFamily: "monospace",
};
const TITLE_STYLE = {
  fontSize: "clamp(1.8rem, 4.2vw, 3.6rem)",
  color: "#ece8df",
  letterSpacing: "-0.01em",
};
const BODY_STYLE = {
  fontSize: "0.82rem",
  color: "rgba(236,232,223,0.60)",
  letterSpacing: "0.025em",
  lineHeight: "1.75",
};
const PANEL_BG_V =
  "linear-gradient(to top,    rgba(6,5,4,0.97) 0%, rgba(6,5,4,0.82) 60%, rgba(6,5,4,0.50) 100%)";
const PANEL_BG_H =
  "linear-gradient(to right,  rgba(6,5,4,0.97) 0%, rgba(6,5,4,0.82) 60%, rgba(6,5,4,0.40) 100%)";
const PANEL_BG_HR =
  "linear-gradient(to left,   rgba(6,5,4,0.97) 0%, rgba(6,5,4,0.82) 60%, rgba(6,5,4,0.40) 100%)";

export default function Landing() {
  const { setActiveTab } = useAppStore();
  const { isAuthenticated } = useAuth();

  // Apple-style passive + rAF LERP scroll animation with non-linear keyframe map
  const { currentFrame, scrollProgress } = useScrollAnimation(
    TOTAL_FRAMES,
    null, // auto scrollHeight = 4 × innerHeight (close to our 5× multiplier)
    0.09, // LERP ease — slightly slower for more cinematic weight
    SCROLL_KEYFRAMES, // non-linear mapping: text sections scroll slower
  );

  // Derive current section from raw scroll progress
  const currentSection = useMemo(() => {
    for (let i = SECTIONS.length - 1; i >= 0; i--) {
      if (scrollProgress >= SECTIONS[i].scrollStart) return i;
    }
    return 0;
  }, [scrollProgress]);

  const section = SECTIONS[currentSection];
  const isHero = currentSection === 0;
  const isCTA = currentSection === SECTIONS.length - 1;
  const isMiddle = !isHero && !isCTA;
  const sectionNumber = String(currentSection + 1).padStart(2, "0");
  const totalSections = String(SECTIONS.length).padStart(2, "0");
  const progressPct = Math.round(scrollProgress * 100);

  return (
    <>
      {/* ── Tall scrollable wrapper (the "scroll runway") ──────────────────────*/}
      <div
        style={{ height: `calc(100vh * ${SCROLL_HEIGHT_MULTIPLIER})` }}
        className="relative w-full bg-[#060504]"
      >
        {/* ── Sticky viewport panel — below nav (nav is h-14) ─────────── */}
        <div className="sticky top-14 w-full h-[calc(100vh-3.5rem)] overflow-hidden">
          {/* Canvas animation — full-screen background */}
          <div className="absolute inset-0 z-0">
            <ScrollAnimationViewer
              currentFrame={currentFrame}
              totalFrames={TOTAL_FRAMES}
              scrollProgress={scrollProgress}
              showOverlay={false}
            />
          </div>
          {/* Edge vignette — pulls focus inward */}
          <div
            className="absolute inset-0 pointer-events-none z-10"
            style={{
              background:
                "radial-gradient(ellipse at center, transparent 40%, rgba(6,5,4,0.50) 100%)",
            }}
          />
          {/* HUD removed as per request */}\n
          {/* ════════════════════════════════════════════════════════════════════
            HERO SECTION — Full-screen centered, no bottom strip
        ════════════════════════════════════════════════════════════════════════ */}
          <AnimatePresence mode="wait">
            {isHero && (
              <motion.div
                key="hero"
                variants={heroVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="absolute inset-0 z-20 flex flex-col items-center justify-start pt-[12vh] text-center px-6 pointer-events-none"
              >
                {/* Pre-title rule */}
                <div
                  className="w-16 h-px mb-8"
                  style={{ background: "rgba(242,209,109,0.5)" }}
                />
                {/* Main title */}
                <h1
                  className="font-display font-extralight tracking-[0.35em] mb-6"
                  style={{
                    fontSize: "clamp(3.5rem, 10vw, 9rem)",
                    color: "#ece8df",
                    letterSpacing: "0.32em",
                    lineHeight: 1,
                  }}
                >
                  {section.title}
                </h1>
                {/* Red divider */}
                <div
                  className="w-24 h-px mb-6"
                  style={{
                    background:
                      "linear-gradient(to right, transparent, #c0392b, transparent)",
                  }}
                />
                {/* Subtitle */}
                <p
                  className="font-light tracking-[0.15em] uppercase"
                  style={{
                    fontSize: "clamp(0.65rem, 1.5vw, 0.9rem)",
                    color: "rgba(236,232,223,0.65)",
                    letterSpacing: "0.18em",
                  }}
                >
                  {section.subtitle}
                </p>

                {/* Scroll hint */}
                <motion.div
                  className="absolute bottom-10 flex flex-col items-center gap-2"
                  animate={{ y: [0, 8, 0] }}
                  transition={{
                    duration: 2.2,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                >
                  <span
                    className="text-[9px] tracking-[0.4em] uppercase"
                    style={{
                      color: "rgba(242,209,109,0.5)",
                      fontFamily: "monospace",
                    }}
                  >
                    Scroll
                  </span>
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 16 16"
                    stroke="#f2d16d"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                    style={{ opacity: 0.5 }}
                  >
                    <path d="M8 3v10M3 9l5 5 5-5" />
                  </svg>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
          {/* ════════════════════════════════════════════════════════════════════
            MIDDLE SECTIONS (1–4) — Direction-aware editorial panels

            LEFT  (doctrine, counsel):
              Bottom-left panel, 45% wide. Gold vertical rule on left edge.
              Slides in from x:-80, exits to x:-50.

            RIGHT (signal):
              Bottom-right panel, 45% wide. Gold vertical rule on right edge.
              Content right-aligned. Slides in from x:+80, exits to x:+50.

            BOTTOM (threat):
              Full-width bottom strip. Gold horizontal rule on top.
              Classic lift from y:+36.
        ════════════════════════════════════════════════════════════════════════ */}
          <AnimatePresence mode="wait">
            {isMiddle &&
              (() => {
                const dir = section.direction ?? "bottom";
                const variants = makeVariants(dir);
                const num = sectionNumber;
                const lbl = section.label || section.id.toUpperCase();

                /* ── LEFT panel ──────────────────────────────────────────────── */
                if (dir === "left")
                  return (
                    <motion.div
                      key={currentSection}
                      variants={variants}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      className="absolute bottom-0 left-0 z-20 w-[48%] pointer-events-none"
                    >
                      {/* Vertical gold rule */}
                      <div className="flex">
                        <div
                          className="w-[3px] self-stretch shrink-0"
                          style={{
                            background:
                              "linear-gradient(to top, #f2d16d 0%, rgba(242,209,109,0.2) 100%)",
                          }}
                        />
                        <div
                          className="flex-1 px-8 pt-6 pb-9"
                          style={{ background: PANEL_BG_H }}
                        >
                          <p
                            className="mb-3 tracking-[0.35em] uppercase"
                            style={LABEL_STYLE}
                          >
                            {num} — {lbl}
                          </p>
                          <h2
                            className="font-display font-extralight leading-[1.05] mb-5"
                            style={TITLE_STYLE}
                          >
                            {section.title}
                            {section.subtitle && (
                              <>
                                <br />
                                <span style={{ color: "#c0392b" }}>
                                  {section.subtitle}
                                </span>
                              </>
                            )}
                          </h2>
                          {section.description && (
                            <p className="font-light" style={BODY_STYLE}>
                              {section.description}
                            </p>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );

                /* ── RIGHT panel ─────────────────────────────────────────────── */
                if (dir === "right")
                  return (
                    <motion.div
                      key={currentSection}
                      variants={variants}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      className="absolute bottom-0 right-0 z-20 w-[48%] pointer-events-none"
                    >
                      <div className="flex flex-row-reverse">
                        <div
                          className="w-[3px] self-stretch shrink-0"
                          style={{
                            background:
                              "linear-gradient(to top, #f2d16d 0%, rgba(242,209,109,0.2) 100%)",
                          }}
                        />
                        <div
                          className="flex-1 px-8 pt-6 pb-9 text-right"
                          style={{ background: PANEL_BG_HR }}
                        >
                          <p
                            className="mb-3 tracking-[0.35em] uppercase"
                            style={LABEL_STYLE}
                          >
                            {num} — {lbl}
                          </p>
                          <h2
                            className="font-display font-extralight leading-[1.05] mb-5"
                            style={TITLE_STYLE}
                          >
                            {section.title}
                            {section.subtitle && (
                              <>
                                <br />
                                <span style={{ color: "#c0392b" }}>
                                  {section.subtitle}
                                </span>
                              </>
                            )}
                          </h2>
                          {section.description && (
                            <p className="font-light" style={BODY_STYLE}>
                              {section.description}
                            </p>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );

                /* ── BOTTOM full strip ───────────────────────────────────────── */
                return (
                  <motion.div
                    key={currentSection}
                    variants={variants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    className="absolute bottom-0 left-0 right-0 z-20 pointer-events-none"
                  >
                    {/* Horizontal gold rule */}
                    <div
                      className="w-full h-px"
                      style={{
                        background:
                          "linear-gradient(to right, rgba(242,209,109,0.7) 0%, rgba(242,209,109,0.15) 75%, transparent 100%)",
                      }}
                    />
                    <div
                      className="flex items-start gap-0 px-10 sm:px-14 pt-6 pb-8"
                      style={{
                        background:
                          "linear-gradient(to top, rgba(6,5,4,0.97) 0%, rgba(6,5,4,0.88) 60%, rgba(6,5,4,0.60) 100%)",
                      }}
                    >
                      {/* Left: label + title */}
                      <div className="flex-1 pr-12 min-w-0">
                        <p
                          className="mb-3 tracking-[0.35em] uppercase"
                          style={LABEL_STYLE}
                        >
                          {num} — {lbl}
                        </p>
                        <h2
                          className="font-display font-extralight leading-[1.05]"
                          style={TITLE_STYLE}
                        >
                          {section.title}
                          {section.subtitle && (
                            <>
                              <br />
                              <span style={{ color: "#c0392b" }}>
                                {section.subtitle}
                              </span>
                            </>
                          )}
                        </h2>
                      </div>
                      {/* Right: description */}
                      {section.description && (
                        <div
                          className="w-[38%] shrink-0 pt-10 hidden sm:block"
                          style={{
                            borderLeft: "1px solid rgba(242,209,109,0.12)",
                            paddingLeft: "2rem",
                          }}
                        >
                          <p className="font-light" style={BODY_STYLE}>
                            {section.description}
                          </p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })()}
          </AnimatePresence>
          {/* ════════════════════════════════════════════════════════════════════
            CTA SECTION — Full-screen centered, minimal, no card
            Stitch design: stark typography + thin-border sharp button
        ════════════════════════════════════════════════════════════════════════ */}
          <AnimatePresence mode="wait">
            {isCTA && (
              <motion.div
                key="cta"
                variants={heroVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="absolute inset-0 z-20 flex flex-col items-center justify-center text-center px-8 pointer-events-none"
              >
                {/* Overline */}
                <p
                  className="tracking-[0.45em] uppercase mb-10"
                  style={{
                    fontSize: "0.6rem",
                    color: "rgba(242,209,109,0.6)",
                    fontFamily: "monospace",
                  }}
                >
                  {sectionNumber} — Engagement
                </p>

                {/* Red micro-rule above title */}
                <div
                  className="w-10 h-px mb-8"
                  style={{ background: "#c0392b" }}
                />

                {/* Main CTA title */}
                <h2
                  className="font-display font-extralight leading-[1.1] mb-4"
                  style={{
                    fontSize: "clamp(2rem, 6.5vw, 5.5rem)",
                    color: "#ece8df",
                    letterSpacing: "-0.01em",
                  }}
                >
                  {section.title}
                  <br />
                  <span style={{ color: "#c0392b" }}>{section.subtitle}</span>
                </h2>

                {/* Description */}
                <p
                  className="font-light max-w-xl mb-12 leading-relaxed"
                  style={{
                    fontSize: "clamp(0.8rem, 1.3vw, 0.95rem)",
                    color: "rgba(236,232,223,0.55)",
                    letterSpacing: "0.02em",
                    lineHeight: "1.8",
                  }}
                >
                  {section.description}
                </p>

                {/* CTA: Sign in or Go to Globe when logged in */}
                <motion.button
                  onClick={() =>
                    setActiveTab(isAuthenticated ? "globe" : "login")
                  }
                  className="pointer-events-auto relative group overflow-hidden"
                  style={{ padding: "0.85rem 3rem" }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <span
                    className="absolute inset-0"
                    style={{
                      border: "1px solid rgba(236,232,223,0.35)",
                      transition: "border-color 0.3s",
                    }}
                  />
                  <span
                    className="absolute inset-0 translate-x-full group-hover:translate-x-0 transition-transform duration-300"
                    style={{
                      background: "#c0392b",
                    }}
                  />
                  <span
                    className="relative z-10 font-light tracking-[0.3em] uppercase text-[#ece8df] group-hover:text-white"
                    style={{
                      fontSize: "0.7rem",
                      transition: "color 0.3s",
                    }}
                  >
                    {isAuthenticated ?
                      "Go to Globe Analysis"
                    : "Request Access"}
                  </span>
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {/* /sticky panel */}
      </div>
      {/* /animation wrapper */}

      {/* ── Subscription section — normal document flow below the animation ── */}
      <SubscriptionSection />
    </> // /fragment
  );
}
