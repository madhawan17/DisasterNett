import React, { useEffect, useRef } from 'react'

export default function SatelliteOrbit({ className = '' }) {
  const ref = useRef(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let raf, t = 0

    const resize = () => {
      canvas.width  = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
    }
    resize()
    window.addEventListener('resize', resize)

    const draw = () => {
      const W = canvas.width, H = canvas.height
      const cx = W / 2, cy = H / 2
      ctx.clearRect(0, 0, W, H)

      // ── Bangladesh "blob" ───────────────────────────
      const bW = Math.min(W, H) * 0.32
      const bH = bW * 1.4
      ctx.save()
      ctx.translate(cx, cy)
      ctx.beginPath()
      ctx.ellipse(0, 0, bW * 0.6, bH * 0.55, -0.2, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(74,176,216,0.06)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(74,176,216,0.15)'
      ctx.lineWidth = 1
      ctx.stroke()
      // Grid lines over blob
      ctx.strokeStyle = 'rgba(74,176,216,0.04)'
      ctx.lineWidth = 0.5
      for (let i = -4; i <= 4; i++) {
        ctx.beginPath()
        ctx.moveTo(i * bW * 0.15, -bH * 0.55)
        ctx.lineTo(i * bW * 0.15,  bH * 0.55)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(-bW * 0.6, i * bH * 0.14)
        ctx.lineTo( bW * 0.6, i * bH * 0.14)
        ctx.stroke()
      }
      ctx.restore()

      // ── Orbit rings ─────────────────────────────────
      const orbits = [
        { rx: bW * 1.6, ry: bH * 0.7, tilt: 0.3, speed: 0.007, color: 'rgba(212,144,10,', alpha: 0.25 },
        { rx: bW * 2.1, ry: bH * 0.55, tilt: -0.5, speed: 0.005, color: 'rgba(74,176,216,', alpha: 0.15 },
        { rx: bW * 1.1, ry: bH * 0.9, tilt: 0.8, speed: 0.011, color: 'rgba(212,144,10,', alpha: 0.2  },
      ]

      orbits.forEach((o, oi) => {
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(o.tilt)
        // Orbit path
        ctx.beginPath()
        ctx.ellipse(0, 0, o.rx, o.ry, 0, 0, Math.PI * 2)
        ctx.strokeStyle = `${o.color}${o.alpha})`
        ctx.setLineDash([4, 6])
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.setLineDash([])

        // Satellite position on orbit
        const phase = t * o.speed + oi * 2.1
        const sx = Math.cos(phase) * o.rx
        const sy = Math.sin(phase) * o.ry

        // Trail
        for (let tr = 12; tr >= 0; tr--) {
          const tp = phase - tr * 0.04
          const tx = Math.cos(tp) * o.rx
          const ty = Math.sin(tp) * o.ry
          const aFade = (1 - tr / 12) * o.alpha * 3
          ctx.beginPath()
          ctx.arc(tx, ty, 1.5, 0, Math.PI * 2)
          ctx.fillStyle = `${o.color}${aFade * 0.8})`
          ctx.fill()
        }

        // Satellite body
        ctx.beginPath()
        ctx.arc(sx, sy, 4, 0, Math.PI * 2)
        ctx.fillStyle = `${o.color}0.9)`
        ctx.fill()
        // Solar panels
        ctx.strokeStyle = `${o.color}0.7)`
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(sx - 8, sy)
        ctx.lineTo(sx + 8, sy)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(sx, sy - 4)
        ctx.lineTo(sx, sy + 4)
        ctx.stroke()

        // Scan cone from satellite toward center
        if (oi === 0) {
          const ang = Math.atan2(sy, sx)
          ctx.beginPath()
          ctx.moveTo(sx, sy)
          ctx.lineTo(sx * 0.15, sy * 0.15)
          ctx.strokeStyle = 'rgba(212,144,10,0.15)'
          ctx.lineWidth = 1
          ctx.setLineDash([2, 4])
          ctx.stroke()
          ctx.setLineDash([])
        }

        ctx.restore()
      })

      // ── Scanning pulse rings ─────────────────────────
      const pulseR = bW * 0.8 + Math.sin(t * 0.04) * bW * 0.1
      ctx.save()
      ctx.translate(cx, cy)
      for (let ring = 0; ring < 3; ring++) {
        const r = pulseR + ring * 12
        const alpha = 0.08 - ring * 0.025
        ctx.beginPath()
        ctx.arc(0, 0, r, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(212,144,10,${alpha})`
        ctx.lineWidth = 1
        ctx.stroke()
      }
      ctx.restore()

      t++
      raf = requestAnimationFrame(draw)
    }

    draw()
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={ref} className={`w-full h-full ${className}`} />
}
