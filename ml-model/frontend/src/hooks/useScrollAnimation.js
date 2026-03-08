import { useState, useEffect, useRef } from "react";

/**
 * useScrollAnimation — Apple-style passive scroll + rAF LERP with
 * optional non-linear keyframe mapping for variable section speed.
 *
 * keyframes: [[scrollFraction, frameIndex], ...]
 *   Allows text-heavy sections to occupy more scroll distance (feel slower)
 *   while pure animation sections feel snappier.
 *   Example: [[0, 0], [0.15, 39], [0.35, 79], [1.0, 239]]
 *              ↑ hero fast    ↑ doctrine slow
 *
 * @param {number}   totalFrames  - Total frames (default 240)
 * @param {number}   scrollHeight - Virtual scroll height in px (null = 4×vh)
 * @param {number}   ease         - LERP factor 0.06–0.15 (default 0.10)
 * @param {Array}    keyframes    - [[scrollFraction, frameIndex], ...] or null
 */
export function useScrollAnimation(
  totalFrames = 240,
  scrollHeight = null,
  ease = 0.1,
  keyframes = null,
) {
  const [currentFrame, setCurrentFrame] = useState(0);
  const [scrollProgress, setScrollProgress] = useState(0);

  const targetFrameRef = useRef(0);
  const currentFrameRef = useRef(0);
  const rawProgressRef = useRef(0);
  const rafRef = useRef(null);
  const easeRef = useRef(ease);
  easeRef.current = ease;

  // ── Piecewise-linear interpolation through keyframes ─────────────────
  const mapScrollToFrame = (progress, kf) => {
    if (!kf || kf.length < 2) return progress * (totalFrames - 1);
    for (let i = 0; i < kf.length - 1; i++) {
      const [s0, f0] = kf[i];
      const [s1, f1] = kf[i + 1];
      if (progress <= s1) {
        const t = s1 === s0 ? 0 : (progress - s0) / (s1 - s0);
        return f0 + t * (f1 - f0);
      }
    }
    return kf[kf.length - 1][1];
  };

  useEffect(() => {
    const getScrollHeight = () => scrollHeight ?? window.innerHeight * 4;

    // ── Passive scroll listener ──────────────────────────────────────────
    // ONLY records target. Never paints. Never blocks compositor.
    const handleScroll = () => {
      const maxScroll = getScrollHeight();
      const raw = Math.max(0, Math.min(1, window.scrollY / maxScroll));
      rawProgressRef.current = raw;
      targetFrameRef.current = mapScrollToFrame(raw, keyframes);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    // ── rAF loop: LERP currentFrame toward target ────────────────────────
    const tick = () => {
      const target = targetFrameRef.current;
      const current = currentFrameRef.current;
      const delta = target - current;

      if (Math.abs(delta) > 0.01) {
        const next = current + delta * easeRef.current;
        currentFrameRef.current = next;
        setCurrentFrame(Math.round(next));
        setScrollProgress(rawProgressRef.current);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [totalFrames, scrollHeight, keyframes]); // eslint-disable-line react-hooks/exhaustive-deps

  return { currentFrame, scrollProgress };
}
