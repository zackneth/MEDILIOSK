import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getConsentNotice } from '../api'
import Speech from '../speech'

const LANGUAGES = [
  { code: 'en', label: 'English', bcp: 'en-IN' }, { code: 'hi', label: 'हिंदी', bcp: 'hi-IN' },
  { code: 'ta', label: 'தமிழ்', bcp: 'ta-IN' }, { code: 'te', label: 'తెలుగు', bcp: 'te-IN' },
  { code: 'kn', label: 'ಕನ್ನಡ', bcp: 'kn-IN' }, { code: 'ml', label: 'മലയാളം', bcp: 'ml-IN' },
  { code: 'mr', label: 'मराठी', bcp: 'mr-IN' }, { code: 'bn', label: 'বাংলা', bcp: 'bn-IN' },
  { code: 'gu', label: 'ગુજરાતી', bcp: 'gu-IN' }, { code: 'pa', label: 'ਪੰਜਾਬੀ', bcp: 'pa-IN' },
  { code: 'or', label: 'ଓଡ଼ିଆ', bcp: 'or-IN' }, { code: 'as', label: 'অসমীয়া', bcp: 'as-IN' },
]
const bcpFor=(c)=> LANGUAGES.find(l=>l.code===c)?.bcp||'en-IN'

export default function Consent(){
  const nav=useNavigate()
  const [lang,setLang]=useState('en'); const [notice,setNotice]=useState(null)
  const [grants,setGrants]=useState({history_capture:false, document_digitization:false, share_with_physician:false})
  const [name,setName]=useState(''); const [age,setAge]=useState(''); const [sex,setSex]=useState('male'); const [mode,setMode]=useState('allopathic')
  const loadNotice=async(l)=>{ setLang(l); try{ const {data}=await getConsentNotice(l); setNotice(data); Speech.speak(data.points.join('. '), bcpFor(l)) }catch{ setNotice(null)} }
  const canProceed=grants.history_capture && name.trim()
  const proceed=()=> nav('/interview',{state:{identity:{abha_id:null, name, age:Number(age)||null, sex}, consent:{...grants, language:lang, granted_at:new Date().toISOString(), revoked:false}, mode}})

  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      <div className="w-full bg-white border-b" style={{borderColor:'var(--color-border)'}}>
        <div className="kiosk-shell flex items-center gap-3 py-4">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{background:'var(--color-primary)', color:'white'}}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" strokeLinecap="round"/></svg></div>
          <span className="display text-lg font-bold" style={{color:'var(--color-foreground-strong)'}}>InstaDoc</span>
          <span className="hidden sm:inline text-xs font-medium" style={{color:'var(--color-faint)'}}>· Your data, your consent</span>
        </div>
      </div>
      <div className="kiosk-shell max-w-xl mx-auto py-8">
        <h1 className="display text-2xl font-semibold" style={{color:'var(--color-foreground-strong)'}}>Consent & Identity</h1>
        <p className="text-sm mt-1" style={{color:'var(--color-muted-foreground)'}}>Choose language, confirm consent, and enter your details.</p>

        <div className="panel p-6 mt-6 space-y-6">
          <div>
            <p className="mono-label mb-2.5">Language — 12 supported</p>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {LANGUAGES.map(l=> <button key={l.code} onClick={()=>loadNotice(l.code)} className={`chip !min-h-[40px] text-xs ${lang===l.code?'on':''}`}>{l.label}</button>)}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={()=>setMode('allopathic')} className={`chip !py-3 ${mode==='allopathic'?'on':''}`}>Allopathic OPD</button>
            <button onClick={()=>setMode('ayush')} className={`chip !py-3 ${mode==='ayush'?'on':''}`}>AYUSH</button>
          </div>

          <div className="space-y-3">
            <div><label className="text-xs font-semibold" style={{color:'var(--color-foreground-strong)'}}>Full name *</label><input value={name} onChange={(e)=>setName(e.target.value)} placeholder="e.g. Aarav Sharma" className="field mt-1.5" /></div>
            <div className="flex gap-3">
              <div className="flex-1"><label className="text-xs font-semibold" style={{color:'var(--color-foreground-strong)'}}>Age</label><input value={age} onChange={(e)=>setAge(e.target.value)} type="number" placeholder="32" className="field mt-1.5" /></div>
              <div className="flex-1"><label className="text-xs font-semibold" style={{color:'var(--color-foreground-strong)'}}>Sex</label><select value={sex} onChange={(e)=>setSex(e.target.value)} className="field mt-1.5"><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select></div>
            </div>
          </div>

          {notice && (
            <div className="rounded-xl p-4 space-y-3" style={{background:'var(--color-surface-2)', border:'1px solid var(--color-border)'}}>
              <h2 className="font-bold text-sm" style={{color:'var(--color-primary)'}}>{notice.title}</h2>
              <ul className="space-y-1.5 text-sm list-disc pl-5" style={{color:'var(--color-foreground)'}}>{notice.points.map((p,i)=><li key={i}>{p}</li>)}</ul>
              <p className="text-xs" style={{color:'var(--color-faint)'}}>{notice.law}</p>
              <div className="space-y-2 pt-2">
                {[
                  ['history_capture', lang==='hi'?'मैं इतिहास रिकॉर्डिंग की सहमति देता/देती हूँ':'I consent to history recording'],
                  ['document_digitization', lang==='hi'?'दस्तावेज़ डिजिटाइज़ेशन की सहमति':'I consent to document digitization'],
                  ['share_with_physician', lang==='hi'?'डॉक्टर के साथ साझा करने की सहमति':'I consent to sharing with the treating physician'],
                ].map(([key,label])=>(
                  <label key={key} className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={grants[key]} onChange={(e)=>setGrants(g=>({...g,[key]:e.target.checked}))} className="w-5 h-5 accent-[var(--color-primary)]" />
                    <span className="text-sm" style={{color:'var(--color-foreground)'}}>{label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <button disabled={!canProceed} onClick={proceed} className="btn-primary w-full py-4 text-base">Start Interview →</button>
        </div>
      </div>
    </div>
  )
}
