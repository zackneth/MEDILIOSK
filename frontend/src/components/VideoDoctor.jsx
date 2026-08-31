import { useEffect, useState } from 'react'
import api from '../api'

const AGENT_ID = import.meta.env.VITE_BEY_AGENT_ID || ''

export default function VideoDoctor({ sessionId }) {
  const [loaded, setLoaded] = useState(false)
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => {
      if (!loaded) setTimedOut(true)
    }, 12000)
    return () => clearTimeout(t)
  }, [loaded])

  useEffect(() => {
    if (!sessionId) return
    api.post(`/interview/${sessionId}/activate-for-avatar`).catch(() => {})
  }, [sessionId])

  if (!AGENT_ID) return null

  return (
    <div className="relative w-full h-full rounded-2xl overflow-hidden border-2 border-cyan-500/40 bg-slate-900 shadow-2xl shadow-cyan-500/10">
      <iframe
        src={`https://bey.chat/${AGENT_ID}`}
        className="w-full h-full"
        allow="camera *; microphone *; fullscreen; autoplay; clipboard-write"
        onLoad={() => setLoaded(true)}
        title="MediKiosk Digital Doctor"
      />
      {!loaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-900">
          <div className="w-10 h-10 border-4 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin" />
          <p className="text-sm text-slate-400">Connecting to Dr. Sahayak HD…</p>
        </div>
      )}
      {timedOut && (
        <div className="absolute bottom-3 left-3 right-3 text-xs text-amber-300 bg-slate-900/90 rounded-lg p-2 text-center">
          Video stuck? Click inside the video and complete the one-time login — or use the touch/mic panel.
        </div>
      )}
    </div>
  )
}
