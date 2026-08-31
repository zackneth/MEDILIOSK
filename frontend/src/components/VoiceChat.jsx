import { useCallback, useEffect, useRef, useState } from 'react'
import { blobToWav } from '../wav'
import { API_BASE } from '../api'
import Speech from '../speech'

export default function VoiceChat({ questionText, questionId, lang, busy, sessionId, onSpokenAnswer, onAssistantReply }) {
  const [phase, setPhase] = useState('idle')
  const [liveHint, setLiveHint] = useState('')
  const [level, setLevel] = useState(0)
  const streamRef = useRef(null)
  const recRef = useRef(null)
  const rafRef = useRef(null)
  const activeRef = useRef(false)

  const cleanupAudio = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    try { recRef.current?.stop() } catch {}
    streamRef.current?.getTracks().forEach((t) => t.stop())
  }

  const REPEAT_RE = /(repeat|again|pardon|say again|come again|didn.?t (understand|get|hear)|could you repeat|please repeat|what did you say|sorry.*what|can you repeat|phir se|dobara|samajh nahi|sunai nahi|suna nahi|ek bar phir|dohrao|repeat the question|say it again|repeat that|bol do dobara|phir se bolo|repeat karo)/i
  const isRepeatIntent = (t) => REPEAT_RE.test((t || '').trim()) && (t || '').trim().split(/\s+/).length <= 15
  const LANG_BCP = { en: 'en-IN', hi: 'hi-IN', ta: 'ta-IN', te: 'te-IN', kn: 'kn-IN', ml: 'ml-IN', mr: 'mr-IN', bn: 'bn-IN', gu: 'gu-IN', pa: 'pa-IN', or: 'or-IN', as: 'as-IN' }
  const bcp = LANG_BCP[lang] || 'en-IN'

  const speakAndListen = useCallback((text) => {
    if (!activeRef.current || !text) { if (activeRef.current && !text) setTimeout(startListening, 300); return }
    setPhase('speaking')
    let spoken=false
    const proceed=()=>{ if(spoken||!activeRef.current) return; spoken=true; setTimeout(startListening,350)}
    Speech.speak(text, bcp).then(proceed)
    setTimeout(proceed, 20000)
  })

  const startListening = () => {
    if (!activeRef.current) return
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      streamRef.current = stream
      const rec = new MediaRecorder(stream)
      const chunks=[]; rec.ondataavailable=(e)=>chunks.push(e.data)
      rec.onstop = async () => {
        stream.getTracks().forEach((t)=>t.stop())
        setPhase('thinking'); setLiveHint('')
        const blob=new Blob(chunks,{type:'audio/webm'})
        const form=new FormData()
        try{ const wav=await blobToWav(blob); form.append('file',wav,'speech.wav')}catch{ form.append('file',blob,'speech.webm')}
        try{
          form.append('language', lang||'en')
          const res=await fetch(`${API_BASE}/stt`,{method:'POST',body:form})
          const data=await res.json()
          if(data.text && activeRef.current){
            if(isRepeatIntent(data.text)){
              setPhase('speaking')
              Speech.speak(questionTextRef.current||questionText, bcp).then(()=>{ if(activeRef.current) setTimeout(startListening,300)})
              return
            }
            const APP_RE = /(medikiosk|kiosk|app|privacy|consent|abha|abdm|fhir|data.*store|dpdp|ayush|scan|report|summary|his|hospital|side effect|medicine|explain|help me|i don.?t understand)/i
            const QUESTION_RE2 = /\?|^(what|why|how|where|when|who|which|can you|can i|could you|tell me|explain|help|is this|are you|do you|will you|aap|yeh kya|ye kya|kaise|kya hai|samjhao|batao|i want|i need|please)/i
            const maybeAssistant = data.text && data.text.trim().split(/\s+/).length >= 3 && (/\?/.test(data.text) || QUESTION_RE2.test(data.text) || APP_RE.test(data.text))
            if(maybeAssistant && sessionId){
              try{
                setPhase('thinking')
                const r=await fetch(`${API_BASE}/interview/${sessionId}/assistant`,{method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text:data.text})})
                const j=await r.json()
                if(j.is_assistant && j.assistant_reply){
                  if(onAssistantReply) onAssistantReply(j.assistant_reply)
                  setPhase('speaking')
                  await Speech.speak(j.assistant_reply, bcp)
                  if(activeRef.current){ await Speech.speak(questionTextRef.current||questionText, bcp); setTimeout(startListening,300)}
                  return
                }
              }catch{}
              setPhase('listening')
            }
            onSpokenAnswer(data.text); return
          }
          retryWithoutRepeating()
        }catch{ retryWithoutRepeating()}
      }
      const ctx=new AudioContext(); if(ctx.state==='suspended') ctx.resume()
      const src=ctx.createMediaStreamSource(stream); const analyser=ctx.createAnalyser(); analyser.fftSize=1024; src.connect(analyser)
      const buf=new Uint8Array(analyser.fftSize)
      let silenceSince=0, spokeSomething=false; const startedAt=Date.now()
      const monitor=()=>{
        if(rec.state!=='recording') return
        analyser.getByteTimeDomainData(buf)
        let peak=0; for(let i=0;i<buf.length;i++){ const v=Math.abs(buf[i]-128); if(v>peak) peak=v}
        const levelPct=Math.min(100, Math.round((peak/128)*300))
        setLiveHint(''); setLevel(levelPct)
        const loud=peak>3||levelPct>6
        if(loud){ silenceSince=0; spokeSomething=true } else { silenceSince=silenceSince||Date.now()}
        const silentFor=Date.now()-silenceSince
        const waitedEnough=Date.now()-startedAt>(spokeSomething?700:1500)
        if(!loud && silenceSince && waitedEnough && silentFor>(spokeSomething?1400:3500)){ rec.stop(); return}
        if(Date.now()-startedAt>25000){ rec.stop(); return}
        rafRef.current=requestAnimationFrame(monitor)
      }
      recRef.current=rec; rec.start(); setPhase('listening'); silenceSince=0; rafRef.current=requestAnimationFrame(monitor)
    }).catch(()=>{
      setPhase('idle'); setLiveHint('Microphone blocked — allow access in the address bar, then tap Start again'); setTimeout(()=>setLiveHint(''),6000)
    })
  }

  const questionTextRef=useRef(questionText); questionTextRef.current=questionText
  const repeatQuestion=()=>{ if(!questionTextRef.current) return; setPhase('speaking'); Speech.speak(questionTextRef.current, bcp).then(()=>{ if(activeRef.current) setTimeout(startListening,300)})}
  const retryWithoutRepeating=()=>{ if(!activeRef.current) return; setPhase('speaking'); const msg=lang==='hi' ? 'क्षमा करें, आपकी बात समझ नहीं आई। कृपया फिर बोलें।' : 'Sorry, I did not hear that. Please speak again.'; Speech.speak(msg,bcp).then(()=>{ if(activeRef.current) setTimeout(startListening,300)})}
  useEffect(()=>{ if(!activeRef.current) return; if(busy) return; if(questionText) speakAndListen(questionText)},[questionText])
  const begin=()=>{ activeRef.current=true; speakAndListen(questionText)}
  const stop=()=>{ activeRef.current=false; cleanupAudio(); Speech.stop(); setPhase('idle')}
  useEffect(()=>stop,[])

  const stateMeta={
    idle:{ label:'Tap to start the voice conversation', sub:'Dr. Sahayak will speak the question, then listen', tone:'idle'},
    speaking:{ label:'Dr. Sahayak is speaking…', sub:'Listen carefully — you can say “repeat” anytime', tone:'speaking'},
    listening:{ label: liveHint || 'Listening — speak now', sub:'Say your answer clearly. Ends automatically on silence.', tone:'listening'},
    thinking:{ label:'Understanding…', sub:'Transcribing with Gemini', tone:'thinking'},
  }[phase]

  return (
    <div className="h-full flex flex-col items-center justify-center gap-6 md:gap-8 text-center px-6 py-8">
      {/* orb — clinical trust: cyan ring, white core */}
      <div className="relative">
        <div className={`w-[172px] h-[172px] md:w-[196px] md:h-[196px] rounded-full flex items-center justify-center transition-all duration-300
          ${phase==='listening' ? 'bg-white border-[2.5px] shadow-[0_8px_32px_-8px_rgba(8,145,178,.28)]' : phase==='speaking' ? 'bg-[var(--color-surface-2)] border-2' : phase==='thinking' ? 'bg-[#FEF9E7] border-2 border-amber-200' : 'bg-white border-2'}`}
          style={{ borderColor: phase==='listening' ? 'var(--color-primary)' : phase==='speaking' ? 'var(--color-border-strong)' : phase==='thinking' ? undefined : 'var(--color-border)', color: phase==='listening' ? 'var(--color-primary)' : 'var(--color-foreground-strong)' }}>
          {phase==='idle' && <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="9" y="3" width="6" height="10" rx="3"/><path d="M5 11a7 7 0 0014 0"/><path d="M12 18v3M8 21h8"/></svg>}
          {phase==='speaking' && <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M14 9a5 5 0 010 6"/></svg>}
          {phase==='listening' && <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 14a3 3 0 003-3V7a3 3 0 00-6 0v4a3 3 0 003 3z"/><path d="M19 10a7 7 0 01-14 0"/><path d="M12 19v3"/><path d="M8 22h8"/></svg>}
          {phase==='thinking' && <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>}
        </div>
        {phase==='listening' && <span className="absolute -inset-2 rounded-full border pointer-events-none" style={{ borderColor:'rgba(8,145,178,.18)' }} />}
      </div>

      <div className="space-y-1.5 max-w-sm">
        <p className="display text-[18px] font-semibold" style={{ color:'var(--color-foreground-strong)' }}>{stateMeta.label}</p>
        <p className="text-xs leading-relaxed" style={{ color:'var(--color-faint)' }}>{stateMeta.sub}</p>
      </div>

      {phase==='listening' && (
        <div className="w-full max-w-sm space-y-3">
          <div className="progress-track h-1.5"><div className="h-full rounded-full transition-all" style={{ width:`${level}%`, background:'var(--color-primary)' }} /></div>
          {level===0 && <p className="text-xs font-medium" style={{ color:'var(--color-warning)' }}>Mic seems silent — check input device</p>}
          <div className="flex gap-2.5 justify-center">
            <button onClick={()=>{ try{recRef.current?.stop()}catch{}}} className="btn-ghost !min-h-[40px] text-xs">Done speaking</button>
            <button onClick={repeatQuestion} className="btn-ghost !min-h-[40px] text-xs">Repeat question</button>
          </div>
          <p className="text-[11px]" style={{ color:'var(--color-faint)' }}>Tip: say “repeat” / “phir se bolo” or ask about the app — LLM will answer</p>
        </div>
      )}

      {phase==='idle' ? (
        <button onClick={begin} disabled={!questionId} className="btn-primary px-10 py-3.5 text-[15px] disabled:opacity-40">Start voice conversation</button>
      ) : (
        <button onClick={stop} className="text-xs font-semibold underline" style={{ color:'var(--color-faint)' }}>Pause conversation</button>
      )}
    </div>
  )
}
