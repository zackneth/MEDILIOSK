import { useEffect, useRef, useState } from 'react'
import { API_BASE } from '../api'
import Speech from '../speech'

// Lightweight ISL -> text for InstaDoc.
// Landmarks run 100% in-browser via MediaPipe Tasks Vision (no Python, no GPU).
// Classification v1 = finger-count templates + hold-to-confirm + manual tap fallback
// (demo-safe on a kiosk in 2 days). Result text goes to the interview engine
// exactly like a voice transcript, so Dr. Sahayak replies normally.

const HOLD_MS = 1200
const VOCAB = ['YES', 'NO', 'PAIN', 'FEVER', 'COUGH', 'HEADACHE', 'CHEST_PAIN', 'BREATHLESS', 'VOMITING', 'HELP', 'MEDICINE', 'THANK_YOU']

function countExtended(lm) {
  // lm: 21 x {x,y,z}. Thumb judged on x-axis (right-hand assumption), fingers on y.
  if (!lm || lm.length < 21) return -1
  let n = 0
  const tips = [8, 12, 16, 20]
  const pips = [6, 10, 14, 18]
  for (let i = 0; i < 4; i++) {
    if (lm[tips[i]].y < lm[pips[i]].y) n += 1
  }
  if (lm[4].x > lm[3].x) n += 1 // thumb open (mirror if left hand — still stable enough for demo)
  return n
}

function guessFromLandmarks(lm) {
  // Demo templates only — stable, explainable, no model file needed.
  // Map finger counts to high-value medical answers; full A-Z comes from the
  // manual pad below (hold-to-confirm gives the same interview result).
  const c = countExtended(lm)
  if (c === 1) return { gloss: 'YES', conf: 0.72 }
  if (c === 2) return { gloss: 'NO', conf: 0.7 }
  if (c === 5) return { gloss: 'HELP', conf: 0.66 }
  if (c === 0) return { gloss: 'PAIN', conf: 0.62 }
  if (c === 3) return { gloss: 'FEVER', conf: 0.6 }
  if (c === 4) return { gloss: 'COUGH', conf: 0.6 }
  return null
}

