import React, { useEffect, useRef } from "react";
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { useGlobeStore } from "../../stores/globeStore.js";
import { useRiskStore } from "../../stores/riskStore.js";
import { useLifelineStore } from "../../stores/lifelineStore.js";

const SEVERITY_CFG = {
  critical: {
    fill: new Cesium.Color(0.85, 0.25, 0.25, 0.55),
    outline: new Cesium.Color(0.85, 0.25, 0.25, 1.0),
    extrude: 3500,
  },
  high: {
    fill: new Cesium.Color(0.82, 0.41, 0.16, 0.5),
    outline: new Cesium.Color(0.82, 0.41, 0.16, 1.0),
    extrude: 2500,
  },
  medium: {
    fill: new Cesium.Color(0.78, 0.63, 0.09, 0.42),
    outline: new Cesium.Color(0.78, 0.63, 0.09, 1.0),
    extrude: 1500,
  },
  low: {
    fill: new Cesium.Color(0.22, 0.63, 0.35, 0.35),
    outline: new Cesium.Color(0.22, 0.63, 0.35, 1.0),
    extrude: 600,
  },
};

export default function CesiumGlobe() {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const isRotatingRef = useRef(true);

  const geocoded = useGlobeStore((s) => s.geocoded);
  const result = useGlobeStore((s) => s.result);
  const districtSummaries = useRiskStore((s) => s.districtSummaries);
  const lifelineData = useLifelineStore((s) => s.data);

  // ──────────────────────────────────────────────────────────
  // 1. INIT VIEWER
  // ──────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container || viewerRef.current) return;

    let cancelled = false;
    let resizeObs = null;
    let stopSpin = () => {};

    async function initViewer() {
      if (viewerRef.current || cancelled) return;
      const rect = container.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;

      // ── Cesium Ion token (optional — enables Bing Maps satellite) ──
      const token = import.meta.env.VITE_CESIUM_TOKEN || "";
      const hasToken =
        token.length > 10 && token !== "your_cesium_ion_token_here";
      if (hasToken) Cesium.Ion.defaultAccessToken = token;

      // ── Build the base imagery layer ──
      // Cesium 1.104+ uses ImageryLayer.fromWorldImagery / baseLayer instead
      // of the deprecated createWorldImagery / imageryProvider constructor opts.
      let baseLayer = false;
      if (hasToken) {
        try {
          baseLayer = Cesium.ImageryLayer.fromWorldImagery({
            style: Cesium.IonWorldImageryStyle.AERIAL_WITH_LABELS,
          });
        } catch {
          baseLayer = false;
        }
      }

      // If no Ion token or Ion failed, use the bundled NaturalEarthII tiles
      if (!baseLayer) {
        try {
          const provider = await Cesium.TileMapServiceImageryProvider.fromUrl(
            Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII"),
          );
          if (cancelled) return;
          baseLayer = new Cesium.ImageryLayer(provider);
        } catch {
          baseLayer = false;
        }
      }
      if (cancelled) return;

      const viewer = new Cesium.Viewer(container, {
        baseLayer,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        animation: false,
        timeline: false,
        fullscreenButton: false,
        selectionIndicator: false,
        infoBox: false,
        creditContainer: (() => {
          const el = document.createElement("div");
          el.style.display = "none";
          return el;
        })(),
        scene3DOnly: true,
        orderIndependentTranslucency: false,
      });

      if (cancelled) {
        viewer.destroy();
        return;
      }

      const scene = viewer.scene;
      const globe = scene.globe;

      // ── Space background ──
      scene.backgroundColor = new Cesium.Color(0.027, 0.035, 0.055, 1.0);
      scene.moon = new Cesium.Moon({ show: false });

      // ── Globe appearance ──
      globe.show = true;
      globe.showWaterEffect = true;
      globe.enableLighting = true;
      globe.dynamicAtmosphereLighting = true;
      globe.dynamicAtmosphereLightingFromSun = true;
      globe.atmosphereLightIntensity = 8.0;
      globe.atmosphereRayleighCoefficient = new Cesium.Cartesian3(
        5.5e-6,
        13.0e-6,
        28.4e-6,
      );
      globe.atmosphereMieCoefficient = new Cesium.Cartesian3(
        21e-6,
        21e-6,
        21e-6,
      );
      globe.nightFadeOutDistance = 1e10;
      globe.nightFadeInDistance = 5e8;
      globe.translucency.enabled = false;

      // ── Atmosphere glow ──
      scene.skyAtmosphere.show = true;
      scene.skyAtmosphere.atmosphereLightIntensity = 25.0;
      scene.skyAtmosphere.atmosphereRayleighCoefficient = new Cesium.Cartesian3(
        5.5e-6,
        13.0e-6,
        28.4e-6,
      );
      scene.skyAtmosphere.atmosphereMieCoefficient = new Cesium.Cartesian3(
        21e-6,
        21e-6,
        21e-6,
      );
      scene.skyAtmosphere.atmosphereMieAnisotropy = 0.9;
      scene.skyAtmosphere.hueShift = 0.0;
      scene.skyAtmosphere.saturationShift = 0.0;
      scene.skyAtmosphere.brightnessShift = -0.05;

      // ── Star field ──
      scene.skyBox = new Cesium.SkyBox({
        sources: {
          positiveX: Cesium.buildModuleUrl(
            "Assets/Textures/SkyBox/tycho2t3_80_px.jpg",
          ),
          negativeX: Cesium.buildModuleUrl(
            "Assets/Textures/SkyBox/tycho2t3_80_mx.jpg",
          ),
          positiveY: Cesium.buildModuleUrl(
            "Assets/Textures/SkyBox/tycho2t3_80_py.jpg",
          ),
          negativeY: Cesium.buildModuleUrl(
            "Assets/Textures/SkyBox/tycho2t3_80_my.jpg",
          ),
          positiveZ: Cesium.buildModuleUrl(
            "Assets/Textures/SkyBox/tycho2t3_80_pz.jpg",
          ),
          negativeZ: Cesium.buildModuleUrl(
            "Assets/Textures/SkyBox/tycho2t3_80_mz.jpg",
          ),
        },
      });

      // ── Clock: freeze at noon UTC so the lit side faces camera ──
      const now = new Date();
      now.setUTCHours(12, 0, 0, 0);
      viewer.clock.currentTime = Cesium.JulianDate.fromDate(now);
      viewer.clock.shouldAnimate = false;

      // ── Render quality ──
      scene.postProcessStages.fxaa.enabled = true;
      viewer.resolutionScale = window.devicePixelRatio > 1 ? 1.5 : 1.0;
      scene.highDynamicRange = false;

      // ── Auto-rotation ──
      scene.preRender.addEventListener(() => {
        if (isRotatingRef.current) {
          scene.camera.rotate(Cesium.Cartesian3.UNIT_Z, -0.00012);
        }
      });

      // ── Initial camera ──
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(30, 15, 22_000_000),
        orientation: {
          heading: Cesium.Math.toRadians(0),
          pitch: Cesium.Math.toRadians(-90),
          roll: 0,
        },
      });

      // ── Stop rotation on user interaction ──
      stopSpin = () => {
        isRotatingRef.current = false;
      };
      scene.screenSpaceCameraController.inertiaSpin = 0.9;
      scene.screenSpaceCameraController.inertiaZoom = 0.8;
      scene.screenSpaceCameraController.inertiaTranslate = 0.9;
      viewer.camera.moveStart.addEventListener(stopSpin);

      viewerRef.current = viewer;
    }

    // Defer one frame so the container is laid out, then use ResizeObserver as fallback
    const rafId = requestAnimationFrame(() => {
      initViewer();
    });
    resizeObs = new ResizeObserver(() => {
      if (!viewerRef.current) {
        initViewer();
      } else if (!viewerRef.current.isDestroyed()) {
        viewerRef.current.resize();
      }
    });
    resizeObs.observe(container);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      resizeObs?.disconnect();
      const v = viewerRef.current;
      if (v) {
        try {
          v.camera.moveStart.removeEventListener(stopSpin);
        } catch (_) {}
        if (!v.isDestroyed()) v.destroy();
        viewerRef.current = null;
      }
    };
  }, []);

  // ──────────────────────────────────────────────────────────
  // 2. FLY TO GEOCODED REGION
  // ──────────────────────────────────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    ["region-boundary", "region-pin"].forEach((name) => {
      viewer.dataSources
        .getByName(name)
        .forEach((ds) => viewer.dataSources.remove(ds));
    });
    viewer.entities.removeById("region-center-pin");
    viewer.entities.removeById("region-boundary-bbox");

    if (!geocoded) {
      isRotatingRef.current = true;
      return;
    }

    isRotatingRef.current = false;

    const { lat, lon, bbox } = geocoded;
    const flyOptions = {
      duration: 2.2,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    };

    if (bbox?.length === 4) {
      viewer.camera.flyTo({
        ...flyOptions,
        destination: Cesium.Rectangle.fromDegrees(
          bbox[0] - 0.5,
          bbox[1] - 0.5,
          bbox[2] + 0.5,
          bbox[3] + 0.5,
        ),
      });
    } else {
      viewer.camera.flyTo({
        ...flyOptions,
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, 800_000),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-45), roll: 0 },
      });
    }

    // Determine the color based on if we have a result. If we have a result, color it the alert color. Otherwise green.
    let baseColor = Cesium.Color.fromCssColorString("#16a34a");
    let outlineAlpha = 1.0;
    let fillAlpha = 0.35;

    if (result && result.alert_level) {
      const ALERT_COLORS = {
        LOW: "#22c55e",
        MEDIUM: "#f2d16d",
        HIGH: "#dc7828",
        CRITICAL: "#c0392b",
      };
      baseColor = Cesium.Color.fromCssColorString(
        ALERT_COLORS[result.alert_level] ?? "#f2d16d",
      );
      outlineAlpha = 0.8;
      fillAlpha = 0.5;
    }

    const currentEdge = baseColor.withAlpha(outlineAlpha);
    const currentFill = baseColor.withAlpha(fillAlpha);

    const hasAreaGeometry =
      geocoded.boundary_geojson &&
      ["Polygon", "MultiPolygon"].includes(geocoded.boundary_geojson.type);

    if (hasAreaGeometry) {
      const boundaryDs = new Cesium.GeoJsonDataSource("region-boundary");
      boundaryDs
        .load(geocoded.boundary_geojson, {
          stroke: currentEdge,
          strokeWidth: 2.5,
          fill: currentFill,
          clampToGround: true,
        })
        .then(() => {
          boundaryDs.entities.values.forEach((entity) => {
            if (entity.polyline) {
              entity.polyline.material =
                new Cesium.PolylineGlowMaterialProperty({
                  glowPower: 0.5,
                  taperPower: 1.0,
                  color: currentEdge,
                });
              entity.polyline.width = 5;
              entity.polyline.clampToGround = true;
              entity.polyline.classificationType =
                Cesium.ClassificationType.TERRAIN;
            }
            if (entity.polygon) {
              entity.polygon.material = currentFill;
              entity.polygon.outline = true;
              entity.polygon.outlineColor = currentEdge;
              entity.polygon.outlineWidth = 2.5;
              entity.polygon.clampToGround = true;
              entity.polygon.classificationType =
                Cesium.ClassificationType.TERRAIN;
            }
          });
          if (!viewer.isDestroyed()) viewer.dataSources.add(boundaryDs);
        });
    }

    // Always show bbox when we don't have a proper polygon (Point/LineString/missing), so the
    // selected region is never just a dot. When we have a polygon, bbox is skipped.
    if (!hasAreaGeometry && geocoded.bbox?.length === 4) {
      const [w, s, e, n] = geocoded.bbox;
      viewer.entities.add({
        id: "region-boundary-bbox",
        rectangle: {
          coordinates: Cesium.Rectangle.fromDegrees(w, s, e, n),
          material: currentFill,
          outline: true,
          outlineColor: currentEdge,
          outlineWidth: 2.5,
        },
      });
    }

    // Centered pin removed so the Forecast logic can claim the spot without overlay clashes.
  }, [geocoded, result]);

  // ──────────────────────────────────────────────────────────
  // 3. RENDER FORECAST RESULT
  // ──────────────────────────────────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return; // Clean up old result entities
    ["flood-zones", "zone-markers"].forEach((name) => {
      viewer.dataSources
        .getByName(name)
        .forEach((ds) => viewer.dataSources.remove(ds));
    });
    viewer.entities.removeById("forecast-pin");

    if (!result) return;

    // Replaced forecast pin with dynamic region boundary coloring.
  }, [result]);

  // ──────────────────────────────────────────────────────────
  // 4. RENDER RISK DASHBOARD DISTRICTS
  // ──────────────────────────────────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    // Clean up old risk districts
    viewer.dataSources
      .getByName("risk-districts")
      .forEach((ds) => viewer.dataSources.remove(ds));

    if (!districtSummaries || districtSummaries.length === 0) return;

    // Create CustomDataSource for districts
    const ds = new Cesium.CustomDataSource("risk-districts");

    // Color mapping by risk classification
    const getColor = (classification) => {
      const lower = classification?.toLowerCase() || "";
      if (lower === "critical")
        return Cesium.Color.fromCssColorString("#c0392b").withAlpha(1.0);
      if (lower === "high")
        return Cesium.Color.fromCssColorString("#dc7828").withAlpha(1.0);
      if (lower === "medium")
        return Cesium.Color.fromCssColorString("#f2d16d").withAlpha(1.0);
      // low or default
      return Cesium.Color.fromCssColorString("#22c55e").withAlpha(1.0);
    };

    // Population scales the radius of the concentric circles
    // e.g. 1,870,000 pop → ~3740m max radius
    const SCALE = 500;
    const MIN_RADIUS = 1000;

    // Track bounds for camera fly-to
    let allWest = Infinity;
    let allSouth = Infinity;
    let allEast = -Infinity;
    let allNorth = -Infinity;

    districtSummaries.forEach((district) => {
      const [west, south, east, north] = district.bbox;
      allWest = Math.min(allWest, west);
      allSouth = Math.min(allSouth, south);
      allEast = Math.max(allEast, east);
      allNorth = Math.max(allNorth, north);

      const color = getColor(district.risk_classification);
      const baseRadius = Math.max(district.population / SCALE, MIN_RADIUS);

      const centerLon = (west + east) / 2;
      const centerLat = (south + north) / 2;

      // Outer Ring
      ds.entities.add({
        id: `risk-district-${district.district_name}-outer`,
        position: Cesium.Cartesian3.fromDegrees(centerLon, centerLat, 0),
        ellipse: {
          semiMinorAxis: baseRadius,
          semiMajorAxis: baseRadius,
          material: color.withAlpha(0.15),
          outline: true,
          outlineColor: color.withAlpha(0.6),
        },
      });

      // Middle Ring
      ds.entities.add({
        id: `risk-district-${district.district_name}-mid`,
        position: Cesium.Cartesian3.fromDegrees(centerLon, centerLat, 5),
        ellipse: {
          semiMinorAxis: baseRadius * 0.6,
          semiMajorAxis: baseRadius * 0.6,
          material: color.withAlpha(0.4),
          outline: true,
          outlineColor: color.withAlpha(1.0),
        },
      });

      // Inner Core + Label
      ds.entities.add({
        id: `risk-district-${district.district_name}-inner`,
        name: district.district_name,
        position: Cesium.Cartesian3.fromDegrees(centerLon, centerLat, 10),
        ellipse: {
          semiMinorAxis: baseRadius * 0.25,
          semiMajorAxis: baseRadius * 0.25,
          material: color.withAlpha(0.95),
          outline: false,
        },
        label: {
          text: district.district_name,
          font: '13px "JetBrains Mono", monospace',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -30),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    });

    // Add data source and fly camera
    viewer.dataSources.add(ds);

    if (
      isFinite(allWest) &&
      isFinite(allEast) &&
      isFinite(allSouth) &&
      isFinite(allNorth)
    ) {
      const centerLon = (allWest + allEast) / 2;
      const centerLat = (allSouth + allNorth) / 2;

      // Calculate dynamic bounds to properly scale the zoom and offsets
      const maxExt = Math.max(allEast - allWest, allNorth - allSouth); // in degrees

      // Calculate an appropriate camera altitude (approx 1 degree = 111km)
      // and offset the camera heavily to the South to create an isometric angle.
      const height = Math.max(maxExt * 111000 * 1.2, 50000);
      const latOffset = maxExt * 1.0; // Shift camera South
      const lonOffset = 0; // Look straight North

      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          centerLon - lonOffset,
          centerLat - latOffset,
          height,
        ),
        orientation: {
          heading: Cesium.Math.toRadians(0), // Look North
          pitch: Cesium.Math.toRadians(-65), // Angle down 65 degrees
          roll: 0.0,
        },
        duration: 2.5,
        easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
      });
    }
  }, [districtSummaries]);

  // ──────────────────────────────────────────────────────────
  // 5. RENDER LIFELINE INFRASTRUCTURE
  // ──────────────────────────────────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    // Clean up old lifeline data
    viewer.dataSources
      .getByName("lifeline-infrastructure")
      .forEach((ds) => viewer.dataSources.remove(ds));

    if (!lifelineData?.geojson?.features) return;

    const ds = new Cesium.CustomDataSource("lifeline-infrastructure");

    function getFeatureStyle(type) {
      switch (type) {
        case "hospital":
          return { color: Cesium.Color.RED, size: 14 };
        case "school":
          return { color: Cesium.Color.DODGERBLUE, size: 12 };
        case "place_of_worship":
          return { color: Cesium.Color.PURPLE, size: 12 };
        case "residential_building":
          return { color: Cesium.Color.LIMEGREEN, size: 8 };
        case "commercial_building":
          return { color: Cesium.Color.GOLD, size: 10 };
        case "building":
          return { color: Cesium.Color.GRAY.withAlpha(0.6), size: 4 };
        default:
          return { color: Cesium.Color.WHITE, size: 6 };
      }
    }

    let allWest = Infinity,
      allEast = -Infinity,
      allSouth = Infinity,
      allNorth = -Infinity;

    lifelineData.geojson.features.forEach((feature) => {
      if (
        feature.geometry.type === "Point" &&
        feature.geometry.coordinates.length >= 2
      ) {
        const [lon, lat] = feature.geometry.coordinates;
        allWest = Math.min(allWest, lon);
        allEast = Math.max(allEast, lon);
        allSouth = Math.min(allSouth, lat);
        allNorth = Math.max(allNorth, lat);

        const props = feature.properties;
        const style = getFeatureStyle(props.feature_type);

        ds.entities.add({
          position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
          point: {
            pixelSize: style.size,
            color: style.color,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: props.feature_type === "building" ? 0.5 : 1.5,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label:
            props.feature_type !== "building" ?
              {
                text: props.name || props.feature_type,
                font: '10px "JetBrains Mono", monospace',
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(0, -15),
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                scaleByDistance: new Cesium.NearFarScalar(100, 1.0, 5000, 0.0), // Fade out labels when zoomed out
              }
            : undefined,
        });
      }
    });

    viewer.dataSources.add(ds);

    if (
      isFinite(allWest) &&
      isFinite(allEast) &&
      isFinite(allSouth) &&
      isFinite(allNorth)
    ) {
      const padding = 0.02;
      viewer.camera.flyTo({
        destination: Cesium.Rectangle.fromDegrees(
          allWest - padding,
          allSouth - padding,
          allEast + padding,
          allNorth + padding,
        ),
        duration: 2.0,
        easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
        orientation: {
          heading: 0,
          pitch: Cesium.Math.toRadians(-75), // Steeper top down for infrastructure parsing
          roll: 0.0,
        },
      });
    }
  }, [lifelineData]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 w-full h-full"
      style={{ background: "#07090e" }}
    />
  );
}
