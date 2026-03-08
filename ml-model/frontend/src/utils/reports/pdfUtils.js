import { jsPDF } from 'jspdf'

// ── Brand palette (RGB) ───────────────────────────────────────────
export const C = {
  bg: [10, 9, 7],          // #0a0907
  bgAlt: [15, 13, 11],     // slightly lighter rows
  amber: [242, 209, 109],  // #f2d16d
  amberDim: [100, 84, 55], // 50% amber for dividers
  cream: [236, 232, 223],  // #ece8df
  creamDim: [150, 147, 141], // ~60% cream for secondary labels
  critical: [192, 57, 43], // red
  high: [220, 120, 40],    // orange
  medium: [242, 209, 109], // amber (same as brand)
  low: [34, 197, 94],      // green
  ice: [74, 176, 216],     // #4ab0d8 for SAR/depth data
  border: [30, 28, 24],    // subtle border color
}

export const PAGE_W = 210
export const PAGE_H = 297
export const MARGIN = 14
export const CONTENT_W = PAGE_W - MARGIN * 2 // 182mm

// ── newDoc() ─────────────────────────────────────────────────────
// Creates a new jsPDF instance with dark background pre-filled.
export function newDoc() {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  fillBackground(doc)
  return doc
}

// ── fillBackground(doc) ──────────────────────────────────────────
// Fills the entire current page with the dark bg color.
export function fillBackground(doc) {
  doc.setFillColor(...C.bg)
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F')
}

