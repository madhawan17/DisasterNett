import React from 'react'
import { RISK_COLORS } from '../../data/districts.js'

const SIZE_CLASSES = {
  xs:  'text-[10px] px-2 py-0.5',
  sm:  'text-xs px-2.5 py-0.5',
  md:  'text-sm px-3 py-1',
  lg:  'text-base px-4 py-1.5',
}

export default function RiskBadge({ risk, size = 'sm', showDot = true }) {
  const c = RISK_COLORS[risk] ?? RISK_COLORS.None
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-mono font-medium
                  border ${SIZE_CLASSES[size]}`}
      style={{
        color: c.hex,
        borderColor: c.hex + '40',
        backgroundColor: c.dim,
      }}
    >
      {showDot && (
        <span
          className={`rounded-full flex-shrink-0 ${risk === 'Critical' ? 'animate-pulse' : ''}`}
          style={{ width: 6, height: 6, background: c.hex }}
        />
      )}
      {c.label}
    </span>
  )
}
