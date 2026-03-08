import React, { useEffect, useRef, useState } from 'react'
import { DISTRICTS, RISK_COLORS } from '../../data/districts.js'
import { useMapStore } from '../../stores/mapStore.js'

const HEX_R = 40   // circumradius
const HEX_H = HEX_R * Math.sqrt(3)

function hexCenter(col, row) {
  const x = col * HEX_R * 3 + (row % 2 === 1 ? HEX_R * 1.5 : 0) + HEX_R * 2
  const y = row * HEX_H * 0.88 + HEX_H
  return { x, y }
}

function hexPath(cx, cy, r) {
  const pts = []
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6
    pts.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`)
  }
  return pts.join(' ')
}

export default function DistrictHexMap({ onSelect }) {
  const { overlay, filterRisk, selectedDistrict, hoveredDistrict, setHoveredDistrict } = useMapStore()
  const [pulsePhase, setPulsePhase] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setPulsePhase(p => (p + 1) % 60), 50)
    return () => clearInterval(id)
  }, [])

  const getColor = (d) => {
    if (overlay === 'flood') {
      const v = d.floodPct / 70
      const r = Math.round(40 + v * 180)
      const g = Math.round(160 - v * 130)
      const b = Math.round(216 - v * 180)
      return `rgb(${r},${g},${b})`
    }
    if (overlay === 'population') {
      const v = Math.log10(d.pop + 1) / 7
      const r = Math.round(74 + v * 160)
      const g = Math.round(176 - v * 80)
      const b = Math.round(216)
      return `rgb(${r},${g},${b})`
    }
    return RISK_COLORS[d.risk]?.hex ?? '#2a3f58'
  }

  const allPts = DISTRICTS.map(d => hexCenter(d.col, d.row))
  const maxX = Math.max(...allPts.map(p => p.x)) + HEX_R * 2
  const maxY = Math.max(...allPts.map(p => p.y)) + HEX_H

  return (
    <svg
      viewBox={`0 0 ${maxX} ${maxY}`}
      className="w-full h-full"
      style={{ maxHeight: '100%' }}
    >
      <defs>
        <filter id="glow-critical">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="glow-selected">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        {DISTRICTS.map(d => {
          const c = getColor(d)
          return (
            <radialGradient key={d.id + '-grad'} id={`grad-${d.id}`} cx="50%" cy="40%" r="60%">
              <stop offset="0%"   stopColor={c} stopOpacity="0.9" />
              <stop offset="100%" stopColor={c} stopOpacity="0.5" />
            </radialGradient>
          )
        })}
        {/* Vignette gradient */}
        <radialGradient id="vignette-gradient" cx="50%" cy="50%" r="70%">
          <stop offset="40%" stopColor="transparent" />
          <stop offset="100%" stopColor="rgba(7,9,14,0.7)" />
        </radialGradient>
      </defs>

      {DISTRICTS.map(d => {
        const { x, y }   = hexCenter(d.col, d.row)
        const isSel      = selectedDistrict?.id === d.id
        const isHov      = hoveredDistrict?.id   === d.id
        const isCritical = d.risk === 'Critical'
        const pulseAlpha = isCritical ? 0.25 + Math.abs(Math.sin(pulsePhase * 0.2)) * 0.25 : 0
        const isFiltered = filterRisk !== 'all' && d.risk !== filterRisk

        return (
          <g key={d.id}
             className="cursor-pointer"
             opacity={isFiltered ? 0.12 : 1}
             onClick={() => !isFiltered && onSelect(d)}
             onMouseEnter={() => !isFiltered && setHoveredDistrict(d)}
             onMouseLeave={() => setHoveredDistrict(null)}
             filter={!isFiltered && (isSel ? 'url(#glow-selected)' : isCritical ? 'url(#glow-critical)' : undefined)}
          >
            {/* Pulse ring for critical */}
            {isCritical && !isFiltered && (
              <polygon
                points={hexPath(x, y, HEX_R * (1.2 + Math.sin(pulsePhase * 0.2) * 0.15))}
                fill="none"
                stroke="#d84040"
                strokeWidth="1.5"
                opacity={pulseAlpha}
              />
            )}

            {/* Main hex */}
            <polygon
              points={hexPath(x, y, isSel || isHov ? HEX_R * 0.96 : HEX_R * 0.88)}
              fill={`url(#grad-${d.id})`}
              stroke={isSel ? '#e8ab30' : isHov ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.06)'}
              strokeWidth={isSel ? 2 : 1}
              style={{ transition: 'all 0.2s ease' }}
            />

            {/* Inner accent ring */}
            <polygon
              points={hexPath(x, y, HEX_R * 0.6)}
              fill="none"
              stroke={getColor(d)}
              strokeWidth="0.5"
              opacity="0.3"
            />

            {/* District name */}
            <text
              x={x} y={y - 4}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="8"
              fontFamily="DM Sans, sans-serif"
              fontWeight="600"
              fill="rgba(255,255,255,0.9)"
              style={{ pointerEvents: 'none' }}
            >
              {d.name.length > 8 ? d.name.slice(0, 7) + '…' : d.name}
            </text>

            {/* Flood % */}
            <text
              x={x} y={y + 8}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="7"
              fontFamily="JetBrains Mono, monospace"
              fill={getColor(d)}
              opacity="0.9"
              style={{ pointerEvents: 'none' }}
            >
              {d.floodPct}%
            </text>
          </g>
        )
      })}

      {/* Vignette overlay */}
      <rect width="100%" height="100%" fill="url(#vignette-gradient)" pointerEvents="none" />

      {/* Crosshair on hovered district */}
      {hoveredDistrict && (() => {
        const { x: cx, y: cy } = hexCenter(hoveredDistrict.col, hoveredDistrict.row)
        return (
          <g pointerEvents="none">
            <line x1={cx - 60} y1={cy} x2={cx + 60} y2={cy}
                  stroke="#4ab0d8" strokeWidth="0.5" opacity="0.2" />
            <line x1={cx} y1={cy - 60} x2={cx} y2={cy + 60}
                  stroke="#4ab0d8" strokeWidth="0.5" opacity="0.2" />
          </g>
        )
      })()}

      {/* Hover tooltip — foreignObject for styled HTML content */}
      {hoveredDistrict && (() => {
        const { x, y } = hexCenter(hoveredDistrict.col, hoveredDistrict.row)
        const d = hoveredDistrict
        const tw = 130, th = 52
        const tx = Math.max(0, Math.min(maxX - tw, x - tw / 2))
        const ty = Math.max(0, y - HEX_R - th - 10)
        return (
          <foreignObject
            x={tx} y={ty} width={tw} height={th}
            style={{ pointerEvents: 'none', overflow: 'visible' }}
          >
            <div xmlns="http://www.w3.org/1999/xhtml"
                 style={{
                   background: 'rgba(14,20,31,0.95)',
                   border: '1px solid rgba(255,255,255,0.1)',
                   borderRadius: '6px',
                   padding: '7px 10px',
                   width: `${tw}px`,
                   boxSizing: 'border-box',
                 }}
            >
              <div style={{
                fontFamily: 'DM Sans, sans-serif',
                fontSize: '9px',
                fontWeight: 600,
                color: '#bfcfd8',
                marginBottom: '3px',
                whiteSpace: 'nowrap',
              }}>
                {d.name}
              </div>
              <div style={{
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '7.5px',
                color: RISK_COLORS[d.risk]?.hex ?? '#fff',
                whiteSpace: 'nowrap',
              }}>
                {d.risk} · {d.floodPct}% · {(d.pop / 1000).toFixed(0)}k pop
              </div>
            </div>
          </foreignObject>
        )
      })()}
    </svg>
  )
}
