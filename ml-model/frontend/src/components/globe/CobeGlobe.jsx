import React, { useEffect, useRef } from "react";
import createGlobe from "cobe";
import { motion } from "framer-motion";
import { Crosshair, Activity } from "lucide-react";

const MARKERS = {
  delhi: { location: [28.6139, 77.209], size: 0.08 },
  newYork: { location: [40.7128, -74.006], size: 0.05 },
  london: { location: [51.5074, -0.1278], size: 0.05 },
  sydney: { location: [-33.8688, 151.2093], size: 0.06 },
  tokyo: { location: [35.6762, 139.6503], size: 0.07 },
  saoPaulo: { location: [-23.5505, -46.6333], size: 0.05 },
  singapore: { location: [1.3521, 103.8198], size: 0.05 },
};

const ROUTES = [
  {
    id: "route-1",
    startKey: "newYork",
    endKey: "london",
    speed: 0.18,
    phase: 0,
  },
  {
    id: "route-2",
    startKey: "london",
    endKey: "delhi",
    speed: 0.13,
    phase: 0.12,
  },
  {
    id: "route-3",
    startKey: "delhi",
    endKey: "singapore",
    speed: 0.14,
    phase: 0.26,
  },
  {
    id: "route-4",
    startKey: "singapore",
    endKey: "tokyo",
    speed: 0.15,
    phase: 0.4,
  },
  {
    id: "route-5",
    startKey: "tokyo",
    endKey: "sydney",
    speed: 0.16,
    phase: 0.54,
  },
  {
    id: "route-6",
    startKey: "newYork",
    endKey: "delhi",
    speed: 0.11,
    phase: 0.68,
  },
  {
    id: "route-7",
    startKey: "saoPaulo",
    endKey: "london",
    speed: 0.1,
    phase: 0.8,
  },
  {
    id: "route-8",
    startKey: "saoPaulo",
    endKey: "newYork",
    speed: 0.12,
    phase: 0.92,
  },
];

const VIEWBOX_SIZE = 1000;
const GLOBE_CENTER = VIEWBOX_SIZE / 2;
const GLOBE_RADIUS = 365;
const ROUTE_ARC_HEIGHT = 0.16;
const ROUTE_SAMPLES = 36;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

function latLonToCartesian([lat, lon]) {
  const latRad = toRadians(lat);
  const lonRad = toRadians(lon);

  return {
    x: Math.cos(latRad) * Math.sin(lonRad),
    y: Math.sin(latRad),
    z: Math.cos(latRad) * Math.cos(lonRad),
  };
}

function rotatePoint(point, phi, theta) {
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const cosTheta = Math.cos(theta);
  const sinTheta = Math.sin(theta);

  const x1 = point.x * cosPhi + point.z * sinPhi;
  const z1 = point.z * cosPhi - point.x * sinPhi;
  const y1 = point.y * cosTheta - z1 * sinTheta;
  const z2 = point.y * sinTheta + z1 * cosTheta;

  return { x: x1, y: y1, z: z2 };
}

function projectPoint(point, phi, theta) {
  const rotated = rotatePoint(point, phi, theta);

  return {
    x: GLOBE_CENTER + rotated.x * GLOBE_RADIUS,
    y: GLOBE_CENTER - rotated.y * GLOBE_RADIUS,
    visible: rotated.z > 0,
  };
}

function interpolateArcPoint(start, end, t) {
  const startVec = latLonToCartesian(start);
  const endVec = latLonToCartesian(end);
  const dot =
    startVec.x * endVec.x +
    startVec.y * endVec.y +
    startVec.z * endVec.z;
  const omega = Math.acos(clamp(dot, -1, 1));

  let point;
  if (omega < 1e-5) {
    point = {
      x: startVec.x,
      y: startVec.y,
      z: startVec.z,
    };
  } else {
    const sinOmega = Math.sin(omega);
    const scaleA = Math.sin((1 - t) * omega) / sinOmega;
    const scaleB = Math.sin(t * omega) / sinOmega;

    point = {
      x: startVec.x * scaleA + endVec.x * scaleB,
      y: startVec.y * scaleA + endVec.y * scaleB,
      z: startVec.z * scaleA + endVec.z * scaleB,
    };
  }

  const lift = 1 + Math.sin(Math.PI * t) * ROUTE_ARC_HEIGHT;
  return {
    x: point.x * lift,
    y: point.y * lift,
    z: point.z * lift,
  };
}

