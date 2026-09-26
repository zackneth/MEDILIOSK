import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, downloadReportPdf } from '../api'

export default function Doctor() {
  const nav = useNavigate()
  const { sessionId } = useParams()
  const [summary, setSummary] = useState(null)
  const [edited, setEdited] = useState({})
  const [saved, setSaved] = useState(false)
  const [status, setStatus] = useState('loading')
  const [docImages, setDocImages] = useState([])
  const [report, setReport] = useState(null)

  useEffect(() => {
    api.get(`/summary/docs-images/${sessionId}`).then(({ data }) => setDocImages(data.documents)).catch(()=>{})
    api.get(`/documents/${sessionId}/report-json`).then(({data})=>setReport(data)).catch(()=>{})
  }, [sessionId])
  useEffect(() => {
    api.get(`/summary/${sessionId}`).then(({data})=>setSummary(data))
      .catch(()=> api.get(`/summary/archived/${sessionId}`).then(({data})=>setSummary(data)).catch(()=>setStatus('missing')))
  }, [sessionId])
  const handleDownloadPdf = async()=>{
    try{ const {data}=await downloadReportPdf(sessionId); const url=URL.createObjectURL(data); const a=document.createElement('a'); a.href=url; a.download=`InstaDoc_DoctorReport_${sessionId.slice(0,8)}.pdf`; a.click(); URL.revokeObjectURL(url)}catch{ alert('PDF download failed')}
  }

  if(status==='missing'){
    return (
      <div className="min-h-screen bg-[var(--color-background)] flex flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{background:'var(--color-surface-2)', border:'1px solid var(--color-border)', color:'var(--color-faint)'}}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M14 2H7a2 2 0 00-2 2v16a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M10 13H8"/><path d="M16 13H12"/><path d="M10 17H8"/><path d="M16 17H12"/></svg>
        </div>
        <h2 className="display text-2xl font-semibold" style={{color:'var(--color-foreground-strong)'}}>No summary found</h2>
        <p className="text-sm max-w-md" style={{color:'var(--color-muted-foreground)'}}>It may have been purged after HIS submission before a summary was generated.</p>
        <button onClick={()=>nav('/')} className="btn-primary px-8 py-3 mt-2">Back to Kiosk</button>
      </div>
    )
  }
  if(!summary) return <div className="min-h-screen bg-[var(--color-background)] flex items-center justify-center text-sm" style={{color:'var(--color-muted-foreground)'}}>Loading patient history…</div>

  // AI conversation sections - separate from Document Summary
  const aiSections=[['Chief Complaint','chief_complaint'],['History of Present Illness','hpi'],['Past Medical / Surgical','past_medical_surgical'],['Drug & Allergy','drug_allergy'],['Family History','family_history'],['Personal History','personal_history'],['Review of Systems','ros'],['Prior Investigations','prior_investigations']]

  return (
    <div className="min-h-screen" style={{ background: 'var(--color-background)' }}>
      <header className="sticky top-0 z-20 glass-header no-print">
        <div className="kiosk-shell flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{background:'var(--color-primary)', color:'white'}}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg></div>
            <h1 className="display text-lg font-bold" style={{color:'var(--color-foreground-strong)'}}>Physician Review</h1>
            <span className="hidden sm:inline text-xs px-2.5 py-1 rounded-full font-semibold" style={{background: summary.red_flags?.length ? '#FEF2F2':'#E0F7EC', color: summary.red_flags?.length ? '#991B1B':'#065F46', border: summary.red_flags?.length ? '1px solid #FECACA':'1px solid #A7F3D0'}}>{summary.red_flags?.length ? `${summary.red_flags.length} RED FLAG${summary.red_flags.length>1?'S':''}` : 'No red flags'}</span>
          </div>
          <div className="flex gap-2">
            {report?.total_documents>0 && <button onClick={handleDownloadPdf} className="btn-primary px-5 py-2.5 text-sm" style={{background:'#0E7490'}}>Download Date-wise Report PDF</button>}
            <button onClick={()=>window.print()} className="btn-ghost px-5 py-2.5 text-sm">Print</button>
          </div>
        </div>
      </header>

      <div className="kiosk-shell max-w-3xl py-6 space-y-4 pb-16">
        <p className="text-xs font-medium" style={{color:'var(--color-faint)'}}>Session {sessionId} · Pre-consult history · Review each field, edit anything, then confirm</p>

        <div className="panel p-3 rounded-xl" style={{background:'#F0FDFA', border:'1px solid #99F6E4'}}><p className="text-xs font-bold" style={{color:'#0E7490'}}>AI CONVERSATION SUMMARY</p><p className="text-[11px]" style={{color:'#6B7280'}}>Derived from interview Q&A - editable, not from documents</p></div>
        {aiSections.map(([label,key])=> (edited[key] ?? summary[key]) ? (
          <div key={key} className="panel p-5">
            <p className="mono-label mb-2">{label}</p>
            <textarea value={edited[key] ?? summary[key]} onChange={(e)=>setEdited(s=>({...s,[key]:e.target.value}))} rows={Math.min(5, Math.ceil(((edited[key] ?? summary[key]).length||20)/60))} className="w-full bg-transparent outline-none resize-none leading-relaxed text-[14.5px]" style={{color:'var(--color-foreground)'}} />
          </div>
        ): null)}

        {/* SEPARATE DOCUMENT SUMMARY - from summary.document_summary, isolated */}
        {(summary.document_summary || report?.grouped?.length>0) && (
          <div className="panel p-5" style={{borderColor:'#0E7490', borderWidth:'1.5px', borderLeft:'4px solid #0E7490'}}>
            <div className="flex items-center justify-between mb-1">
              <h2 className="display text-[16px] font-bold flex items-center gap-2" style={{color:'#0E7490'}}><span className="w-7 h-7 rounded-lg flex items-center justify-center" style={{background:'#0E7490', color:'white'}}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H7a2 2 0 00-2 2v16a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg></span> Document Summary</h2>
              <button onClick={handleDownloadPdf} className="btn-primary !min-h-[32px] !px-3.5 !py-1 text-xs">Download PDF</button>
            </div>
            <p className="text-[11px] mb-3" style={{color:'#6B7280'}}>Separate from AI Conversation - Llama OCR aggregated date-wise ({summary.documents_timeline?.length || report?.total_documents || 0} docs)</p>
            {(summary.document_summary_grouped?.length ? summary.document_summary_grouped : report?.grouped)?.map(g=>(
              <div key={g.date} className="mb-4 last:mb-0">
                <p className="text-xs font-bold px-3 py-1 rounded-full inline-block mb-2" style={{background:'#0E7490', color:'white'}}>{g.date} · {g.documents.length} doc(s)</p>
                {g.documents.map(d=>(
                  <div key={d.document_id} className="ml-2 pl-3 border-l-2 py-2 space-y-1" style={{borderColor:'#99F6E4'}}>
                    <p className="text-xs font-semibold capitalize" style={{color:'#155E75'}}>{d.doc_type} {d.patient_name||'N/A'}</p>
                    {d.diagnoses?.length>0 && <p className="text-xs" style={{color:'#334155'}}>Dx: {d.diagnoses.join(', ')}</p>}
                    {d.medications?.length>0 && (
                      <div className="overflow-hidden rounded border" style={{borderColor:'#E2E8F0'}}>
                        <table className="w-full text-[11px]">
                          <thead><tr style={{background:'#F0FDFA'}}><th className="text-left p-1.5">Medicine</th><th className="p-1.5">Dose</th><th className="p-1.5">Frequency</th><th className="p-1.5">Duration</th></tr></thead>
                          <tbody>{d.medications.map((m,i)=>(<tr key={i} className="border-t" style={{borderColor:'#E2E8F0'}}><td className="p-1.5 font-medium">{m.name}</td><td className="p-1.5 text-center">{m.dose||'-'}</td><td className="p-1.5 text-center">{m.frequency||'-'}</td><td className="p-1.5 text-center">{m.duration||'-'}</td></tr>))}</tbody>
                        </table>
                      </div>
                    )}
                    {d.lab_values?.length>0 && d.lab_values.map((lv,i)=>(<p key={i} className="text-[11px]" style={{color: lv.abnormal ? '#DC2626':'#334155'}}>{lv.test}: {lv.value} {lv.unit||''} <span style={{color:'#94A3B8'}}>(ref {lv.reference_range||'n/a'})</span>{lv.abnormal && ' · ABNORMAL'}</p>))}
                    {d.ai_summary && <p className="text-[11px] italic" style={{color:'#0F766E'}}>AI: {d.ai_summary}</p>}
                  </div>
                ))}
              </div>
            ))}
            <details className="mt-3"><summary className="cursor-pointer text-xs font-semibold" style={{color:'#0E7490'}}>View full document text</summary><pre className="whitespace-pre-wrap text-xs mt-2 p-3 rounded-lg max-h-64 overflow-auto" style={{background:'#F8FAFC', color:'#334155'}}>{summary.document_summary || report?.structured_text}</pre></details>
          </div>
        )}

        {summary.documents_ai_ocr && (
          <div className="panel p-5" style={{borderLeft:'3px solid var(--color-primary)'}}>
            <p className="mono-label mb-1.5" style={{color:'var(--color-primary)'}}>AI Document Insight</p>
            <p className="text-sm leading-relaxed" style={{color:'var(--color-foreground)'}}>{summary.documents_ai_ocr}</p>
          </div>
        )}

        {docImages.length>0 && (
          <div className="panel p-5">
            <p className="mono-label mb-3">Attached source documents ({docImages.length})</p>
            <div className="grid grid-cols-3 gap-3">
              {docImages.map(d=>(
                <a key={d.document_id} href={`/api${d.image_url}`} target="_blank" rel="noreferrer" className="block group">
                  <img src={`/api${d.image_url}`} alt={d.doc_type} className="w-full h-28 object-cover rounded-xl border group-hover:border-[var(--color-primary)] transition-colors" style={{borderColor:'var(--color-border)'}} />
                  <p className="text-[11px] mt-1.5 capitalize text-center font-medium" style={{color:'var(--color-faint)'}}>{d.doc_type}{d.date?` · ${d.date}`:''}</p>
                </a>
              ))}
            </div>
          </div>
        )}

        {summary.red_flags?.length>0 && (
          <div className="panel p-5" style={{background:'#FEF2F2', borderColor:'#FECACA'}}>
            <p className="mono-label mb-2" style={{color:'#DC2626'}}>Red flags detected</p>
            {summary.red_flags.map((f,i)=>(<p key={i} className="text-sm font-medium" style={{color:'#991B1B'}}>• {f.description}</p>))}
          </div>
        )}

        {Object.keys(edited).length>0 && !saved && <button onClick={()=>setSaved(true)} className="btn-primary btn-accent w-full py-3.5 no-print">Confirm edits ({Object.keys(edited).length})</button>}
        {saved && <p className="text-center py-3 text-sm font-semibold" style={{color:'var(--color-accent)'}}>✓ Summary confirmed and saved to EMR (mock)</p>}
        <p className="text-[11px] text-center pt-2 no-print" style={{color:'var(--color-faint)'}}>{summary.disclaimer}</p>
      </div>
    </div>
  )
}
