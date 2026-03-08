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
  riskColor,
  C,
  MARGIN,
  CONTENT_W,
} from './pdfUtils.js'

export function generateRiskReport(globalMetrics, districtSummaries) {
  const doc = newDoc()

  // ── Page 1 ──────────────────────────────────────────────────────
  let y = drawPageHeader(doc, 'RISK')
  drawPageFooter(doc)

  // ── Section 1: GLOBAL RISK METRICS ──────────────────────────────
  y = drawSectionHeader(doc, 'GLOBAL RISK METRICS', y)

  // 3-column metric boxes (row 1)
  const bw = CONTENT_W / 3 - 2
  const bh = 20

  const pm = globalMetrics?.population_metrics ?? {}
  const hm = globalMetrics?.hydrological_metrics ?? {}
  const ra = globalMetrics?.risk_assessment ?? {}
  const cm = globalMetrics?.confidence_metrics ?? {}
  const aa = globalMetrics?.affected_area_statistics ?? {}

  const row1 = [
    {
      label: 'Total Population',
      value: (pm.total_population ?? 0).toLocaleString(),
      color: C.cream,
    },
    {
      label: 'Rainfall (mm)',
      value: (hm.accumulated_rainfall_mm ?? 0).toFixed(2),
      color: C.ice,
    },
    {
      label: 'Composite Risk Score',
      value: ra.composite_risk_score ?? 'N/A',
      color: riskColor(ra.risk_classification),
    },
  ]
  row1.forEach((box, i) => {
    drawMetricBox(doc, box.label, box.value, MARGIN + i * (bw + 3), y, bw, bh, box.color)
  })
  y += bh + 4

  // Row 2: 2 boxes with wider columns
  const bw2 = CONTENT_W / 2 - 2
  const row2 = [
    {
      label: 'Confidence Level',
      value: cm.confidence_level ?? 'N/A',
      color: C.cream,
    },
    {
      label: 'Affected Area',
      value: (aa.area_km2 ?? 0).toLocaleString() + ' km²',
      color: C.amber,
    },
  ]
  row2.forEach((box, i) => {
    drawMetricBox(
      doc,
      box.label,
      box.value,
      MARGIN + i * (bw2 + 4),
      y,
      bw2,
      bh,
      box.color
    )
  })
  y += bh + 4

  // Risk classification badge
  y = drawSectionHeader(doc, 'RISK CLASSIFICATION', y)
  drawAlertBadge(doc, ra.risk_classification ?? 'UNKNOWN', MARGIN, y)
  y += 12

  // ── Section 2: DISTRICT SUMMARY TABLE ───────────────────────────
  y = drawSectionHeader(doc, 'DISTRICT SUMMARY', y)

  const headers = ['District', 'Classification', 'Population', 'Risk Score', 'Area km²', 'Factors']

  const rows = [...(districtSummaries || [])]
    .sort((a, b) => (b.risk_score ?? 0) - (a.risk_score ?? 0))
    .map((d) => [
      d.district_name ?? '—',
      d.risk_classification ?? '—',
      (d.population ?? 0).toLocaleString(),
      d.risk_score ?? '—',
      d.area_km2 ?? '—',
      (d.contributing_factors ?? []).slice(0, 2).join(', ') || '—',
    ])

  drawTable(doc, headers, rows, y)

  savePDF(doc, `AMBROSIA_Risk_${Date.now()}.pdf`)
}
