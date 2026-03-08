import React, { useEffect, useRef, useState, useMemo } from "react";

/**
 * ScrollAnimationViewer — Apple-style canvas frame renderer
 *
 * Architecture (same as apple.com product pages):
 *  1. All frames are fetched and pre-decoded into ImageBitmap objects via
 *     createImageBitmap(). This decodes JPEG off the main thread and uploads
 *     the result directly to the GPU. drawImage(bitmap) is then a near-zero-
 *     cost GPU blit — no decode, no DOM mutation, no layout.
 *
 *  2. A single <canvas> element is used as the rendering surface. The DOM
 *     never changes between frames — only pixels on the GPU layer update.
 *
 *  3. Frame rendering is triggered by the currentFrame prop (driven by
 *     the rAF+LERP loop in useScrollAnimation). When the prop changes,
 *     we call ctx.drawImage() directly — no React re-render, no opacity swap.
 *
 * @param {object}  props
 * @param {number}  props.currentFrame   - Current (possibly lerped) frame index
 * @param {number}  props.totalFrames    - Total frames in sequence (default 240)
 * @param {number}  props.scrollProgress - 0–1 float for HUD elements
 * @param {string}  props.className      - Extra Tailwind classes for root div
 * @param {boolean} props.showOverlay    - Show cinematic vignette overlays
 */
