import React, { useEffect, useRef } from 'react'

const LEVEL_COLORS = {
  INFO:  '#4ab0d8',
  WARN:  '#c8a018',
  ERROR: '#d84040',
  OK:    '#38a058',
  DATA:  '#e8ab30',
}

export default function LogFeed({ logs = [], maxHeight = 280 }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs.length])

  const fmt = (ts) => {
    const d = new Date(ts)
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`
  }

  return (
    <div
      className="bg-bg rounded-lg border border-white/5 overflow-y-auto p-3"
      style={{ maxHeight, fontFamily: 'JetBrains Mono, monospace' }}
    >
      {logs.length === 0 && (
        <div className="text-text-3 text-xs py-4 text-center">
          — awaiting pipeline run —
        </div>
      )}
      {logs.map((log) => (
        <div key={log.id} className="flex gap-2 text-xs leading-6 border-b border-white/[0.02]">
          <span className="text-text-3 flex-shrink-0 w-16">{fmt(log.ts)}</span>
          <span
            className="flex-shrink-0 w-10 font-medium"
            style={{ color: LEVEL_COLORS[log.level] ?? '#bfcfd8' }}
          >
            {log.level}
          </span>
          <span className="text-text/80">{log.msg}</span>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
