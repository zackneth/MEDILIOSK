import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { generateSummary, generateVideoSummary, getInteractions, pushToHis, uploadDocument, downloadReportPdf, getDocumentsReport, API_BASE } from '../api'

export default function Finish() {
  const { state } = useLocation()
  const nav = useNavigate()
  const sessionId = state?.sessionId
  const uiMode = state?.uiMode
  const fileRef = useRef(null)
  const [docs, setDocs] = useState([])
  const [summary, setSummary] = useState(null)
  const [pushResult, setPushResult] = useState(null)
  const [interactions, setInteractions] = useState(null)
  const [report, setReport] = useState(null)
  const [busy, setBusy] = useState(false)
  const [summarizing, setSummarizing] = useState(false)
  const [summaryError, setSummaryError] = useState('')
  const autoRanRef=useRef(false)

  useEffect(()=>{ if(!sessionId) return; getInteractions(sessionId).then(({data})=>setInteractions(data)).catch(()=>{}) },[docs.length, sessionId])
  useEffect(()=>{ if(!sessionId || docs.length===0) return; getDocumentsReport(sessionId).then(({data})=>setReport(data)).catch(()=>{}) },[docs.length, sessionId])
  const handleDownloadPdf = async()=>{
    try{ const {data}=await downloadReportPdf(sessionId); const url=URL.createObjectURL(data); const a=document.createElement('a'); a.href=url; a.download=`InstaDoc_Report_${sessionId.slice(0,8)}.pdf`; a.click(); URL.revokeObjectURL(url)}catch{ alert('PDF download failed - no documents?')}
  }
  const runSummary=async()=>{
    if(!sessionId||summarizing) return
    setSummarizing(true); setSummaryError('')
    try{
      if(uiMode==='video'){ try{ const {data}=await generateVideoSummary(sessionId); setSummary(data); setSummarizing(false); return }catch{}
      }
      const {data}=await generateSummary(sessionId); setSummary(data)
    }catch(e){ setSummaryError(e?.response?.data?.detail || 'AI summary failed — press Generate again')}
    setSummarizing(false)
  }
  useEffect(()=>{ if(sessionId && !autoRanRef.current){ autoRanRef.current=true; runSummary()} },[sessionId])
  const onFile=async(e)=>{
    const picked=Array.from(e.target.files||[]); if(!picked.length) return
    setBusy(true)
    try{ const {data}=await uploadDocument(sessionId, picked); setDocs(d=>[...d, ...data.extractions.filter(x=>!x.error)]) }catch{ alert('Upload failed')}
    setBusy(false); e.target.value=''
  }
  const doPush=async()=>{ setBusy(true); try{ const {data}=await pushToHis(sessionId); setPushResult(data)}catch{ alert('HIS push failed')} setBusy(false)}

  return (
    <div className="min-h-screen" style={{ background: 'var(--color-background)' }}>
      <header className="sticky top-0 z-20 glass-header no-print">
        <div className="kiosk-shell flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{background:'var(--color-primary)', color:'white'}}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg></div>
            <span className="display font-bold" style={{color:'var(--color-foreground-strong)'}}>InstaDoc <span style={{color:'var(--color-faint)'}}>· Session summary</span></span>
          </div>
          <span className="mono-label hidden sm:inline">{sessionId}</span>
        </div>
      </header>

      <div className="kiosk-shell max-w-3xl py-6 space-y-5 pb-20">
        <div className="panel p-6">
          <p className="mono-label mb-1">Step 1 · Prior records</p>
          <h2 className="display text-2xl font-semibold" style={{color:'var(--color-foreground-strong)'}}>Digitize your documents</h2>
          <p className="text-sm mt-1" style={{color:'var(--color-muted-foreground)'}}>Prescriptions, lab reports or discharge summaries — any format, multiple files OK</p>
          <label className="mt-5 flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors hover:bg-[var(--color-surface-2)]" style={{borderColor:'var(--color-border)'}}>
            <input ref={fileRef} type="file" accept="*/*" multiple onChange={onFile} className="hidden" />
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{background:'var(--color-surface-2)', border:'1px solid var(--color-border)', color:'var(--color-primary)'}}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M14 2H7a2 2 0 00-2 2v16a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M10 13H8"/><path d="M16 13H12"/></svg></div>
            <span className="text-sm font-semibold" style={{color:'var(--color-foreground)'}}>Tap to add documents</span>
            <span className="btn-ghost !min-h-[36px] !px-4 !py-1.5 text-xs mt-1 pointer-events-none">Choose files</span>
          </label>
          {busy && <p className="text-sm mt-4 flex items-center gap-2 font-medium" style={{color:'var(--color-primary)'}}><span className="inline-block w-3.5 h-3.5 border-2 rounded-full animate-spin" style={{borderColor:'rgba(8,145,178,.25)', borderTopColor:'var(--color-primary)'}}/> Llama OCR reading prescription… extracting medicines & dosage</p>}
          {report?.grouped?.length>0 && (
            <div className="mt-5 p-4 rounded-xl" style={{background:'#F0FDFA', border:'1px solid #99F6E4'}}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold" style={{color:'#0E7490'}}>Date-wise structured report · {report.total_documents} docs</p>
                <button onClick={handleDownloadPdf} className="btn-primary !min-h-[34px] !px-4 !py-1.5 text-xs">Download Doctor PDF</button>
              </div>
              <div className="mt-3 space-y-3 max-h-72 overflow-auto pr-1">
                {report.grouped.map(g=>(
                  <div key={g.date} className="bg-white rounded-lg p-3 border" style={{borderColor:'#CCFBF1'}}>
                    <p className="text-xs font-bold px-2 py-1 rounded-full inline-block" style={{background:'#0E7490', color:'white'}}>{g.date}</p>
                    {g.documents.map(d=>(
                      <div key={d.document_id} className="mt-2 text-xs leading-relaxed">
                        <span className="font-semibold capitalize" style={{color:'#0E7490'}}>{d.doc_type}</span>
                        {d.medications?.length>0 && <span style={{color:'#334155'}}> · {d.medications.map(m=> `${m.name} ${m.dose||''} ${m.frequency||''}`.trim()).join(', ')}</span>}
                        {d.diagnoses?.length>0 && <span style={{color:'#475569'}}> · Dx: {d.diagnoses.join(', ')}</span>}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {docs.map(d=>(
            <div key={d.document_id} className="mt-4 panel-flat p-4 space-y-2">
              {d.image_url && <img src={`${API_BASE}${d.image_url}`} alt="Uploaded document" className="w-full max-h-56 object-contain rounded-lg border" style={{borderColor:'var(--color-border)'}} />}
              <div className="flex justify-between items-center"><b className="capitalize text-sm" style={{color:'var(--color-primary)'}}>{d.doc_type}</b><span className="text-xs" style={{color:'var(--color-faint)'}}>{d.date||'undated'}</span></div>
              {d.diagnoses?.length>0 && <p className="text-sm" style={{color:'var(--color-muted-foreground)'}}>Diagnoses: <span style={{color:'var(--color-foreground)'}}>{d.diagnoses.join(', ')}</span></p>}
              {d.medications?.length>0 && (
                <div className="overflow-hidden rounded-lg border" style={{borderColor:'var(--color-border)'}}>
                  <table className="w-full text-xs">
                    <thead><tr style={{background:'var(--color-surface-2)'}}><th className="text-left p-2">Medicine</th><th className="p-2">Dose</th><th className="p-2">Frequency</th><th className="p-2">Duration</th></tr></thead>
                    <tbody>{d.medications.map((m,i)=>(<tr key={i} className="border-t" style={{borderColor:'var(--color-border)'}}><td className="p-2 font-medium">{m.name||'-'}</td><td className="p-2 text-center">{m.dose||'-'}</td><td className="p-2 text-center">{m.frequency||'-'}</td><td className="p-2 text-center">{m.duration||'-'}</td></tr>))}</tbody>
                  </table>
                </div>
              )}
              {d.lab_values?.map((l,i)=>(<p key={i} className={`text-sm ${l.abnormal?'font-semibold':''}`} style={{color: l.abnormal ? '#DC2626':'var(--color-foreground)'}}>{l.test}: {l.value} {l.unit} <span style={{color:'var(--color-faint)'}}>(ref {l.reference_range})</span>{l.abnormal && ' · ABNORMAL'}</p>))}
              {d.ai_summary && <div className="p-3 rounded-lg" style={{background:'var(--color-surface-2)', borderLeft:'3px solid var(--color-primary)'}}><p className="text-xs font-bold" style={{color:'var(--color-primary)'}}>AI Insight</p><p className="text-xs leading-relaxed mt-1" style={{color:'var(--color-muted-foreground)'}}>{d.ai_summary}</p></div>}
              {d.ocr_text && <details className="pt-1"><summary className="cursor-pointer text-xs font-semibold" style={{color:'var(--color-primary)'}}>View raw Llama OCR text</summary><pre className="whitespace-pre-wrap text-xs mt-2 p-3 rounded-lg" style={{background:'var(--color-muted)', color:'var(--color-muted-foreground)'}}>{d.ocr_text}</pre></details>}
            </div>
          ))}
        </div>

        {interactions?.alerts?.length>0 && (
          <div className="panel p-5" style={{background:'#FEF2F2', borderColor:'#FECACA'}}>
            <h2 className="text-sm font-bold mb-2" style={{color:'#991B1B'}}>Drug Alerts ({interactions.alerts.length})</h2>
            {interactions.alerts.map((a,i)=>(<p key={i} className="text-sm" style={{color: a.severity==='high' ? '#DC2626':'#92400E'}}>• {a.drugs.join(' + ')} — {a.reason}</p>))}
          </div>
        )}

        {summarizing && <div className="panel p-6 flex items-center gap-3"><span className="w-4 h-4 border-2 rounded-full animate-spin" style={{borderColor:'rgba(8,145,178,.25)', borderTopColor:'var(--color-primary)'}}/><p className="text-sm font-medium" style={{color:'var(--color-primary)'}}>Preparing your AI summary…</p></div>}
        {summaryError && !summarizing && <div className="panel p-4 text-sm" style={{color:'#DC2626', background:'#FEF2F2', borderColor:'#FECACA'}}>{summaryError}</div>}

        {!summarizing && (
          <div className="grid md:grid-cols-2 gap-3 no-print">
            <button onClick={runSummary} disabled={busy} className="btn-primary py-3.5">Generate AI Summary</button>
            <button onClick={async()=>{ setBusy(true); try{ const {data}=await generateVideoSummary(sessionId); setSummary(data)}catch(e){ alert(e?.response?.data?.detail||'No video interview found')} setBusy(false)}} disabled={busy} className="btn-ghost py-3.5">Use video-call transcript</button>
          </div>
        )}

        {summary && (
          <>
          <div className="panel p-6 space-y-3">
            <div className="flex items-center justify-between"><h2 className="display font-semibold" style={{color:'var(--color-foreground-strong)'}}>Structured History · AI Conversation · DRAFT</h2><span className="text-xs px-2.5 py-1 rounded-full font-bold" style={{background: summary.red_flags?.length ? '#FEF2F2':'#E0F7EC', color: summary.red_flags?.length ? '#991B1B':'#065F46', border: summary.red_flags?.length ? '1px solid #FECACA':'1px solid #A7F3D0'}}>{summary.red_flags?.length ? `${summary.red_flags.length} flag(s)` : 'No flags'}</span></div>
            {[
              ['Chief Complaint','chief_complaint'],['History of Present Illness','hpi'],['Past Medical / Surgical','past_medical_surgical'],['Drug & Allergy','drug_allergy'],['Family','family_history'],['Personal','personal_history'],['Review of Systems','ros'],['Prior Investigations','prior_investigations'],
            ].map(([k,key])=> summary[key] && (<div key={key}><span className="mono-label">{k}</span><p className="text-sm mt-1 leading-relaxed" style={{color:'var(--color-foreground)'}}>{summary[key]}</p></div>))}
            <p className="text-[11px] italic" style={{color:'var(--color-faint)'}}>Source: AI conversation (interview answers)</p>
          </div>
          {/* SEPARATE DOCUMENT SUMMARY */}
          <div className="panel p-6 space-y-3" style={{borderColor:'#0E7490', borderWidth:'1.5px'}}>
            <div className="flex items-center justify-between">
              <h2 className="display font-semibold flex items-center gap-2" style={{color:'#0E7490'}}><span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{background:'#0E7490', color:'white'}}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H7a2 2 0 00-2 2v16a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg></span> Document Summary</h2>
              <span className="text-xs px-2.5 py-1 rounded-full font-bold" style={{background:'#F0FDFA', color:'#0E7490', border:'1px solid #99F6E4'}}>{summary.document_summary_grouped?.length || 0} dates · {summary.documents_timeline?.length || 0} docs</span>
            </div>
            <p className="text-xs" style={{color:'var(--color-faint)'}}>Llama OCR extracted from uploaded prescriptions/lab reports - date-wise aggregated, separate from interview chat</p>
            {summary.document_summary ? (
              <>
                {summary.document_summary_grouped?.map(g=>(
                  <div key={g.date} className="rounded-xl p-4" style={{background:'#F8FAFC', border:'1px solid #E2E8F0'}}>
                    <p className="text-xs font-bold px-3 py-1 rounded-full inline-block mb-3" style={{background:'#0E7490', color:'white'}}>{g.date}</p>
                    {g.documents.map(d=>(
                      <div key={d.document_id} className="mb-3 last:mb-0 pl-3 border-l-2" style={{borderColor:'#99F6E4'}}>
                        <p className="text-xs font-bold capitalize" style={{color:'#155E75'}}>{d.doc_type} {d.patient_name && `· ${d.patient_name}`}</p>
                        {d.diagnoses?.length>0 && <p className="text-xs mt-1" style={{color:'#334155'}}>Dx: {d.diagnoses.join(', ')}</p>}
                        {d.medications?.length>0 && <div className="mt-1.5 overflow-hidden rounded border" style={{borderColor:'#E2E8F0'}}><table className="w-full text-[11px]"><thead><tr style={{background:'white'}}><th className="text-left p-1.5">Medicine</th><th className="p-1.5">Dose</th><th className="p-1.5">Frequency</th><th className="p-1.5">Duration</th></tr></thead><tbody>{d.medications.map((m,i)=>(<tr key={i} className="border-t" style={{borderColor:'#E2E8F0'}}><td className="p-1.5 font-medium">{m.name}</td><td className="p-1.5 text-center">{m.dose||'-'}</td><td className="p-1.5 text-center">{m.frequency||'-'}</td><td className="p-1.5 text-center">{m.duration||'-'}</td></tr>))}</tbody></table></div>}
                        {d.lab_values?.length>0 && d.lab_values.map((lv,i)=>(<p key={i} className="text-xs mt-1" style={{color: lv.abnormal ? '#DC2626':'#334155'}}>{lv.test}: {lv.value} {lv.unit||''} <span style={{color:'#94A3B8'}}>(ref {lv.reference_range||'n/a'})</span>{lv.abnormal && ' · ABNORMAL'}</p>))}
                        {d.ai_summary && <p className="text-xs mt-1 italic" style={{color:'#0F766E'}}>{d.ai_summary}</p>}
                      </div>
                    ))}
                  </div>
                ))}
                <details className="pt-2"><summary className="cursor-pointer text-xs font-semibold" style={{color:'#0E7490'}}>View full document text (all dates)</summary><pre className="whitespace-pre-wrap text-xs mt-2 p-3 rounded-lg max-h-64 overflow-auto" style={{background:'#F8FAFC', color:'#334155'}}>{summary.document_summary}</pre></details>
              </>
            ) : <p className="text-sm text-center py-6" style={{color:'var(--color-faint)'}}>No documents uploaded yet - document summary will appear here date-wise after you upload prescriptions/lab reports.</p>}
            <p className="text-[11px]" style={{color:'var(--color-faint)'}}>{summary.disclaimer}</p>
          </div>
          </>
        )}

        {summary && !pushResult && <button onClick={doPush} disabled={busy} className="btn-primary btn-accent w-full py-3.5 no-print">Push to HIS & Clear Session →</button>}

        {pushResult && (
          <div className="panel p-6 text-center" style={{background: pushResult.session_cleared ? '#E0F7EC' : '#FEF2F2', borderColor: pushResult.session_cleared ? '#A7F3D0' : '#FECACA'}}>
            {pushResult.session_cleared ? <><p className="font-bold" style={{color:'#065F46'}}>✓ Delivered to hospital records</p><p className="text-sm mt-1" style={{color:'var(--color-muted-foreground)'}}>Bundle {pushResult.his_push.bundle_id} · Session data erased (DPDP compliant)</p></> : <p style={{color:'#991B1B'}}>HIS unreachable — session retained for retry</p>}
            <div className="flex gap-3 mt-5 no-print"><button onClick={()=>nav(`/doctor/${sessionId}`)} className="flex-1 btn-ghost py-3">Physician View →</button><button onClick={()=>nav('/')} className="flex-1 btn-ghost py-3">New patient</button></div>
          </div>
        )}
      </div>
    </div>
  )
}