// ── drawPageHeader(doc, reportType) → returns nextY ─────────────
// Draws the standard 2-line amber top border, AMBROSIA title,
// subtitle, report type label on the right, and a timestamp row.
export function drawPageHeader(doc, reportType) {
  // 2px amber top border
  doc.setFillColor(...C.amber)
  doc.rect(0, 0, PAGE_W, 0.7, 'F')

  // AMBROSIA title
  doc.setFont('Courier', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(...C.amber)
  doc.text('AMBROSIA', MARGIN, 8)

  // Report type — right aligned
  doc.setFont('Courier', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...C.amberDim)
  doc.text(reportType.toUpperCase() + ' REPORT', PAGE_W - MARGIN, 6, { align: 'right' })

  // Subtitle
  doc.setFont('Courier', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...C.creamDim)
  doc.text('FLOOD INTELLIGENCE SYSTEM', MARGIN, 12)

  // Timestamp — right aligned
  const ts = new Date().toUTCString()
  doc.setFontSize(6)
  doc.setTextColor(...C.creamDim)
  doc.text('GENERATED ' + ts, PAGE_W - MARGIN, 12, { align: 'right' })

  // Amber divider
  doc.setDrawColor(...C.amber)
  doc.setLineWidth(0.3)
  doc.line(MARGIN, 15, PAGE_W - MARGIN, 15)

  return 18 // nextY
}

// ── drawSectionHeader(doc, title, y) → nextY ────────────────────
// Draws a section label in amber caps and a full-width amber underline.
export function drawSectionHeader(doc, title, y) {
  doc.setFont('Courier', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...C.amber)
  doc.text(title, MARGIN, y)

  doc.setDrawColor(...C.amberDim)
  doc.setLineWidth(0.2)
  doc.line(MARGIN, y + 1.5, PAGE_W - MARGIN, y + 1.5)

  return y + 5
}

// ── drawKeyValue(doc, label, value, y, valueColor?) → nextY ──────
// One-line key: value row. Label is dimmed cream, value defaults to cream.
export function drawKeyValue(doc, label, value, y, valueColor = null) {
  doc.setFont('Courier', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...C.creamDim)
  doc.text(label.toUpperCase(), MARGIN, y)

  doc.setFont('Courier', 'bold')
  doc.setTextColor(...(valueColor ?? C.cream))
  doc.text(String(value), MARGIN + 55, y)

  return y + 5
}

// ── drawMetricBox(doc, label, value, x, y, w, h, valueColor?) ───
// Draws a bordered metric tile: amber label top-left, value below.
export function drawMetricBox(doc, label, value, x, y, w, h, valueColor = null) {
  // Border
  doc.setDrawColor(...C.border)
  doc.setLineWidth(0.2)
  doc.setFillColor(...C.bgAlt)
  doc.rect(x, y, w, h, 'FD')

  // Label
  doc.setFont('Courier', 'normal')
  doc.setFontSize(5.5)
  doc.setTextColor(...C.amber)
  doc.text(label.toUpperCase(), x + 3, y + 5)

  // Value
  doc.setFont('Courier', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...(valueColor ?? C.cream))
  doc.text(String(value), x + 3, y + 13)
}

// ── drawTable(doc, headers, rows, y) → nextY ─────────────────────
// Renders a table with amber header, alternating rows, and risk colors.
export function drawTable(doc, headers, rows, startY) {
  const colCount = headers.length
  const colW = CONTENT_W / colCount
  const rowH = 7
  const headerH = 7
  let y = startY

  // Header row — amber fill, dark text
  doc.setFillColor(...C.amber)
  doc.rect(MARGIN, y, CONTENT_W, headerH, 'F')
  doc.setFont('Courier', 'bold')
  doc.setFontSize(6)
  doc.setTextColor(...C.bg)
  headers.forEach((h, i) => {
    doc.text(h.toUpperCase(), MARGIN + colW * i + 2, y + 5)
  })
  y += headerH

  // Body rows
  rows.forEach((row, rowIdx) => {
    // Overflow guard: if row would go past footer zone, add new page
    if (y + rowH > 270) {
      doc.addPage()
      fillBackground(doc)
      drawPageFooter(doc)
      y = 14
    }

    // Alternating fill
    doc.setFillColor(...(rowIdx % 2 === 0 ? C.bg : C.bgAlt))
    doc.rect(MARGIN, y, CONTENT_W, rowH, 'F')

    // Subtle border
    doc.setDrawColor(...C.border)
    doc.setLineWidth(0.1)
    doc.rect(MARGIN, y, CONTENT_W, rowH, 'D')

    // Text
    doc.setFont('Courier', 'normal')
    doc.setFontSize(6)
    row.forEach((cell, i) => {
      // Risk cells: color by value
      const color = riskTextColor(cell)
      doc.setTextColor(...color)
      doc.text(String(cell ?? '—'), MARGIN + colW * i + 2, y + 5)
    })
    y += rowH
  })

  return y + 3
}

// ── drawAlertBadge(doc, alertLevel, x, y) ────────────────────────
// Draws a colored badge pill for alert levels / risk classifications.
export function drawAlertBadge(doc, alertLevel, x, y) {
  const color = riskColor(alertLevel)
  doc.setFillColor(...color)
  doc.setDrawColor(...color)
  doc.roundedRect(x, y - 3.5, 28, 5.5, 1.5, 1.5, 'FD')
  doc.setFont('Courier', 'bold')
  doc.setFontSize(6)
  doc.setTextColor(...C.bg)
  doc.text(alertLevel.toUpperCase(), x + 14, y, { align: 'center' })
}

// ── drawPageFooter(doc) ──────────────────────────────────────────
// Draws the footer on the current page: amber top rule, timestamp left,
// page number right.
export function drawPageFooter(doc) {
  const footerY = PAGE_H - 10
  doc.setDrawColor(...C.amberDim)
  doc.setLineWidth(0.2)
  doc.line(MARGIN, footerY, PAGE_W - MARGIN, footerY)

  doc.setFont('Courier', 'normal')
  doc.setFontSize(6)
  doc.setTextColor(...C.creamDim)
  doc.text(
    'AMBROSIA FLOOD INTELLIGENCE SYSTEM  ·  GENERATED ' +
      new Date().toUTCString(),
    MARGIN,
    footerY + 4
  )
  const pageStr = 'PAGE ' + doc.getCurrentPageInfo().pageNumber
  doc.text(pageStr, PAGE_W - MARGIN, footerY + 4, { align: 'right' })
}

// ── wrapText(doc, text, x, y, maxW, lineH) → nextY ───────────────
// Breaks text into lines fitting maxW mm, renders each, returns nextY.
export function wrapText(doc, text, x, y, maxW, lineH = 5) {
  const lines = doc.splitTextToSize(String(text ?? ''), maxW)
  doc.text(lines, x, y)
  return y + lines.length * lineH
}

// ── riskColor(level) → RGB array ────────────────────────────────
// Returns the RGB array for a risk/alert level string.
export function riskColor(level) {
  switch ((level ?? '').toLowerCase()) {
    case 'critical':
      return C.critical
    case 'high':
      return C.high
    case 'medium':
      return C.medium
    case 'low':
      return C.low
    default:
      return C.creamDim
  }
}

// ── riskTextColor(cellText) → RGB array ──────────────────────────
// Heuristic: if cell content matches a risk word, colorize it.
export function riskTextColor(cellText) {
  const lower = String(cellText ?? '').toLowerCase()
  if (lower === 'critical') return C.critical
  if (lower === 'high') return C.high
  if (lower === 'medium') return C.medium
  if (lower === 'low') return C.low
  return C.cream
}

// ── savePDF(doc, filename) ────────────────────────────────────────
export function savePDF(doc, filename) {
  doc.save(filename)
}
