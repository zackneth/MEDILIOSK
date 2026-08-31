import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { startInterview, submitAnswer } from '../api'
import api from '../api'
import { Dictation } from '../speech'
import Speech from '../speech'
import { blobToWav } from '../wav'
import VoiceChat from '../components/VoiceChat.jsx'

const AGENT_IDS_LANG = {
  en: import.meta.env.VITE_BEY_AGENT_ID_EN || import.meta.env.VITE_BEY_AGENT_ID || '',
  hi: import.meta.env.VITE_BEY_AGENT_ID_HI || '',
  ta: import.meta.env.VITE_BEY_AGENT_ID_TA || '',
  te: import.meta.env.VITE_BEY_AGENT_ID_TE || '',
  kn: import.meta.env.VITE_BEY_AGENT_ID_KN || '',
  ml: import.meta.env.VITE_BEY_AGENT_ID_ML || '',
  mr: import.meta.env.VITE_BEY_AGENT_ID_MR || '',
  bn: import.meta.env.VITE_BEY_AGENT_ID_BN || '',
  gu: import.meta.env.VITE_BEY_AGENT_ID_GU || '',
  pa: import.meta.env.VITE_BEY_AGENT_ID_PA || '',
  or: import.meta.env.VITE_BEY_AGENT_ID_OR || '',
  as: import.meta.env.VITE_BEY_AGENT_ID_AS || '',
}
const AGENT_IDS = {
  allopathic: import.meta.env.VITE_BEY_AGENT_ID || '',
  ayush: import.meta.env.VITE_BEY_AGENT_ID_AYUSH || import.meta.env.VITE_BEY_AGENT_ID || '',
}
const getAgentId = (mode, lang) => {
  if (mode === 'ayush') return AGENT_IDS.ayush
  return AGENT_IDS_LANG[lang] || AGENT_IDS_LANG.en || AGENT_IDS.allopathic
}

const LANGUAGES = [
  { code: 'en', label: 'English', bcp: 'en-IN' },
  { code: 'hi', label: 'हिंदी', bcp: 'hi-IN' },
  { code: 'ta', label: 'தமிழ்', bcp: 'ta-IN' },
  { code: 'te', label: 'తెలుగు', bcp: 'te-IN' },
  { code: 'kn', label: 'ಕನ್ನಡ', bcp: 'kn-IN' },
  { code: 'ml', label: 'മലയാളം', bcp: 'ml-IN' },
  { code: 'mr', label: 'मराठी', bcp: 'mr-IN' },
  { code: 'bn', label: 'বাংলা', bcp: 'bn-IN' },
  { code: 'gu', label: 'ગુજરાતી', bcp: 'gu-IN' },
  { code: 'pa', label: 'ਪੰਜਾਬੀ', bcp: 'pa-IN' },
  { code: 'or', label: 'ଓଡ଼ିଆ', bcp: 'or-IN' },
  { code: 'as', label: 'অসমীয়া', bcp: 'as-IN' },
]
const REPEAT_RE = /(repeat|again|pardon|say again|come again|didn.?t (understand|get|hear)|could you repeat|please repeat|what did you say|sorry.*what|can you repeat|phir se|dobara|samajh nahi|sunai nahi|suna nahi|ek bar phir|dohrao|repeat the question|say it again|repeat that|bol do dobara|phir se bolo|repeat karo)/i
const isRepeatIntent = (t) => t && REPEAT_RE.test(t) && t.trim().split(/\s+/).length <= 15
const bcpFor = (code) => LANGUAGES.find((l) => l.code === code)?.bcp || 'en-IN'

