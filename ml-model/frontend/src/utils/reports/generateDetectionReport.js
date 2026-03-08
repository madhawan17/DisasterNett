import {
  newDoc,
  drawPageHeader,
  drawSectionHeader,
  drawKeyValue,
  drawMetricBox,
  drawAlertBadge,
  drawPageFooter,
  savePDF,
  C,
  MARGIN,
  PAGE_W,
  CONTENT_W,
} from "./pdfUtils.js";

export function generateDetectionReport(result, geocoded) {
  const doc = newDoc();

  // ── Page 1 ──────────────────────────────────────────────────────
  let y = drawPageHeader(doc, "DETECTION");
  drawPageFooter(doc);

  // Region name banner
  const regionName = geocoded?.display_name ?? "Unknown Region";
  doc.setFont("Courier", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...C.creamDim);
  doc.text("ANALYSIS TARGET:", MARGIN, y);
  doc.setFont("Courier", "bold");
  doc.setTextColor(...C.cream);
  doc.text(regionName, MARGIN + 38, y);
  y += 8;

  // ── Section 1: FLOOD RISK FORECAST ──────────────────────────────
  y = drawSectionHeader(doc, "FLOOD RISK FORECAST", y);

  // Big probability number — amber, 28pt
  const prob = ((result.flood_probability ?? 0) * 100).toFixed(2);
  doc.setFont("Courier", "bold");
  doc.setFontSize(28);
  doc.setTextColor(...C.amber);
  doc.text(prob + "%", MARGIN, y + 10);

  doc.setFont("Courier", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...C.creamDim);
  doc.text("FLOOD PROBABILITY", MARGIN + 22, y + 12);

  // Alert badge — right side of the same row
  drawAlertBadge(
    doc,
    result.alert_level ?? "UNKNOWN",
    PAGE_W - MARGIN - 32,
    y + 8,
  );
  y += 20;

  // Metadata key-value rows
  y = drawKeyValue(doc, "Alert Level", result.alert_level ?? "N/A", y);
  y = drawKeyValue(
    doc,
    "Forecast Window",
    (result.forecast_horizon_hours ?? "—") + " hours",
    y,
  );
  y = drawKeyValue(doc, "Peak Flood Est.", result.peak_flood_time ?? "N/A", y);
  y = drawKeyValue(
    doc,
    "Latest Data Timestamp",
    result.based_on_data_until ?? "N/A",
    y,
  );
  y += 4;

  // ── Section 2: METEOROLOGICAL FEATURES ──────────────────────────
  y = drawSectionHeader(doc, "METEOROLOGICAL FEATURES", y);

  // 2x3 metric box grid
  const bw = CONTENT_W / 2 - 2;
  const bh = 18;
  const fs = result.features_snapshot ?? {};

  const boxes = [
    {
      label: "Precipitation",
      value: Math.round(fs.Precipitation_mm ?? 0) + " mm",
      color: C.ice,
    },
    {
      label: "Soil Moisture",
      value: (fs.Soil_Moisture ?? 0).toFixed(2),
      color: [139, 111, 71],
    },
    {
      label: "Temperature",
      value: Math.round(fs.Temperature_C ?? 0) + " °C",
      color: C.amber,
    },
    {
      label: "Elevation",
      value: Math.round(fs.Elevation_m ?? 0) + " m",
      color: C.creamDim,
    },
    {
      label: "Rain (24H)",
      value: Math.round(fs.Rain_24h ?? 0) + " mm",
      color: [212, 144, 10],
    },
    {
      label: "Rain (12H)",
      value: Math.round(fs.Rain_12h ?? 0) + " mm",
      color: [232, 163, 56],
    },
  ];

  boxes.forEach((box, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const bx = MARGIN + col * (bw + 4);
    const by = y + row * (bh + 3);
    drawMetricBox(doc, box.label, box.value, bx, by, bw, bh, box.color);
  });

  savePDF(doc, `AMBROSIA_Detection_${Date.now()}.pdf`);
}
