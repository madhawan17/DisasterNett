import React from 'react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts'

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-bg-3 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono">
      <div className="text-text-2 mb-1">{label}</div>
      <div style={{ color: '#d4900a' }}>Flood: {payload[0]?.value?.toFixed(1)}%</div>
    </div>
  )
}

export default function SparkChart({ data = [], color = '#d4900a', height = 120 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0}   />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="month"
          tick={{ fontSize: 9, fontFamily: 'JetBrains Mono', fill: 'rgba(140,165,180,0.4)' }}
          axisLine={false} tickLine={false}
        />
        <YAxis hide domain={[0, 'auto']} />
        <Tooltip content={<CustomTooltip />} />
        <Area
          type="monotone"
          dataKey="floodPct"
          stroke={color}
          strokeWidth={1.5}
          fill="url(#sparkGrad)"
          dot={false}
          activeDot={{ r: 3, fill: color }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
