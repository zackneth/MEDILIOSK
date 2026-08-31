import { useEffect, useRef, useState } from 'react'

export default function DoctorAvatar({ speaking }) {
  const [blink, setBlink] = useState(false)
  const [mouthOpen, setMouthOpen] = useState(0)
  const [nudge, setNudge] = useState(0)
  const rafRef = useRef(null)
  const startRef = useRef(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setBlink(true)
      setTimeout(() => setBlink(false), 150)
    }, 3200 + Math.random() * 2500)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!speaking) {
      setMouthOpen(0)
      return
    }
    startRef.current = performance.now()
    const animate = (t) => {
      const elapsed = (t - startRef.current) / 1000
      const v = Math.abs(Math.sin(elapsed * 11)) * 0.7 + Math.abs(Math.sin(elapsed * 4.3)) * 0.3
      setMouthOpen(v)
      setNudge(Math.sin(elapsed * 1.8) * 2)
      rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafRef.current)
  }, [speaking])

  const skin = '#e8b98a'
  const coat = '#f5f7fa'
  const shirt = '#3b82a0'

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <svg
        viewBox="0 0 200 220"
        className="w-56 h-64 drop-shadow-2xl"
        style={{ transform: `translateY(${nudge}px)` }}
      >
        <path d="M40 220 Q40 160 100 160 Q160 160 160 220 Z" fill={coat} />
        <path d="M85 165 L100 195 L115 165 Z" fill={shirt} />
        <rect x="97" y="165" width="6" height="34" rx="3" fill="#d9534f" />
        <circle cx="100" cy="202" r="7" fill="#c9ccd1" stroke="#9aa0a8" strokeWidth="2" />
        <path d="M93 205 Q80 215 70 210" stroke="#c9ccd1" strokeWidth="3" fill="none" strokeLinecap="round" />

        <ellipse cx="100" cy="88" rx="46" ry="52" fill={skin} />
        <path d="M54 78 Q58 30 100 30 Q142 30 146 78 Q138 52 100 50 Q62 52 54 78 Z" fill="#3a2e26" />
        <path d="M54 76 Q60 42 100 42 Q140 42 146 76 L146 66 Q140 36 100 36 Q60 36 54 66 Z" fill="#3a2e26" />

        {blink ? (
          <rect x="68" y="74" width="20" height="3" rx="1.5" fill="#3a2e26" />
        ) : (
          <>
            <ellipse cx="78" cy="78" rx="10" ry="11" fill="#fff" />
            <circle cx="79" cy="79" r="4.5" fill="#4a3527" />
            <circle cx="77" cy="77" r="1.5" fill="#000" opacity="0.6" />
          </>
        )}
        {blink ? (
          <rect x="112" y="74" width="20" height="3" rx="1.5" fill="#3a2e26" />
        ) : (
          <>
            <ellipse cx="122" cy="78" rx="10" ry="11" fill="#fff" />
            <circle cx="121" cy="79" r="4.5" fill="#4a3527" />
            <circle cx="119" cy="77" r="1.5" fill="#000" opacity="0.6" />
          </>
        )}

        <path d="M72 66 Q78 62 84 65" stroke="#3a2e26" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <path d="M116 65 Q122 62 128 66" stroke="#3a2e26" strokeWidth="2.5" fill="none" strokeLinecap="round" />

        <path d="M96 92 Q100 95 104 92" stroke="#c98f66" strokeWidth="2" fill="none" strokeLinecap="round" />

        <ellipse cx="100" cy="118" rx={12 + mouthOpen * 6} ry={2.5 + mouthOpen * 11} fill="#7a3b3b" />
        <path d="M84 108 Q100 102 116 108" stroke="#b57a55" strokeWidth="2" fill="none" strokeLinecap="round" />
      </svg>

      <div className={`px-4 py-1.5 rounded-full text-xs font-semibold ${speaking ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'bg-slate-800 text-slate-400'}`}>
        {speaking ? '● Dr. Sahayak is speaking…' : 'Dr. Sahayak · listening'}
      </div>
    </div>
  )
}
