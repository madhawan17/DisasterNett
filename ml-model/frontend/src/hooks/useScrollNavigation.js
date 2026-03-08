import { useState, useEffect, useRef } from "react";

/**
 * Hook for scroll-hijacking: captures scroll input and converts it to section navigation.
 *
 * Fix log:
 *  - scrollAccum moved to a ref (not state) so the wheel handler always reads the
 *    latest value without stale-closure glitches that caused jumpy frame skips.
 *  - scrollSensitivity raised to 600 (was 250) for a slower, more cinematic feel.
 *  - scrollProgress is now derived from raw accumulator for a silky linear mapping,
 *    not snapped to integer section rounding.
 *
 * @param {number} totalSections     - Number of sections to navigate through
 * @param {number} scrollSensitivity - Scroll units required to move one full section.
 *                                     Higher = slower/more deliberate scrolling.
 * @returns {object} { currentSection, scrollProgress, isMoving }
 */
export function useScrollNavigation(
  totalSections = 6,
  scrollSensitivity = 600,
) {
  const accumRef = useRef(0); // ← ref, not state — always fresh in handler
  const maxAccum = scrollSensitivity * (totalSections - 1);

  const [currentSection, setCurrentSection] = useState(0);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [isMoving, setIsMoving] = useState(false);
  const movingTimeout = useRef(null);

  useEffect(() => {
    const handleWheel = (e) => {
      e.preventDefault();

      // Clamp accumulated scroll within [0, maxAccum]
      accumRef.current = Math.max(
        0,
        Math.min(maxAccum, accumRef.current + e.deltaY),
      );

      const rawProgress = accumRef.current / maxAccum; // 0 → 1, smooth
      const sectionFloat = rawProgress * (totalSections - 1); // 0 → N-1, float
      const section = Math.min(
        totalSections - 1,
        Math.floor(sectionFloat + 0.02), // tiny bias prevents flicker at boundaries
      );

      setScrollProgress(rawProgress);
      setCurrentSection(section);
      setIsMoving(true);

      clearTimeout(movingTimeout.current);
      movingTimeout.current = setTimeout(() => setIsMoving(false), 200);
    };

    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      window.removeEventListener("wheel", handleWheel);
      clearTimeout(movingTimeout.current);
    };
  }, [totalSections, maxAccum]); // accumRef is a ref — safe to omit from deps

  return { currentSection, scrollProgress, isMoving };
}