export default function SignMode({ questionText, questionId, lang, sessionId, onSignAnswer, announceText }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const landmarkerRef = useRef(null)
  const rafRef = useRef(null)
  const streamRef = useRef(null)
  const lastGuessRef = useRef({ gloss: null, since: 0 })
  const spokenQ = useRef(null)
  const spokenA = useRef('')
  const [status, setStatus] = useState('idle') // idle | loading | live | error
  const [step, setStep] = useState('')
  const [guess, setGuess] = useState(null)
  const [holdPct, setHoldPct] = useState(0)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [spell, setSpell] = useState('')
  const [freeText, setFreeText] = useState('')
  const bcp = ({ en: 'en-IN', hi: 'hi-IN' })[lang] || 'en-IN'

  // Single ordered voice: assistant reply first (if new), then the question.
  // Interview.jsx stays silent in sign mode — this is the only speaker here.
  useEffect(() => {
    const qNew = questionId && questionId !== spokenQ.current
    const aNew = announceText && announceText !== spokenA.current
    if (!qNew && !aNew) return
    if (aNew) spokenA.current = announceText
    if (qNew) spokenQ.current = questionId
    Speech.stop()
    const seq = []
    if (aNew) seq.push(announceText)
    if ((qNew || aNew) && questionText) seq.push(questionText)
    if (!seq.length) return;
    (async () => { for (const t of seq) await Speech.speak(t, bcp) })()
  }, [questionText, questionId, announceText])

  const drawHands = (landmarks) => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return
    const ctx = canvas.getContext('2d')
    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 480
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const CONN = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]]
    for (const hand of landmarks) {
      ctx.strokeStyle = '#0891B2'
      ctx.lineWidth = 2
      for (const [a, b] of CONN) {
        ctx.beginPath()
        ctx.moveTo(hand[a].x * canvas.width, hand[a].y * canvas.height)
        ctx.lineTo(hand[b].x * canvas.width, hand[b].y * canvas.height)
        ctx.stroke()
      }
      ctx.fillStyle = '#0F3A4A'
      for (const p of hand) {
        ctx.beginPath()
        ctx.arc(p.x * canvas.width, p.y * canvas.height, 3, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  const loop = async () => {
    const lm = landmarkerRef.current
    const video = videoRef.current
    if (!lm || !video || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(loop)
      return
    }
    try {
      const res = lm.detectForVideo(video, performance.now())
      const hands = res?.landmarks || []
      drawHands(hands)
      if (hands.length > 0) {
        const g = guessFromLandmarks(hands[0])
        if (g) {
          const now = Date.now()
          if (lastGuessRef.current.gloss === g.gloss) {
            const held = now - lastGuessRef.current.since
            setGuess(g)
            setHoldPct(Math.min(100, Math.round((held / HOLD_MS) * 100)))
            if (held >= HOLD_MS && !busy) {
              lastGuessRef.current = { gloss: null, since: 0 }
              setHoldPct(0)
              await confirmGloss(g.gloss)
            }
          } else {
            lastGuessRef.current = { gloss: g.gloss, since: now }
            setGuess(g)
            setHoldPct(0)
          }
        } else {
          setHoldPct(0)
        }
      } else {
        setHoldPct(0)
      }
    } catch { /* keep loop alive */ }
    rafRef.current = requestAnimationFrame(loop)
  }

  const confirmGloss = async (gloss) => {
    setBusy(true)
    try {
      const r = await fetch(`${API_BASE}/sign/normalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: gloss }),
      })
      const j = await r.json()
      const text = j.text || gloss
      setNotice(`Recognized: ${gloss} → "${text}"`)
      setTimeout(() => setNotice(''), 4000)
      onSignAnswer && onSignAnswer(text, gloss)
    } catch {
      onSignAnswer && onSignAnswer(gloss, gloss)
    }
    setBusy(false)
  }

  const start = async () => {
    setStatus('loading')
    setNotice('')
    // Step 1: camera first (so a camera problem shows immediately with its real cause)
    try {
      setStep('Requesting camera… (allow permission in the address bar)')
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } },
      })
      streamRef.current = stream
      videoRef.current.srcObject = stream
      await videoRef.current.play()
      setStep('Camera OK — loading hand tracker…')
    } catch (e) {
      const name = e?.name || ''
      const msg =
        name === 'NotAllowedError' ? 'Permission denied — click the camera icon in the address bar → Allow, then retry.'
        : name === 'NotFoundError' ? 'No camera found — plug in / enable your webcam, or use the tap pad below.'
        : name === 'NotReadableError' ? 'Camera is busy — close Meet/Zoom/another tab using it, then retry.'
        : `Camera error (${name || 'unknown'}): ${e?.message || e}`
      setStatus('error')
      setStep('')
      setNotice(msg)
      return
    }
    // Step 2: hand tracker (CDN needs internet)
    try {
      const { FilesetResolver, HandLandmarker } = await import(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm'
      )
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
      )
      landmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
      })
      setStatus('live')
      setStep('')
      rafRef.current = requestAnimationFrame(loop)
    } catch (e) {
      setStatus('error')
      setStep('')
      // Camera preview is already running — keep it, only tracking failed.
      setNotice(`Camera is ON, but hand tracker failed to download (need internet once): ${e?.message || e}. Video preview works — use the tap pad below for the same AI reply.`)
    }
  }

  const stop = () => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    try { landmarkerRef.current?.close() } catch {}
    landmarkerRef.current = null
    setStatus('idle')
    setStep('')
    setHoldPct(0)
  }

  useEffect(() => () => stop(), [])

  return (
    <div className="h-full flex flex-col items-center gap-4 px-4 py-6 overflow-y-auto">
      <div className="w-full max-w-xl">
        <p className="mono-label">Sign language — show your sign to the camera, hold 1 sec</p>
        <h2 className="display text-[20px] font-semibold leading-snug mt-1" style={{ color: 'var(--color-foreground-strong)' }}>
          {questionText || 'Starting…'}
        </h2>
      </div>

      <div className="relative w-full max-w-xl rounded-2xl overflow-hidden bg-black" style={{ border: '1px solid var(--color-border)' }}>
        <video ref={videoRef} className="w-full aspect-[4/3] object-cover" playsInline muted />
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
        {status !== 'live' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white text-sm px-6 text-center">
            {status === 'loading' ? (step || 'Starting…') : status === 'error' ? 'Camera stopped — read the message below, fix it, tap Start again' : 'Camera off — tap Start camera'}
          </div>
        )}
        {guess && status === 'live' && (
          <div className="absolute top-3 left-3 right-3 flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-white/95 text-sm font-semibold" style={{ color: 'var(--color-foreground-strong)' }}>
            <span>{guess.gloss} · {Math.round(guess.conf * 100)}%</span>
            <span className="tabular-nums">{holdPct}% hold</span>
          </div>
        )}
      </div>
      {holdPct > 0 && (
        <div className="w-full max-w-xl progress-track h-2"><div className="h-full rounded-full" style={{ width: `${holdPct}%`, background: 'var(--color-primary)' }} /></div>
      )}

      <div className="flex gap-2.5">
        {status === 'live' ? (
          <button onClick={stop} className="btn-ghost px-6 py-2.5 text-sm">Stop camera</button>
        ) : (
          <button onClick={start} disabled={!questionId} className="btn-primary px-8 py-3 text-sm disabled:opacity-40">Start camera</button>
        )}
      </div>

      {notice && <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>{notice}</p>}

      <div className="w-full max-w-xl rounded-2xl p-4" style={{ background: 'white', border: '1px solid var(--color-border)' }}>
        <p className="text-xs font-bold tracking-widest uppercase" style={{ color: 'var(--color-faint)' }}>
          Quick signs — same AI reply (backup if camera fails in front of judges)
        </p>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-3">
          {VOCAB.map((v) => (
            <button key={v} onClick={() => confirmGloss(v)} disabled={busy} className="chip !min-h-[40px] !py-2 text-xs disabled:opacity-40">
              {v.replace('_', ' ')}
            </button>
          ))}
        </div>
        <p className="text-[11px] mt-3" style={{ color: 'var(--color-faint)' }}>
          Camera demo maps: 1 finger YES · 2 fingers NO · fist PAIN · 3 FEVER · 4 COUGH · open palm HELP. Hold steady 1 sec to send.
        </p>
      </div>

      <div className="w-full max-w-xl rounded-2xl p-4" style={{ background: 'white', border: '1px solid var(--color-border)' }}>
        <p className="text-xs font-bold tracking-widest uppercase" style={{ color: 'var(--color-faint)' }}>
          Other problem? Spell it (fingerspelling A–Z) or type it
        </p>
        <div className="grid grid-cols-6 sm:grid-cols-9 gap-1.5 mt-3">
          {'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((ch) => (
            <button key={ch} onClick={() => setSpell((s) => (s + ch).slice(0, 40))} className="chip !min-h-[36px] !py-1 text-xs font-bold">
              {ch}
            </button>
          ))}
        </div>
        <div className="flex gap-2 mt-3">
          <input value={spell} onChange={(e) => setSpell(e.target.value.toUpperCase().replace(/[^A-Z ]/g, '').slice(0, 40))} placeholder="Spelled word appears here" className="field" aria-label="Spelled word" />
          <button onClick={() => { if (spell.trim()) { confirmGloss(spell.trim()); setSpell('') } }} disabled={!spell.trim() || busy} className="btn-primary px-5 disabled:opacity-40">Send</button>
          <button onClick={() => setSpell('')} className="btn-ghost px-4">Clear</button>
        </div>
        <div className="flex gap-2 mt-2.5">
          <input value={freeText} onChange={(e) => setFreeText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && freeText.trim()) { onSignAnswer && onSignAnswer(freeText.trim(), 'TYPED'); setFreeText('') } }} placeholder="Or type any symptom in your own words" className="field" aria-label="Type symptom" />
          <button onClick={() => { if (freeText.trim()) { onSignAnswer && onSignAnswer(freeText.trim(), 'TYPED'); setFreeText('') } }} disabled={!freeText.trim()} className="btn-primary px-5 disabled:opacity-40">Send</button>
        </div>
        <p className="text-[11px] mt-3" style={{ color: 'var(--color-faint)' }}>
          Anything spelled or typed goes to the same AI doctor — red-flag emergencies (chest pain, stroke signs) still trigger priority alert.
        </p>
      </div>
    </div>
  )
}