export default function ScrollAnimationViewer({
  currentFrame = 0,
  totalFrames = 240,
  scrollProgress = 0,
  className = "",
  showOverlay = true,
}) {
  const canvasRef = useRef(null);
  const bitmapsRef = useRef([]); // ImageBitmap[] — GPU-ready frames
  const loadedRef = useRef(false);
  const [loadProgress, setLoadProgress] = useState(0); // 0–1
  const [ready, setReady] = useState(false);

  // ── Build frame URL list ─────────────────────────────────────────────
  const framePaths = useMemo(() => {
    return Array.from({ length: totalFrames }, (_, i) => {
      const n = String(i + 1).padStart(3, "0");
      return new URL(
        `../assets/scroll_motion/ezgif-frame-${n}.webp`,
        import.meta.url,
      ).href;
    });
  }, [totalFrames]);

  // ── Preload all frames as ImageBitmaps (off main thread) ─────────────
  //
  //  Strategy: priority-batched, concurrency-limited loading
  //
  //  Phase 1 — "First paint" batch (frames 0–15, up to 8 parallel):
  //    Load the first 16 frames immediately so the canvas can render
  //    frame 0 within ~300ms on a fast connection instead of waiting
  //    for all 240 fetches to queue.
  //
  //  Phase 2 — "Background fill" (frames 16–239, batches of 12):
  //    Load remaining frames in controlled batches. This prevents the
  //    browser's HTTP/1.1 connection pool (6 connections per origin)
  //    from being fully saturated, which would stall ALL fetches.
  //
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    let loaded = 0;
    const bitmaps = new Array(totalFrames).fill(null);

    // Helper: fetch one frame and decode it off the main thread
    const loadFrame = (url, i) =>
      fetch(url)
        .then((res) => res.blob())
        .then((blob) => createImageBitmap(blob))
        .then((bitmap) => {
          bitmaps[i] = bitmap;
          loaded++;
          setLoadProgress(loaded / totalFrames);
          // Always keep bitmapsRef current so drawFrame can access newly-loaded frames
          bitmapsRef.current = bitmaps;
          if (loaded === totalFrames) {
            setReady(true);
          }
        })
        .catch(() => {
          // Fallback for browsers that don't support createImageBitmap (old Safari)
          return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
              bitmaps[i] = img;
              loaded++;
              setLoadProgress(loaded / totalFrames);
              // Always keep bitmapsRef current so drawFrame can access newly-loaded frames
              bitmapsRef.current = bitmaps;
              if (loaded === totalFrames) {
                setReady(true);
              }
              resolve();
            };
            img.onerror = resolve; // don't stall on broken frames
            img.src = url;
          });
        });

    // Helper: run an array of tasks with at most `concurrency` running at once
    const runWithConcurrency = async (tasks, concurrency) => {
      let idx = 0;
      const worker = async () => {
        while (idx < tasks.length) {
          const taskIdx = idx++;
          await tasks[taskIdx]();
        }
      };
      const workers = Array.from(
        { length: Math.min(concurrency, tasks.length) },
        worker,
      );
      await Promise.all(workers);
    };

    const run = async () => {
      // Phase 1 — load first 16 frames (8 parallel) so canvas shows frame 0 ASAP
      const firstBatchEnd = Math.min(16, totalFrames);
      const firstBatchTasks = framePaths
        .slice(0, firstBatchEnd)
        .map((url, i) => () => loadFrame(url, i));
      await runWithConcurrency(firstBatchTasks, 8);

      // ── Early ready: show canvas as soon as first 16 frames are in ────
      // bitmapsRef is already kept live by loadFrame above, so drawFrame
      // works for indexes 0–15 the moment we flip ready → true.
      bitmapsRef.current = bitmaps;
      setReady(true);

      // Phase 2 — load remaining frames 16–239 (12 parallel)
      if (totalFrames > firstBatchEnd) {
        const remainingTasks = framePaths
          .slice(firstBatchEnd)
          .map((url, i) => () => loadFrame(url, firstBatchEnd + i));
        await runWithConcurrency(remainingTasks, 12);
      }
    };

    run();
  }, [framePaths, totalFrames]);

  // Store dpr in a ref so drawFrame always reads the current value
  const dprRef = useRef(Math.min(window.devicePixelRatio || 1, 2));

  // ── Size canvas to container with correct DPR scaling ────────────────
  //
  //  The pattern:
  //    canvas.width/height  = logical CSS size × dpr  (physical pixel buffer)
  //    ctx.scale(dpr, dpr)  = all draw calls auto-scale to physical pixels
  //    canvas CSS width/height stays at logical size  (browser scales back down)
  //
  //  Without ctx.scale the canvas buffer is big but drawImage still operates
  //  in CSS-pixel space, so the image is drawn at 1× and upscaled by the GPU —
  //  exactly the blur we're fixing.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    dprRef.current = Math.min(window.devicePixelRatio || 1, 2);
    const dpr = dprRef.current;

    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      const physW = Math.floor(width * dpr);
      const physH = Math.floor(height * dpr);

      canvas.width = physW;
      canvas.height = physH;

      // Re-apply the scale transform after every resize (it resets on dimension change)
      const ctx = canvas.getContext("2d", { alpha: false });
      ctx.scale(dpr, dpr);

      drawFrame(Math.round(currentFrame));
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Draw frame helper ────────────────────────────────────────────────
  const drawFrame = (frameIndex) => {
    const canvas = canvasRef.current;
    const bitmaps = bitmapsRef.current;
    if (!canvas || !bitmaps.length) return;

    const bitmap = bitmaps[Math.max(0, Math.min(totalFrames - 1, frameIndex))];
    if (!bitmap) return;

    const ctx = canvas.getContext("2d", { alpha: false });

    // ── Quality settings ────────────────────────────────────────────────
    // imageSmoothingQuality "high" → browser uses Lanczos or bicubic resampling
    // instead of the default low-quality bilinear. Dramatically sharper on
    // 720p source images upscaled to a Retina viewport.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Draw into the logical (CSS-pixel) space — ctx.scale handles physical pixels
    const { width, height } = canvas.getBoundingClientRect();
    ctx.drawImage(bitmap, 0, 0, ~~width, ~~height);
  };

  // ── Render current frame whenever prop changes ───────────────────────
  useEffect(() => {
    if (ready) drawFrame(Math.round(currentFrame));
  }, [currentFrame, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── HUD derived values ───────────────────────────────────────────────
  const progressPercent = Math.round(scrollProgress * 100);

  const chapter = useMemo(() => {
    if (scrollProgress < 0.25) return { num: "01", title: "The Awakening" };
    if (scrollProgress < 0.5) return { num: "02", title: "Echoes of the Past" };
    if (scrollProgress < 0.75) return { num: "03", title: "Signal Analysis" };
    return { num: "04", title: "Into the Abyss" };
  }, [scrollProgress]);

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div
      className={`relative w-full h-full overflow-hidden ${className}`}
      style={{ background: "#0a0a0f" }}
    >
      {/* ── Canvas — slides up + fades in from below the moment ready=true ─ */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{
          display: "block",
          imageRendering: "auto",
          opacity: ready ? 1 : 0,
          transform: ready ? "translateY(0)" : "translateY(18px)",
          transition:
            ready ?
              "opacity 420ms cubic-bezier(0.25,0.46,0.45,0.94), transform 420ms cubic-bezier(0.25,0.46,0.45,0.94)"
            : "none",
        }}
        aria-label={`Scroll animation frame ${currentFrame + 1} of ${totalFrames}`}
      />

      {/* ── Preload progress bar (shown while bitmaps are loading) ─────── */}
      {!ready && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center z-20"
          style={{ background: "#0a0a0f" }}
        >
          <p
            className="text-[10px] tracking-[0.4em] uppercase mb-4"
            style={{ color: "#f2d16d", fontFamily: "monospace" }}
          >
            Loading
          </p>
          <div
            className="w-48 h-px"
            style={{ background: "rgba(242,209,109,0.15)" }}
          >
            <div
              className="h-full transition-all duration-150"
              style={{
                width: `${loadProgress * 100}%`,
                background: "#f2d16d",
              }}
            />
          </div>
          <p
            className="mt-3 tabular-nums text-[9px]"
            style={{ color: "rgba(242,209,109,0.4)", fontFamily: "monospace" }}
          >
            {Math.round(loadProgress * totalFrames)}&nbsp;/&nbsp;{totalFrames}
          </p>
        </div>
      )}

      {/* ── Cinematic overlays ─────────────────────────────────────────── */}
      {showOverlay && (
        <>
          {/* Top vignette */}
          <div
            className="absolute inset-x-0 top-0 h-40 pointer-events-none z-10"
            style={{
              background:
                "linear-gradient(to bottom, rgba(10,10,15,0.80) 0%, transparent 100%)",
            }}
          />
          {/* Bottom vignette */}
          <div
            className="absolute inset-x-0 bottom-0 h-48 pointer-events-none z-10"
            style={{
              background:
                "linear-gradient(to top, rgba(10,10,15,0.85) 0%, transparent 100%)",
            }}
          />
          {/* Radial edge vignette */}
          <div
            className="absolute inset-0 pointer-events-none z-10"
            style={{
              background:
                "radial-gradient(ellipse at center, transparent 55%, rgba(10,10,15,0.60) 100%)",
            }}
          />
        </>
      )}

      {/* ── TOP HUD: Scroll hint ───────────────────────────────────────── */}
      {ready && (
        <div className="absolute top-6 inset-x-0 flex flex-col items-center gap-1 pointer-events-none z-20">
          <span
            className="tracking-[0.35em] text-[10px] uppercase animate-pulse"
            style={{ color: "#f2d16d", fontFamily: "monospace" }}
          >
            Scroll to Explore
          </span>
          <svg
            className="w-4 h-4 animate-bounce"
            viewBox="0 0 16 16"
            fill="none"
            stroke="#f2d16d"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 3v10M3 9l5 5 5-5" />
          </svg>
        </div>
      )}

      {/* ── RIGHT HUD: Scroll progress rail ───────────────────────────── */}
      {ready && (
        <div
          className="absolute right-6 top-1/2 -translate-y-1/2 h-40 flex flex-col items-center pointer-events-none z-20"
          aria-hidden="true"
        >
          <div
            className="relative w-px flex-1 rounded-full"
            style={{ background: "rgba(242,209,109,0.20)" }}
          >
            {/* Progress dot — CSS transform, no layout change */}
            <div
              className="absolute left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full"
              style={{
                top: `${progressPercent}%`,
                background: "#f2d16d",
                boxShadow: "0 0 8px 2px rgba(242,209,109,0.5)",
                transition: "top 80ms linear", // fast linear — rAF drives smoothness
              }}
            />
          </div>
          <span
            className="mt-2 tabular-nums text-[9px] tracking-widest"
            style={{ color: "rgba(242,209,109,0.5)", fontFamily: "monospace" }}
          >
            {progressPercent.toString().padStart(3, "0")}
          </span>
        </div>
      )}

      {/* ── BOTTOM-LEFT: Chapter label ─────────────────────────────────── */}
      {ready && (
        <div
          key={chapter.num}
          className="absolute bottom-8 left-8 pointer-events-none z-20 transition-opacity duration-700"
        >
          <p
            className="tracking-[0.3em] text-[9px] uppercase mb-1"
            style={{ color: "#f2d16d", fontFamily: "monospace" }}
          >
            Chapter {chapter.num}
          </p>
          <p
            className="text-base font-light italic"
            style={{
              color: "#e8e0d4",
              fontFamily: "'Georgia', 'Times New Roman', serif",
              letterSpacing: "0.02em",
            }}
          >
            {chapter.title}
          </p>
          <div
            className="mt-1.5 h-px w-10 rounded-full"
            style={{ background: "rgba(242,209,109,0.45)" }}
          />
        </div>
      )}
    </div>
  );
}
