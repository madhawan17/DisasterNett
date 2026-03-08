import {
  newDoc,
  drawPageHeader,
  drawSectionHeader,
  drawKeyValue,
  drawMetricBox,
  drawAlertBadge,
  drawTable,
  drawPageFooter,
  savePDF,
  wrapText,
  riskColor,
  fillBackground,
  C,
  MARGIN,
  PAGE_W,
  CONTENT_W,
} from './pdfUtils.js'

export function generateInsightsReport(run) {
  const doc = newDoc()

  // ── Page 1 ──────────────────────────────────────────────────────
  let y = drawPageHeader(doc, 'INSIGHTS')
  drawPageFooter(doc)

  // Location + Timestamp banner
  doc.setFont('Courier', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...C.cream)
  doc.text((run.location_name ?? 'Unknown Location').toUpperCase(), MARGIN, y)
  y += 5

  doc.setFont('Courier', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...C.creamDim)
  doc.text(
    new Date(run.timestamp ?? Date.now()).toUTCString(),
    MARGIN,
    y
  )
  y += 8

  // ── Section 1: FLOOD STATISTICS ─────────────────────────────────
  y = drawSectionHeader(doc, 'FLOOD STATISTICS', y)

  // 4-column metric boxes: area, percentage, patches, largest patch
  const bw4 = CONTENT_W / 4 - 1.5
  const bh = 20

  drawMetricBox(
    doc,
    'Flood Area',
    (run.flood_area_km2 ?? 0).toFixed(0) + ' km²',
    MARGIN,
    y,
    bw4,
    bh,
    C.high
  )
  drawMetricBox(
    doc,
    'Flood %',
    (run.flood_percentage ?? 0).toFixed(1) + '%',
    MARGIN + bw4 + 2,
    y,
    bw4,
    bh,
    C.amber
  )
  drawMetricBox(
    doc,
    'Total Patches',
    run.total_patches ?? 0,
    MARGIN + 2 * (bw4 + 2),
    y,
    bw4,
    bh,
    C.cream
  )
  drawMetricBox(
    doc,
    'Largest Patch',
    (run.largest_patch_km2 ?? 0).toFixed(2) + ' km²',
    MARGIN + 3 * (bw4 + 2),
    y,
    bw4,
    bh,
    C.ice
  )
  y += bh + 4

  // Severity + Risk level row
  y = drawKeyValue(doc, 'Severity', run.severity ?? 'N/A', y)
  y = drawKeyValue(
    doc,
    'Risk Level',
    run.risk_label ?? 'N/A',
    y,
    riskColor(run.risk_label)
  )

  // Risk badge
  drawAlertBadge(doc, run.risk_label ?? 'UNKNOWN', MARGIN + 60, y - 10)
  y += 4

  // ── Section 2: SIGNAL INTELLIGENCE ──────────────────────────────
  y = drawSectionHeader(doc, 'SIGNAL INTELLIGENCE', y)

  const bw2 = CONTENT_W / 2 - 2
  // Confidence box
  const confColor =
    run.confidence === 'High'
      ? C.low
      : run.confidence === 'Medium'
        ? C.amber
        : C.critical

  drawMetricBox(
    doc,
    'Signal Confidence',
    run.confidence ?? 'N/A',
    MARGIN,
    y,
    bw2,
    bh,
    confColor
  )
  drawMetricBox(
    doc,
    'Depth Proxy (Category)',
    run.depth_category ?? 'N/A',
    MARGIN + bw2 + 4,
    y,
    bw2,
    bh,
    C.ice
  )
  y += bh + 4

  y = drawKeyValue(
    doc,
    'Mean dB Drop',
    (run.mean_db_drop ?? 0).toFixed(2) + ' dB',
    y
  )

  // Confidence reason — wrapped
  if (run.reason) {
    doc.setFont('Courier', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...C.creamDim)
    y = wrapText(doc, 'REASON: ' + run.reason, MARGIN, y, CONTENT_W, 4.5)
    y += 3
  }

  // ── Section 3: AI ANALYSIS REPORT ───────────────────────────────
  y = drawSectionHeader(doc, 'AI ANALYSIS REPORT', y)

  // Bordered inset block for ai_insight
  const insightStartY = y
  doc.setFont('Courier', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...C.cream)
  const aiLines = doc.splitTextToSize(
    run.ai_insight ?? 'No AI insight available.',
    CONTENT_W - 5
  )

  // Check overflow before writing ai block
  if (y + aiLines.length * 4.5 > 265) {
    doc.addPage()
    fillBackground(doc)
    drawPageFooter(doc)
    y = 18
  }

  doc.setFillColor(
    riskColor(run.risk_label)[0],
    riskColor(run.risk_label)[1],
    riskColor(run.risk_label)[2]
  )
  doc.setFillColor(
    ...riskColor(run.risk_label)
      .slice(0, 3)
      .map((c) => Math.min(c + 20, 255))
  )
  doc.rect(MARGIN, y, CONTENT_W, aiLines.length * 4.5 + 6, 'F')
  doc.setTextColor(...C.cream)
  doc.text(aiLines, MARGIN + 4, y + 4)
  // Left accent bar — correct height
  doc.setFillColor(...riskColor(run.risk_label))
  doc.rect(MARGIN, y, 0.8, aiLines.length * 4.5 + 6, 'F')
  y += aiLines.length * 4.5 + 10

  // ── Section 4: FLOOD PATCH TABLE ────────────────────────────────
  // Add new page if less than 60mm remain
  if (y > 220) {
    doc.addPage()
    fillBackground(doc)
    drawPageFooter(doc)
    y = 18
  }

  y = drawSectionHeader(doc, 'FLOOD PATCH INVENTORY', y)

  const headers = ['Patch ID', 'Area km²', 'Centroid Lat', 'Centroid Lon', 'Risk']
  const rows = (run.patches ?? []).map((p) => [
    '#' + String(p.patch_id).padStart(3, '0'),
    (p.area_km2 ?? 0).toFixed(2),
    (p.centroid_lat ?? 0).toFixed(4),
    (p.centroid_lon ?? 0).toFixed(4),
    p.risk_label ?? '—',
  ])

  drawTable(doc, headers, rows, y)

  savePDF(
    doc,
    `AMBROSIA_Insights_${String(run.run_id ?? 'unknown').slice(0, 8)}_${Date.now()}.pdf`
  )
}
