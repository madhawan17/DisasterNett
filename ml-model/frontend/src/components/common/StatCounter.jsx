import React, { useEffect, useRef, useState } from 'react'

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3) }

export default function StatCounter({ target, suffix = '', prefix = '', decimals = 0, duration = 2000, className = '' }) {
  const [val, setVal]   = useState(0)
  const rafRef          = useRef(null)
  const startRef        = useRef(null)

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    startRef.current = null

    const animate = (ts) => {
      if (!startRef.current) startRef.current = ts
      const elapsed = ts - startRef.current
      const progress = Math.min(elapsed / duration, 1)
      const eased = easeOutCubic(progress)
      setVal(+(eased * target).toFixed(decimals))
      if (progress < 1) rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target, duration, decimals])

  const display = decimals > 0 ? val.toFixed(decimals) : Math.round(val).toLocaleString()
  return (
    <span className={className}>
      {prefix}{display}{suffix}
    </span>
  )
}