function buildRoutePath(start, end, phi, theta) {
  const points = [];
  for (let i = 0; i <= ROUTE_SAMPLES; i += 1) {
    const t = i / ROUTE_SAMPLES;
    const projected = projectPoint(interpolateArcPoint(start, end, t), phi, theta);
    points.push(projected);
  }

  let path = "";
  let started = false;

  points.forEach((point) => {
    if (!point.visible) {
      started = false;
      return;
    }

    path += `${started ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)} `;
    started = true;
  });

  return path.trim();
}

export default function CobeGlobe({ className = "" }) {
  const canvasRef = useRef();
  const outlineLayerRef = useRef(null);
  const routePathRefs = useRef([]);
  const routeGlowRefs = useRef([]);
  const routeStartRefs = useRef([]);
  const routeStartHaloRefs = useRef([]);
  const routeEndRefs = useRef([]);
  const routeEndHaloRefs = useRef([]);
  const routeTracerRefs = useRef([]);
  const routeTracerHaloRefs = useRef([]);
  const pointerInteracting = useRef(null);
  const pointerInteractionMovement = useRef(0);
  const rotationRef = useRef(0);

  useEffect(() => {
    let width = 0;

    const onResize = () => {
      if (canvasRef.current) {
        width = canvasRef.current.offsetWidth;
      }
    };

    window.addEventListener("resize", onResize);
    onResize();

    const globe = createGlobe(canvasRef.current, {
      devicePixelRatio: 2,
      width: width * 2,
      height: width * 2,
      phi: 0,
      theta: 0.28,
      dark: 1,
      diffuse: 1.2,
      scale: 1,
      mapSamples: 20000,
      mapBrightness: 8,
      baseColor: [0.07, 0.15, 0.11],
      markerColor: [0.1, 0.8, 0.1],
      glowColor: [0.12, 0.7, 0.32],
      offset: [0, 0],
      markers: Object.values(MARKERS),
      onRender: (state) => {
        if (!pointerInteracting.current) {
          rotationRef.current += 0.005;
        }

        const phi = rotationRef.current + pointerInteractionMovement.current * 0.01;
        state.phi = phi;
        state.width = width * 2;
        state.height = width * 2;
        if (outlineLayerRef.current) {
          outlineLayerRef.current.style.transform = `translateX(${Math.sin(phi) * 8}%) scaleX(${0.96 + Math.cos(phi * 0.5) * 0.02})`;
        }

        const now = performance.now() / 1000;
        ROUTES.forEach((route, index) => {
          const startLocation = MARKERS[route.startKey]?.location;
          const endLocation = MARKERS[route.endKey]?.location;
          if (!startLocation || !endLocation) return;

          const path = buildRoutePath(startLocation, endLocation, phi, state.theta ?? 0.28);
          const pathVisible = path.length > 0;

          if (routeGlowRefs.current[index]) {
            routeGlowRefs.current[index].setAttribute("d", path);
            routeGlowRefs.current[index].style.opacity = pathVisible ? "1" : "0";
          }

          if (routePathRefs.current[index]) {
            routePathRefs.current[index].setAttribute("d", path);
            routePathRefs.current[index].style.opacity = pathVisible ? "1" : "0";
          }

          const startPoint = projectPoint(latLonToCartesian(startLocation), phi, state.theta ?? 0.28);
          const endPoint = projectPoint(latLonToCartesian(endLocation), phi, state.theta ?? 0.28);
          const tracerT = (now * route.speed + route.phase) % 1;
          const tracerPoint = projectPoint(
            interpolateArcPoint(startLocation, endLocation, tracerT),
            phi,
            state.theta ?? 0.28,
          );

          const startVisible = startPoint.visible ? "1" : "0";
          const endVisible = endPoint.visible ? "1" : "0";
          const tracerVisible = tracerPoint.visible ? "1" : "0";

          [routeStartRefs.current[index], routeStartHaloRefs.current[index]].forEach((node) => {
            if (!node) return;
            node.setAttribute("cx", startPoint.x.toFixed(1));
            node.setAttribute("cy", startPoint.y.toFixed(1));
            node.style.opacity = startVisible;
          });

          [routeEndRefs.current[index], routeEndHaloRefs.current[index]].forEach((node) => {
            if (!node) return;
            node.setAttribute("cx", endPoint.x.toFixed(1));
            node.setAttribute("cy", endPoint.y.toFixed(1));
            node.style.opacity = endVisible;
          });

          [routeTracerRefs.current[index], routeTracerHaloRefs.current[index]].forEach((node) => {
            if (!node) return;
            node.setAttribute("cx", tracerPoint.x.toFixed(1));
            node.setAttribute("cy", tracerPoint.y.toFixed(1));
            node.style.opacity = tracerVisible;
          });
        });
      },
    });

    return () => {
      window.removeEventListener("resize", onResize);
      globe.destroy();
    };
  }, []);

  return (
    <div className={`relative mx-auto aspect-square w-full max-w-[600px] ${className}`}>
      <div className="absolute inset-0 -z-10 animate-pulse rounded-full bg-green-500/20 blur-[100px] mix-blend-screen" />
      <div className="absolute inset-10 -z-10 rounded-full bg-emerald-400/10 blur-[60px] mix-blend-screen" />

      <div className="absolute inset-[-10%] -z-10 rounded-full border border-green-500/10" />
      <div className="absolute inset-[-20%] -z-10 rounded-full border border-dashed border-green-500/10 opacity-50 animate-[spin_40s_linear_infinite]" />

      <canvas
        ref={canvasRef}
        className="relative z-0 h-full w-full cursor-grab drop-shadow-[0_0_15px_rgba(34,197,94,0.3)] active:cursor-grabbing"
        onPointerDown={(e) => {
          pointerInteracting.current = e.clientX - pointerInteractionMovement.current;
          canvasRef.current.style.cursor = "grabbing";
        }}
        onPointerUp={() => {
          pointerInteracting.current = null;
          canvasRef.current.style.cursor = "grab";
        }}
        onPointerOut={() => {
          pointerInteracting.current = null;
          canvasRef.current.style.cursor = "grab";
        }}
        onMouseMove={(e) => {
          if (pointerInteracting.current !== null) {
            const delta = e.clientX - pointerInteracting.current;
            pointerInteractionMovement.current = delta;
            rotationRef.current += delta * 0.0025;
          }
        }}
        onTouchMove={(e) => {
          if (pointerInteracting.current !== null && e.touches[0]) {
            const delta = e.touches[0].clientX - pointerInteracting.current;
            pointerInteractionMovement.current = delta;
            rotationRef.current += delta * 0.0025;
          }
        }}
      />

      <div className="pointer-events-none absolute inset-[12%] z-10 overflow-hidden rounded-full">
        <div
          ref={outlineLayerRef}
          className="absolute inset-x-[-32%] inset-y-[10%] opacity-90"
          style={{ transform: "translateX(0%) scaleX(0.96)" }}
        >
          <svg
            viewBox="0 0 1000 520"
            className="h-full w-[164%] text-emerald-300/75 drop-shadow-[0_0_14px_rgba(110,231,183,0.42)]"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <filter id="jump-line-glow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <g stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M72 158c27-31 74-48 119-42 39 6 59 34 88 47 25 11 51 9 67 28 17 20 12 49-9 64-16 11-38 11-53 24-16 14-19 39-36 52-20 15-50 15-74 8-23-8-39-24-54-41-16-17-34-34-40-57-8-31 4-65-8-94z" />
              <path d="M286 110c32-19 79-18 110 2 16 10 25 28 42 37 18 10 42 9 56 24 12 14 14 37 4 53-13 21-41 26-61 39-22 15-30 42-50 58-18 15-44 22-67 17-30-6-49-31-72-52-21-19-48-36-54-63-7-32 11-67 39-86 17-12 36-18 53-29z" />
              <path d="M470 152c24-27 59-45 95-45 31 0 63 14 81 39 14 19 20 43 35 60 16 18 40 29 45 52 5 24-13 49-38 57-20 7-42 4-61 13-24 10-39 32-59 48-21 16-47 28-74 25-31-3-59-26-72-54-10-22-11-46-7-70 3-20 10-39 24-54 10-11 22-20 31-31z" />
              <path d="M640 138c22-17 56-22 81-10 24 12 39 36 61 50 16 10 36 14 47 30 11 15 12 37 3 53-10 19-31 30-48 43-17 13-28 31-44 46-18 17-40 33-65 34-30 2-59-17-74-43-16-28-17-64-3-93 10-20 25-37 42-50z" />
              <path d="M776 207c17-14 44-18 63-8 17 9 26 28 35 44 10 16 24 29 28 47 4 18-5 38-20 49-17 12-39 14-59 20-19 6-38 18-58 14-28-4-50-31-50-59 0-20 11-38 23-54 12-15 22-35 38-53z" />
              <path d="M815 353c12-8 30-10 43-3 11 7 18 19 24 31 6 11 15 21 17 33 3 14-3 29-14 38-13 10-31 11-47 14-14 3-29 10-43 6-21-5-36-27-34-48 1-15 10-28 19-39 9-11 18-25 35-32z" />
            </g>
            <g stroke="#a7f3d0" strokeOpacity="0.28" strokeWidth="1">
              <path d="M95 122c104 27 206 33 306 20 105-13 204-42 306-41 78 1 154 19 228 52" />
              <path d="M57 258c113 18 225 18 337 1 110-16 219-41 331-42 87 0 175 16 259 47" />
              <path d="M109 382c98 18 196 20 294 8 96-11 190-33 287-38 95-4 191 8 281 36" />
            </g>
          </svg>
        </div>
        <div className="absolute inset-0 rounded-full border border-emerald-300/20 shadow-[inset_0_0_30px_rgba(16,185,129,0.12)]" />
      </div>

      <div className="pointer-events-none absolute inset-0 z-20 rounded-full mix-blend-screen">
        <svg
            viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
            className="h-full w-full"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <filter id="route-glow-top" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="6" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <clipPath id="route-clip">
              <circle cx={GLOBE_CENTER} cy={GLOBE_CENTER} r={GLOBE_RADIUS} />
            </clipPath>
            <g clipPath="url(#route-clip)">
            {ROUTES.map((route, index) => (
              <g key={route.id}>
                <path
                  ref={(node) => {
                    routeGlowRefs.current[index] = node;
                  }}
                  d=""
                  stroke="#22c55e"
                  strokeOpacity="0.32"
                  strokeWidth="16"
                  strokeLinecap="round"
                  fill="none"
                  filter="url(#route-glow-top)"
                />
                <path
                  ref={(node) => {
                    routePathRefs.current[index] = node;
                  }}
                  d=""
                  stroke="#86efac"
                  strokeOpacity="0.7"
                  strokeWidth="4"
                  strokeLinecap="round"
                  fill="none"
                />
                <circle ref={(node) => { routeStartHaloRefs.current[index] = node; }} r="16" fill="#22c55e" fillOpacity="0.22" />
                <circle ref={(node) => { routeStartRefs.current[index] = node; }} r="7" fill="#4ade80" />
                <circle ref={(node) => { routeEndHaloRefs.current[index] = node; }} r="16" fill="#22c55e" fillOpacity="0.22" />
                <circle ref={(node) => { routeEndRefs.current[index] = node; }} r="7" fill="#4ade80" />
                <circle ref={(node) => { routeTracerHaloRefs.current[index] = node; }} r="12" fill="#22c55e" fillOpacity="0.2" />
                <circle ref={(node) => { routeTracerRefs.current[index] = node; }} r="5.2" fill="#dcfce7" />
              </g>
            ))}
            </g>
          </svg>
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.9, x: 20 }}
        animate={{ opacity: 1, scale: 1, x: 0 }}
        transition={{ delay: 0.5, duration: 0.8 }}
        className="absolute top-8 -right-4 z-30 flex min-w-[180px] flex-col gap-2 rounded-2xl border border-gray-100 bg-white/90 p-4 shadow-xl backdrop-blur-md sm:-right-12"
      >
        <div className="mb-1 flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500"></span>
          </span>
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Global Scan Active</span>
        </div>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-2xl font-black leading-none text-gray-900">14.2K</p>
            <p className="mt-0.5 text-xs font-semibold text-gray-500">Live Telemetry Nodes</p>
          </div>
          <Activity className="mb-1 h-5 w-5 text-green-500" />
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, scale: 0.9, x: -20 }}
        animate={{ opacity: 1, scale: 1, x: 0 }}
        transition={{ delay: 0.8, duration: 0.8 }}
        className="absolute bottom-16 -left-4 z-30 flex w-48 flex-col gap-1 rounded-2xl border border-gray-700 bg-gray-900/90 p-4 shadow-2xl backdrop-blur-md sm:-left-8"
      >
        <div className="mb-1 flex items-center gap-2 text-green-400">
          <Crosshair className="h-4 w-4" />
          <span className="font-mono text-[10px] uppercase tracking-widest">Lock-on Sequence</span>
        </div>
        <div className="font-mono text-xs text-gray-300">
          LAT: <span className="font-bold text-white">28.6139° N</span>
        </div>
        <div className="font-mono text-xs text-gray-300">
          LON: <span className="font-bold text-white">77.2090° E</span>
        </div>
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-gray-800">
          <motion.div
            initial={{ width: "0%" }}
            animate={{ width: "100%" }}
            transition={{ duration: 2, repeat: Infinity }}
            className="h-full bg-green-500"
          />
        </div>
      </motion.div>
    </div>
  );
}