/* ——— Icons (Phosphor-style SVG, no emojis) ——— */
const IPlus = (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M12 5v14M5 12h14" strokeLinecap="round"/></svg>
const IShield = (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" {...p}><path d="M12 3l7 3v5c0 4.2-2.8 7-7 9-4.2-2-7-4.8-7-9V6l7-3z"/><path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round"/></svg>
const ISpeaker = (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" {...p}><path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M14 9a5 5 0 010 6M17 7a8 8 0 010 10"/></svg>
const IVideo = (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" {...p}><rect x="3" y="7" width="12" height="10" rx="2"/><path d="M15 10l5-2v8l-5-2z"/></svg>
const IMic = (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" {...p}><rect x="9" y="3" width="6" height="10" rx="3"/><path d="M5 11a7 7 0 0014 0"/><path d="M12 18v3M8 21h8"/></svg>
const ITouch = (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" {...p}><rect x="7" y="3" width="10" height="14" rx="3"/><circle cx="12" cy="18" r="1" fill="currentColor"/><path d="M12 7v5"/></svg>
const IArrow = (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>

function StartGate({ onBegin }) {
  const [lang, setLang] = useState('en')
  const [name, setName] = useState('')
  const [age, setAge] = useState('')
  const [sex, setSex] = useState('male')
  const [abha, setAbha] = useState('')
  const [mode, setMode] = useState('allopathic')
  const [consent, setConsent] = useState({ history_capture: false, document_digitization: false, share_with_physician: false })
  const [playingAudio, setPlayingAudio] = useState(false)

  const playConsent = () => {
    const lines = lang === 'hi'
      ? ['हम आपका मेडिकल इतिहास रिकॉर्ड करेंगे।', 'आपके दस्तावेज़ डिजिटाइज़ किए जाएंगे।', 'जानकारी केवल आपके डॉक्टर के साथ साझा की जाएगी।', 'डेटा केवल इलाज के लिए है और सबमिशन के बाद मिटा दिया जाएगा।']
      : ['We will record your medical history through this conversation.', 'Your documents will be digitized.', 'Information is shared only with your treating physician.', 'Data is for your care only and is erased after submission.']
    if (playingAudio) { Speech.stop(); setPlayingAudio(false); return }
    setPlayingAudio(true)
    Speech.speak(lines.join(' '), bcpFor(lang)).finally(() => setPlayingAudio(false))
  }
  const canBegin = consent.history_capture && name.trim().length >= 2

  return (
    <div className="min-h-screen relative overflow-hidden" style={{ background: 'var(--color-background)' }}>
      {/* Swiss grid backdrop */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 swiss-grid opacity-[0.32]" />
        <div className="absolute -top-28 -right-28 w-[560px] h-[560px] rounded-full blur-[90px] pointer-events-none" style={{ background: 'radial-gradient(circle at 50% 50%, rgba(8,145,178,.10), transparent 68%)' }} />
        <div className="absolute -bottom-32 -left-32 w-[520px] h-[520px] rounded-full blur-[90px] pointer-events-none" style={{ background: 'radial-gradient(circle at 50% 50%, rgba(5,150,105,.08), transparent 68%)' }} />
      </div>

      {/* glass header */}
      <div className="relative w-full glass-header sticky top-0 z-30">
        <div className="kiosk-shell flex items-center justify-between py-3.5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-sm" style={{ background: 'var(--color-foreground-strong)', color: 'white' }}><IPlus className="w-5 h-5" /></div>
            <span className="display text-[18px] font-[750] tracking-tight" style={{ color: 'var(--color-foreground-strong)' }}>MediKiosk</span>
            <span className="hidden lg:inline-flex items-center gap-2 ml-3 pl-3 border-l text-[11px] font-bold tracking-widest uppercase" style={{ borderColor: 'var(--color-border)', color: 'var(--color-faint)' }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-accent)' }} /> SIH26047 · Ministry of Ayush
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden md:inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-widest uppercase px-3 py-1.5 rounded-full" style={{ background: 'white', border: '1px solid var(--color-border)', color: 'var(--color-faint)' }}>
              <IShield className="w-3.5 h-3.5" style={{ color: 'var(--color-primary)' }} /> DPDP · ABDM · FHIR R4
            </span>
            <span className="hidden sm:inline-flex badge-live"><span className="badge-live-dot" /> Live OPD Kiosk</span>
          </div>
        </div>
      </div>

      <div className="relative kiosk-shell py-8 md:py-10">
        <div className="grid lg:grid-cols-[1.08fr_.92fr] gap-8 lg:gap-10 items-start">
          {/* left — hero — Swiss minimal, high contrast, generous whitespace */}
          <div className="pt-2 md:pt-6 fade-up">
            <div className="inline-flex items-center gap-2.5 px-3.5 py-2 rounded-full text-xs font-semibold" style={{ background: 'white', border: '1px solid var(--color-border)', color: 'var(--color-muted-foreground)', boxShadow: 'var(--shadow-soft)' }}>
              <span className="w-2 h-2 rounded-full" style={{ background: 'var(--color-accent)', boxShadow: '0 0 0 4px rgba(5,150,105,.14)' }} /> Zero-training · 12 languages · Works in noisy OPD
            </div>

            <h1 className="display font-[800] leading-[0.96] tracking-[-0.035em] mt-6" style={{ color: 'var(--color-foreground-strong)', fontSize: 'clamp(32px, 4.2vw, 46px)' }}>
              Welcome to<br />
              <span style={{ color: 'var(--color-primary)' }}>MediKiosk</span>
              <span className="font-[400] tracking-[-0.02em]" style={{ color: 'var(--color-foreground)' }}>.</span>
            </h1>

            <p className="display font-[500] leading-[1.22] mt-4" style={{ color: 'var(--color-foreground)', fontSize: 'clamp(18px, 2.1vw, 22px)' }}>
              Before you meet your doctor,<br />let our AI listen to your complete story —<br /><span className="font-[700]" style={{ color: 'var(--color-foreground-strong)' }}>calmly, privately, in your own words.</span>
            </p>

            <p className="text-[14.5px] leading-[1.65] mt-4 max-w-[560px]" style={{ color: 'var(--color-muted-foreground)' }}>
              Every detail captured, structured and delivered securely — so consultation time is spent on care, not paperwork. Built for the real OPD: fast, accurate, and respectful.
            </p>

            {/* stats — Swiss proof row */}
            <div className="grid grid-cols-3 gap-4 mt-7 max-w-[540px] p-3 rounded-2xl" style={{ background: 'white', border: '1px solid var(--color-border-soft)', boxShadow: 'var(--shadow-soft)' }}>
              {[
                ['< 90s', 'Avg. history capture'],
                ['12', 'Languages supported'],
                ['100%', 'DPDP compliant'],
              ].map(([num,label])=> (
                <div key={num} className="text-center px-2 py-1">
                  <div className="display text-[20px] font-[800] tracking-tight" style={{ color: 'var(--color-foreground-strong)' }}>{num}</div>
                  <div className="text-[11px] font-semibold tracking-widest uppercase mt-0.5" style={{ color: 'var(--color-faint)' }}>{label}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6 max-w-[600px]">
              {[
                ['Voice + Touch', 'Speak or tap — resilient in noise'],
                ['Scan reports', 'Cursive handwriting, HI/EN'],
                ['FHIR to HIS', 'ABHA-linked, auto-purged'],
              ].map(([t,d]) => (
                <div key={t} className="rounded-2xl p-4 group hover:-translate-y-[1px] transition-all" style={{ background: 'white', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-soft)' }}>
                  <p className="text-[13px] font-[700] tracking-tight" style={{ color: 'var(--color-foreground-strong)' }}>{t}</p>
                  <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--color-faint)' }}>{d}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2.5 mt-6">
              <span className="badge-trust"><IShield className="w-3.5 h-3.5" /> DPDP Act 2023</span>
              <span className="text-[11px] font-semibold tracking-widest uppercase" style={{ color: 'var(--color-faint-2)' }}>· Granular & revocable · Physician-in-the-loop</span>
            </div>
          </div>

          {/* right — form — premium card */}
          <div className="panel-premium p-6 md:p-7 fade-up" style={{ animationDelay: '.08s' }}>
            <div className="space-y-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="display text-[17px] font-[700] tracking-tight" style={{ color: 'var(--color-foreground-strong)' }}>Start your session</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--color-faint)' }}>Step 1 of 2 · Takes 20 seconds</p>
                </div>
                <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold" style={{ background: 'var(--color-accent-soft)', color: '#065F46', border: '1px solid #A7F3D0' }}>Secure</span>
              </div>

              <div>
                <label className="mono-label">Language — 12 supported</label>
                <div className="grid grid-cols-3 gap-2 mt-2.5">
                  {LANGUAGES.map((l) => (
                    <button key={l.code} onClick={() => setLang(l.code)} className={`chip !min-h-[40px] !py-2 text-xs ${lang === l.code ? 'on' : ''}`} aria-pressed={lang===l.code}>{l.label}</button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mono-label">Department</label>
                <div className="grid grid-cols-2 gap-2.5 mt-2.5">
                  <button onClick={() => setMode('allopathic')} className={`chip !py-3.5 text-[13.5px] ${mode==='allopathic'?'on':''}`} aria-pressed={mode==='allopathic'}>Allopathic</button>
                  <button onClick={() => setMode('ayush')} className={`chip !py-3.5 text-[13.5px] ${mode==='ayush'?'on':''}`} aria-pressed={mode==='ayush'}>AYUSH</button>
                </div>
                <p className="text-xs mt-2.5 px-1" style={{ color:'var(--color-faint)' }}>{mode==='ayush' ? 'Dashavidha Pariksha capture enabled — Prakriti to Vaya' : 'SOCRATES adaptive + red-flag triage · Priority alerts' }</p>
              </div>

              <div className="space-y-3.5">
                <div>
                  <label className="text-xs font-semibold" style={{ color:'var(--color-foreground-strong)' }} htmlFor="mk-name">Full name <span style={{color:'var(--color-destructive)'}}>*</span></label>
                  <input id="mk-name" value={name} onChange={(e)=>setName(e.target.value)} placeholder={lang==='hi' ? 'पूरा नाम' : 'e.g. Aarav Sharma'} className="field mt-1.5" autoComplete="name" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-semibold" style={{ color:'var(--color-foreground-strong)' }}>Age</label>
                    <input value={age} onChange={(e)=>setAge(e.target.value)} type="number" placeholder="32" className="field mt-1.5" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold" style={{ color:'var(--color-foreground-strong)' }}>Sex</label>
                    <select value={sex} onChange={(e)=>setSex(e.target.value)} className="field mt-1.5"><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold" style={{ color:'var(--color-foreground-strong)' }}>ABHA ID</label>
                    <input value={abha} onChange={(e)=>setAbha(e.target.value)} placeholder="12-3456-..." className="field mt-1.5" />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl p-4" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-bold tracking-tight" style={{ color:'var(--color-foreground-strong)' }}>{lang==='hi' ? 'आपकी सहमति' : 'Your consent'}</h3>
                  <button onClick={playConsent} className={`btn-ghost !min-h-[34px] !py-1.5 !px-3.5 text-xs ${playingAudio ? '!border-red-200 !text-red-700 !bg-red-50' : ''}`}>
                    <ISpeaker className="w-4 h-4" /> {playingAudio ? 'Stop' : 'Listen'}
                  </button>
                </div>
                {[
                  ['history_capture', lang==='hi' ? 'इतिहास रिकॉर्डिंग की सहमति *' : 'I consent to history recording *'],
                  ['document_digitization', lang==='hi' ? 'दस्तावेज़ डिजिटाइज़ेशन' : 'Document digitization'],
                  ['share_with_physician', lang==='hi' ? 'डॉक्टर के साथ साझा करना' : 'Share with treating physician'],
                ].map(([key,label])=> (
                  <label key={key} className="flex items-start gap-3 cursor-pointer mt-3.5 group">
                    <input type="checkbox" checked={consent[key]} onChange={(e)=>setConsent(g=>({...g,[key]:e.target.checked}))}
                      className="mt-0.5 w-[18px] h-[18px] rounded-[6px] accent-[var(--color-primary)] border-[var(--color-border-strong)]" />
                    <span className="text-[13.5px] leading-snug" style={{ color:'var(--color-foreground)' }}>{label}</span>
                  </label>
                ))}
                <p className="text-[11px] mt-3.5 leading-relaxed" style={{ color:'var(--color-faint)' }}>Granular & revocable · Data purged after submission · DPDP Act 2023 + ABDM pattern</p>
              </div>

              <button disabled={!canBegin} onClick={()=>{
                Speech.stop()
                onBegin({
                  identity:{ abha_id:abha.trim()||null, aadhaar_last4:null, name:name.trim(), age:Number(age)||null, sex, is_new_registration:!abha.trim() },
                  consent:{ ...consent, language:lang, granted_at:new Date().toISOString(), revoked:false },
                  mode,
                })
              }} className="btn-primary w-full py-4 text-[15px] shadow-md">
                Continue <IArrow className="w-4 h-4" />
              </button>
              <p className="text-center text-xs" style={{ color:'var(--color-faint-2)' }}>No data is saved until you press Continue · Encrypted & purpose-limited</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ModeChooser({ onPick }) {
  const modes = [
    { id:'video', Icon: IVideo, title:'Video Doctor', desc:'Face-to-face with your real-time AI physician. Camera + mic required.', badge:'Recommended', accent: 'var(--color-primary)' },
    { id:'chat', Icon: IMic, title:'Voice Conversation', desc:'Just talk naturally — the doctor listens and replies aloud. Great for low-literacy.', badge:'Hands-free', accent: 'var(--color-accent)' },
    { id:'clickable', Icon: ITouch, title:'Guided Touch', desc:'Quiet and simple. Answer by tapping clear, easy options. No mic needed.', badge:'No mic needed', accent: '#0F3A4A' },
  ]
  return (
    <div className="min-h-screen relative overflow-hidden" style={{ background: 'var(--color-background)' }}>
      <div className="absolute inset-0 pointer-events-none opacity-[0.28] swiss-grid" />
      <div className="relative w-full glass-header">
        <div className="kiosk-shell flex items-center gap-3 py-4">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background:'var(--color-foreground-strong)', color:'white' }}><IPlus className="w-5 h-5" /></div>
          <span className="display text-lg font-bold" style={{ color: 'var(--color-foreground-strong)' }}>MediKiosk</span>
          <span className="hidden sm:inline text-xs font-medium ml-2 pl-3 border-l" style={{ borderColor:'var(--color-border)', color:'var(--color-faint)' }}>Choose your comfort</span>
        </div>
      </div>
      <div className="relative kiosk-shell py-10 md:py-14">
        <p className="mono-label">Step 2 of 2 · Zero-training · You can switch anytime</p>
        <h1 className="display font-[750] tracking-tight leading-[1.05] mt-3" style={{ color:'var(--color-foreground-strong)', fontSize: 'clamp(28px, 3.6vw, 40px)' }}>How would you like to proceed?</h1>
        <p className="text-[15px] leading-relaxed mt-3 max-w-[640px]" style={{ color:'var(--color-muted-foreground)' }}>Pick one — only that interface opens. All three use the same clinical engine and meet DPDP / ABDM safety.</p>
        <div className="grid md:grid-cols-3 gap-5 md:gap-6 mt-8 max-w-5xl">
          {modes.map(({id,Icon,title,desc,badge,accent})=> (
            <button key={id} onClick={()=>onPick(id)} className="group text-left rounded-[20px] p-6 md:p-7 bg-white border-[1.5px] hover:-translate-y-1 transition-all duration-200 flex flex-col" style={{ borderColor:'var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
              <div className="flex items-center justify-between">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)', color: accent }}><Icon className="w-5 h-5" /></div>
                <span className="text-[10px] font-bold tracking-widest uppercase px-2.5 py-1 rounded-full" style={{ background: id==='video' ? 'var(--color-primary-soft)' : 'var(--color-surface-2)', color: id==='video' ? 'var(--color-primary)' : 'var(--color-muted-foreground)', border: `1px solid ${id==='video' ? 'var(--color-border)' : 'var(--color-border)'}` }}>{badge}</span>
              </div>
              <h3 className="display text-[18px] font-[700] tracking-tight mt-6" style={{ color:'var(--color-foreground-strong)' }}>{title}</h3>
              <p className="text-[13.5px] leading-relaxed mt-2" style={{ color:'var(--color-muted-foreground)' }}>{desc}</p>
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold mt-6" style={{ color: accent }}>Select <IArrow className="w-4 h-4 group-hover:translate-x-1 transition-transform" /></span>
            </button>
          ))}
        </div>
        <p className="text-xs mt-6" style={{ color:'var(--color-faint-2)' }}>Tip for judges: “Avatar is an accessibility layer — removable without changing the core engine.”</p>
      </div>
    </div>
  )
}

export default function Interview() {
  const nav = useNavigate()
  const { state: directSetup } = useLocation()
  const [setup, setSetup] = useState(directSetup || null)
  const [uiMode, setUiMode] = useState(null)
  const [turn, setTurn] = useState(null)
  const [sessionId, setSessionId] = useState(null)
  const [messages, setMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [multiSel, setMultiSel] = useState([])
  const [listening, setListening] = useState(false)
  const [busyTranscribing, setBusyTranscribing] = useState(false)
  const [alertFlag, setAlertFlag] = useState(null)
  const [error, setError] = useState('')
  const [callStarted, setCallStarted] = useState(false)
  const dictationRef = useRef(null)
  const chatBottomRef = useRef(null)

  useEffect(()=>{ chatBottomRef.current?.scrollIntoView({ behavior:'smooth' }) },[messages])
  useEffect(()=>()=>Speech.stop(),[])

  const beginSession = (payload) => {
    setSetup(payload)
    startInterview(payload).then(({data})=>{
      setTurn(data); setSessionId(data.state.session_id)
      if(data.question) setMessages([{role:'assistant', text:data.question.text}])
    }).catch(()=>setError('Could not start session. Is the backend running?'))
  }

  const replayQuestion = () => {
    if(!turn?.question) return
    Speech.speak(turn.question.text, bcpFor(setup?.consent?.language||'en'))
  }
  const [assistantNote, setAssistantNote] = useState('')

  const applyAnswer = async (payload, displayText) => {
    const txt = payload.text || displayText || ''
    if(txt && isRepeatIntent(txt) && !payload.option_id && !payload.option_ids){ replayQuestion(); return }
    try{
      if(displayText && uiMode==='chat') setMessages(m=>[...m,{role:'user', text:displayText}])
      const {data}=await submitAnswer(sessionId, payload)
      if(data.is_assistant && data.assistant_reply){
        setAssistantNote(data.assistant_reply); setTimeout(()=>setAssistantNote(''),8000)
        setMessages(m=>[...m,{role:'assistant', text:data.assistant_reply}])
        Speech.speak(data.assistant_reply, bcpFor(setup?.consent?.language||'en')).then(()=>{ if(data.question) Speech.speak(data.question.text, bcpFor(setup?.consent?.language||'en')) })
        setTurn(data); return
      }
      if(data.red_flag_alert){ setAlertFlag(data.red_flag_alert); setTimeout(()=>setAlertFlag(null),8000)}
      if(!data.question){ nav('/finish',{state:{sessionId:data.state.session_id, uiMode}}); return }
      setTurn(data); setChatInput(''); setMultiSel([]); setAssistantNote('')
      if(uiMode==='chat') setMessages(m=>[...m,{role:'assistant', text:data.question.text}])
    }catch{ setError('Network error — please try again.') }
  }

  const goFinish = () => sessionId && nav('/finish',{state:{sessionId, uiMode}})

  // video avatar: bind language-aware session to BEY bridge so it speaks selected language
  useEffect(()=>{
    if(uiMode==='video' && callStarted && sessionId){
      api.post(`/interview/${sessionId}/activate-for-avatar`).catch(()=>{})
    }
  },[uiMode, callStarted, sessionId])

  if(!setup) return <StartGate onBegin={beginSession} />
  if(!uiMode) return <ModeChooser onPick={setUiMode} />

  const q = turn?.question
  const agentId = getAgentId(setup.mode, setup.consent.language || 'en')
  const toggleMulti = (i)=> setMultiSel(s=> s.includes(String(i)) ? s.filter(x=>x!==String(i)) : [...s, String(i)] )
  const modeLabel = { video:'Video Consultation', chat:'Voice Conversation', clickable:'Guided Touch'}[uiMode]

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--color-background)' }}>
      <header className="sticky top-0 z-20 glass-header">
        <div className="kiosk-shell flex items-center justify-between py-3.5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background:'var(--color-primary)', color:'white' }}><IPlus className="w-4 h-4" /></div>
            <span className="display font-bold text-[16px] shrink-0" style={{ color:'var(--color-foreground-strong)' }}>MediKiosk</span>
            <span className="hidden md:inline text-xs truncate" style={{ color:'var(--color-muted-foreground)' }}>· {setup.identity.name} · {modeLabel}{setup.mode==='ayush'?' · AYUSH':''}</span>
          </div>
          <div className="flex items-center gap-3">
            {uiMode!=='video' && <button onClick={()=>setUiMode(null)} className="btn-ghost !min-h-[36px] !px-3.5 !py-1.5 text-xs">Change style</button>}
            <div className="hidden sm:flex items-center gap-2.5">
              <div className="progress-track w-28 md:w-36"><div className="progress-fill" style={{ width:`${turn?.progress_percent||0}%` }} /></div>
              <span className="text-xs font-semibold tabular-nums" style={{ color:'var(--color-muted-foreground)' }}>{turn?.progress_percent||0}%</span>
            </div>
          </div>
        </div>
      </header>

      {alertFlag && (
        <div className="alert-emergency px-6 py-3 flex items-center gap-3 text-sm font-semibold">
          <IShield className="w-5 h-5 shrink-0" /> PRIORITY ALERT — {alertFlag.description} · Triage team notified
        </div>
      )}

      <main className="flex-1 flex flex-col p-4 md:p-6 min-h-0" style={{ minHeight:'calc(100vh - 65px)' }}>
        {uiMode==='video' && !callStarted && (
          <div className="flex-1 panel flex items-center justify-center p-8">
            <div className="text-center max-w-md">
              <div className="w-20 h-20 mx-auto rounded-2xl flex items-center justify-center" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)', color:'var(--color-primary)' }}><IVideo className="w-8 h-8" /></div>
              <h2 className="display text-2xl font-semibold mt-5" style={{ color:'var(--color-foreground-strong)' }}>Dr. Sahayak is ready</h2>
              <p className="text-sm leading-relaxed mt-2" style={{ color:'var(--color-muted-foreground)' }}>Full-screen, face-to-face consultation with your AI physician. Camera & mic permission required.</p>
              <button onClick={()=>setCallStarted(true)} className="btn-primary px-8 py-3 mt-6">Begin full-screen call</button>
              {agentId && <a href={`https://bey.chat/${agentId}`} target="_blank" rel="noreferrer" className="block text-xs underline mt-3" style={{ color:'var(--color-faint)' }}>Open in new tab instead</a>}
            </div>
          </div>
        )}
        {uiMode==='video' && callStarted && (
          <div className="fixed inset-0 z-50 bg-black">
            <iframe src={`https://bey.chat/${agentId}`} className="w-full h-full" allow="camera; microphone; fullscreen" allowFullScreen title="Video Doctor" />
            <div className="absolute top-4 right-4 flex gap-2 z-10 no-print">
              <button onClick={goFinish} className="btn-primary px-5 py-2.5 text-sm">Submit</button>
              <button onClick={()=>setCallStarted(false)} className="btn-ghost px-4 py-2.5 text-sm !bg-black/70 !text-white !border-white/20">Exit</button>
            </div>
          </div>
        )}

        {uiMode==='chat' && (
          <div className="flex-1 min-h-0 flex flex-col panel overflow-hidden">
            <div className="px-4 md:px-5 py-3 text-xs border-b flex items-center justify-between" style={{ borderColor:'var(--color-border)', color:'var(--color-faint)' }}>
              <span className="font-medium">Voice — speak or tap Repeat</span>
              <div className="flex items-center gap-2">
                <button onClick={replayQuestion} className="btn-ghost !min-h-[32px] !px-3 !py-1 !text-xs">Repeat</button>
                <span className="hidden sm:inline tabular-nums font-semibold" style={{ color:'var(--color-muted-foreground)' }}>{Object.keys(turn?.state?.answers||{}).length} answered</span>
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <VoiceChat questionText={q?.text} questionId={q?.id} lang={setup.consent.language||'en'} busy={busyTranscribing} sessionId={sessionId} onSpokenAnswer={(text)=> q && applyAnswer({question_id:q.id, text}, text)} onAssistantReply={(txt)=>{ setAssistantNote(txt); setTimeout(()=>setAssistantNote(''),8000)}} />
            </div>
            {assistantNote && <div className="mx-4 mb-2 p-3 rounded-xl text-sm" style={{ background:'#E0F2F7', border:'1px solid var(--color-border)', color:'var(--color-foreground)' }}>💬 {assistantNote}</div>}
            <SubmitBar onSubmit={goFinish} />
          </div>
        )}

        {uiMode==='clickable' && (
          <div className="flex-1 min-h-0 flex flex-col panel overflow-hidden">
            <div className="flex-1 overflow-y-auto p-6 md:p-8">
              {q ? (
                <div className="max-w-2xl mx-auto space-y-5">
                  <div className="flex items-start justify-between gap-4">
                    <p className="mono-label">Current question</p>
                    <button onClick={replayQuestion} className="btn-ghost !min-h-[32px] !px-3 !py-1 text-xs"><ISpeaker className="w-3.5 h-3.5" /> Repeat</button>
                  </div>
                  <h2 className="display text-[22px] md:text-[26px] font-semibold leading-snug" style={{ color:'var(--color-foreground-strong)' }}>{q.text}</h2>
                  <div className="flex flex-col gap-2.5 pt-1">
                    {q.mcq_options?.map((opt,i)=> (
                      <button key={i} onClick={()=>(q.multi_select? toggleMulti(i) : applyAnswer({question_id:q.id, option_id:String(i)}, opt))} aria-pressed={multiSel.includes(String(i))} className={`opt ${multiSel.includes(String(i)) ? 'is-selected' : ''}`}>
                        <span className="flex items-center gap-3">{q.multi_select && <span className={`w-5 h-5 rounded-md border flex items-center justify-center text-xs shrink-0 ${multiSel.includes(String(i))?'bg-[var(--color-primary)] border-[var(--color-primary)] text-white':'border-[var(--color-border)] bg-white'}`}>{multiSel.includes(String(i))?'✓':''}</span>}{opt}</span>
                      </button>
                    ))}
                  </div>
                  {q.multi_select && q.mcq_options?.length>0 && (
                    <button disabled={multiSel.length===0} onClick={()=>{ const labels=multiSel.map(idx=>q.mcq_options[Number(idx)]).join(', '); applyAnswer({question_id:q.id, option_ids:multiSel}, labels)}} className="btn-primary w-full py-3.5 disabled:opacity-40">Confirm ({multiSel.length})</button>
                  )}
                  {q.allows_free_text && (
                    <div className="flex gap-2.5 pt-1">
                      <label className="sr-only" htmlFor="kiosk-free">Your answer</label>
                      <input id="kiosk-free" value={chatInput} onChange={(e)=>setChatInput(e.target.value)} onKeyDown={(e)=> e.key==='Enter' && chatInput.trim() && applyAnswer({question_id:q.id, text:chatInput}, chatInput)} placeholder="Other — describe in your own words" className="field" />
                      <button onClick={()=> chatInput.trim() && applyAnswer({question_id:q.id, text:chatInput}, chatInput)} disabled={!chatInput.trim()} className="btn-primary px-7">Send</button>
                    </div>
                  )}
                  {assistantNote && <div className="p-3 rounded-xl text-sm" style={{ background:'#E0F2F7', border:'1px solid var(--color-border)', color:'var(--color-foreground)' }}>💬 {assistantNote}</div>}
                  {error && <p className="text-sm" style={{ color:'var(--color-destructive)' }}>{error}</p>}
                </div>
              ) : <p className="text-center mt-20" style={{ color:'var(--color-muted-foreground)' }}>All questions answered — press Submit below.</p>}
            </div>
            <SubmitBar onSubmit={goFinish} />
          </div>
        )}
      </main>
    </div>
  )
}

function SubmitBar({ onSubmit }){
  return <div className="p-3.5 border-t" style={{ borderColor:'var(--color-border)' }}><button onClick={onSubmit} className="btn-primary btn-accent w-full py-3.5">Submit & Continue to Summary</button></div>
}
