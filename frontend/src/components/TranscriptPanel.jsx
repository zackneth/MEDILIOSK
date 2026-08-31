import { useEffect, useState } from 'react'
import api from '../api'

export default function TranscriptPanel({ sessionId }) {
  const [entries, setEntries] = useState([])

  useEffect(() => {
    if (!sessionId) return
    const poll = setInterval(async () => {
      try {
        const { data } = await api.get(`/interview/${sessionId}/state`)
        const answers = data.state.answers || {}
        const list = Object.entries(answers).map(([qid, a]) => ({
          qid,
          answer: (a.text || a.option || '').slice(0, 80),
        }))
        setEntries(list)
      } catch { /* session may be cleared */ }
    }, 2000)
    return () => clearInterval(poll)
  }, [sessionId])

  return (
    <div className="w-full h-full flex flex-col rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800 text-xs font-bold uppercase tracking-wide text-cyan-400">
        📋 Live Session Recording ({entries.length} answered)
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {entries.length === 0 && (
          <p className="text-xs text-slate-500">Your spoken answers appear here in real time — proof everything is being recorded.</p>
        )}
        {entries.map((e) => (
          <div key={e.qid} className="rounded-lg bg-slate-900 px-3 py-2">
            <span className="text-[10px] text-slate-500 font-mono">{e.qid}</span>
            <p className="text-sm text-slate-200">{e.answer}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

