import { useEffect, useState } from 'react'
import { api } from '../api'
import Speech from '../speech'

const AGENT_ID = import.meta.env.VITE_BEY_AGENT_ID || ''
const BEY_URL = `https://bey.chat/${AGENT_ID}`

export default function AvatarStage({ speechText, sessionId }) {
  const [mode, setMode] = useState('iframe')

  useEffect(() => {
    if (!speechText) return
    if (mode === 'iframe') return
    Speech.speak(speechText, 'en-IN')
  }, [speechText])

  useEffect(() => {
    return () => Speech.stop()
  }, [])

  const launchPopup = () => {
    window.open(
      BEY_URL,
      'MediKioskDoctor',
      'width=480,height=720,left=100,top=80',
    )
  }

  const activateSession = async () => {
    if (!sessionId) return
    try {
      await api.post(`/interview/${sessionId}/activate-for-avatar`)
    } catch { /* non-fatal */ }
  }

  if (mode === 'voice') {
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="w-56 h-56 rounded-full bg-gradient-to-br from-cyan-700 to-emerald-900 flex items-center justify-center border-4 border-cyan-500/40 shadow-2xl shadow-cyan-500/20 animate-pulse">
          <span className="text-7xl">👨‍⚕️</span>
        </div>
        <button onClick={() => setMode('iframe')} className="text-xs text-slate-500 underline">Try video doctor again</button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-3 w-full max-w-md">
      <div className="w-full aspect-video rounded-2xl overflow-hidden border-2 border-cyan-500/40 shadow-2xl shadow-cyan-500/20 bg-slate-900 relative">
        <iframe
          src={BEY_URL}
          width="100%"
          height="100%"
          allow="camera; microphone; fullscreen; autoplay"
          style={{ border: 'none' }}
          title="MediKiosk Digital Doctor"
        />
        <button
          onClick={() => setMode('voice')}
          className="absolute top-2 right-2 bg-slate-900/80 text-slate-300 text-xs px-3 py-1.5 rounded-lg hover:bg-slate-800"
        >✕</button>
      </div>
      <p className="text-xs text-slate-500 text-center">Video not loading here?</p>
      <div className="flex gap-3">
        <button onClick={launchPopup} className="px-4 py-2 rounded-lg bg-cyan-500 text-slate-950 text-sm font-bold">
          🖥️ Open Doctor Window
        </button>
        <button onClick={() => setMode('voice')} className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-sm">
          🎙️ Voice-only mode
        </button>
      </div>
    </div>
  )
}
