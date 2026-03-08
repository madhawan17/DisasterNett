import {
  newDoc,
  drawPageHeader,
  drawSectionHeader,
  drawKeyValue,
  drawMetricBox,
  drawPageFooter,
  savePDF,
  wrapText,
  C,
  MARGIN,
  CONTENT_W,
} from './pdfUtils.js'

export function generateLifelineReport(data, centerLat, centerLon, radiusM) {
  const doc = newDoc()

  let y = drawPageHeader(doc, 'LIFELINE')
  drawPageFooter(doc)

  // ── Section 1: SCAN PARAMETERS ──────────────────────────────────
  y = drawSectionHeader(doc, 'SCAN PARAMETERS', y)
  y = drawKeyValue(doc, 'Center Latitude', centerLat?.toFixed(5) ?? 'N/A', y)
  y = drawKeyValue(
    doc,
    'Center Longitude',
    centerLon?.toFixed(5) ?? 'N/A',
    y
  )
  y = drawKeyValue(doc, 'Search Radius', (radiusM ?? 0).toLocaleString() + ' m', y)
  y += 4

  // ── Section 2: DETECTION SUMMARY ────────────────────────────────
  y = drawSectionHeader(doc, 'DETECTION SUMMARY', y)

  // Total features — large number
  doc.setFont('Courier', 'bold')
  doc.setFontSize(24)
  doc.setTextColor(...C.low) // green — feature count is positive
  doc.text(String(data?.total_features ?? 0), MARGIN, y + 9)

  doc.setFont('Courier', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...C.creamDim)
  doc.text(
    'TOTAL INFRASTRUCTURE FEATURES DETECTED',
    MARGIN + 18,
    y + 11
  )
  y += 18

  // ── Section 3: INFRASTRUCTURE BREAKDOWN ─────────────────────────
  y = drawSectionHeader(doc, 'INFRASTRUCTURE BREAKDOWN', y)

  const summary = data?.summary ?? {}
  const bw = CONTENT_W / 3 - 2
  const bh = 18

  // Row 1: hospitals, schools, worship
  const row1 = [
    {
      label: 'Hospitals',
      value: summary.hospital ?? 0,
      color: C.critical,
    },
    {
      label: 'Schools',
      value: summary.school ?? 0,
      color: C.ice,
    },
    {
      label: 'Places of Worship',
      value: summary.place_of_worship ?? 0,
      color: [167, 139, 250],
    },
  ]
  row1.forEach((box, i) => {
    drawMetricBox(doc, box.label, box.value, MARGIN + i * (bw + 3), y, bw, bh, box.color)
  })
  y += bh + 4

  // Row 2: residential, commercial, total buildings
  const row2 = [
    {
      label: 'Residential Buildings',
      value: summary.residential_building ?? 0,
      color: C.low,
    },
    {
      label: 'Commercial Buildings',
      value: summary.commercial_building ?? 0,
      color: [250, 204, 21],
    },
    {
      label: 'Total Buildings',
      value: summary.building ?? 0,
      color: C.cream,
    },
  ]
  row2.forEach((box, i) => {
    drawMetricBox(doc, box.label, box.value, MARGIN + i * (bw + 3), y, bw, bh, box.color)
  })
  y += bh + 4

  // ── Section 4: OPERATIONAL NOTES ─────────────────────────────────
  y = drawSectionHeader(doc, 'OPERATIONAL NOTES', y)
  doc.setFont('Courier', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...C.creamDim)
  const note =
    'Infrastructure data sourced from OpenStreetMap via the Overpass API. ' +
    'Feature counts represent tagged nodes and ways within the specified radius. ' +
    'Critical facilities (hospitals, schools) should be prioritized for evacuation routing.'
  const lines = doc.splitTextToSize(note, CONTENT_W)
  doc.text(lines, MARGIN, y)

  savePDF(doc, `AMBROSIA_Lifeline_${Date.now()}.pdf`)
}
