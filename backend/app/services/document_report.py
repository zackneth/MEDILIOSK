import io
import logging
from collections import defaultdict
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


def group_by_date(documents: list[dict]) -> list[tuple[str, list[dict]]]:
    """Group docs by date string, sorted chronological. Undated last."""
    buckets: dict[str, list[dict]] = defaultdict(list)
    for d in documents:
        key = d.get("date") or "Undated"
        buckets[key].append(d)
    # sort dated keys, keep undated last
    dated = sorted([k for k in buckets.keys() if k != "Undated"])
    ordered = [(k, sorted(buckets[k], key=lambda x: x.get("doc_type", ""))) for k in dated]
    if "Undated" in buckets:
        ordered.append(("Undated", buckets["Undated"]))
    return ordered


def build_structured_text(documents: list[dict]) -> str:
    """Plain-text date-wise report for summary/FHIR."""
    if not documents:
        return "No documents submitted."
    lines = []
    for date, docs in group_by_date(documents):
        lines.append(f"\n=== {date} ===")
        for d in docs:
            lines.append(f"[{d.get('doc_type','unknown').upper()}] {d.get('patient_name') or 'N/A'}")
            if d.get("diagnoses"):
                lines.append(f"  Diagnoses: {', '.join(d['diagnoses'])}")
            for m in d.get("medications", []):
                parts = " | ".join([str(m.get(k) or "") for k in ("name","dose","frequency","duration") if m.get(k)])
                lines.append(f"  Med: {parts}" if parts else f"  Med: {m.get('name')}")
            for lv in d.get("lab_values", []):
                ab = " ABNORMAL" if lv.get("abnormal") else ""
                lines.append(f"  Lab: {lv.get('test')} = {lv.get('value')} {lv.get('unit') or ''} (ref {lv.get('reference_range') or 'n/a'}){ab}")
            if d.get("ai_summary"):
                lines.append(f"  Note: {d['ai_summary']}")
    return "\n".join(lines).strip()


def generate_pdf(session_id: str, identity: dict, documents: list[dict]) -> bytes:
    """Generate date-wise structured PDF for doctor. Returns bytes."""
    # Try reportlab first (best layout), fallback to pymupdf
    try:
        return _generate_with_reportlab(session_id, identity, documents)
    except Exception as e:
        logger.warning("reportlab failed (%s), falling back to pymupdf", str(e)[:200])
        try:
            return _generate_with_pymupdf(session_id, identity, documents)
        except Exception as e2:
            logger.error("PDF generation failed: %s", e2)
            return _generate_txt_fallback(session_id, identity, documents)


def _generate_with_reportlab(session_id: str, identity: dict, documents: list[dict]) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
    from reportlab.lib.enums import TA_LEFT, TA_CENTER

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=18*mm, rightMargin=18*mm, topMargin=14*mm, bottomMargin=14*mm,
                            title=f"MediKiosk Document Report - {session_id}", author="MediKiosk")
    styles = getSampleStyleSheet()
    s_title = ParagraphStyle('Title2', parent=styles['Title'], fontSize=18, textColor=colors.HexColor("#0E7490"), alignment=TA_CENTER, spaceAfter=2*mm)
    s_h1 = ParagraphStyle('H1', parent=styles['Heading1'], fontSize=11, textColor=colors.HexColor("#0E7490"), spaceBefore=6*mm, spaceAfter=3*mm, borderPadding=(0,0,2))
    s_h2 = ParagraphStyle('H2', parent=styles['Heading2'], fontSize=9, textColor=colors.HexColor("#155E75"), spaceBefore=4*mm, spaceAfter=2*mm)
    s_normal = ParagraphStyle('Normal2', parent=styles['Normal'], fontSize=8.5, leading=12, textColor=colors.HexColor("#1F2937"))
    s_small = ParagraphStyle('Small', parent=styles['Normal'], fontSize=7.5, leading=10, textColor=colors.HexColor("#6B7280"))
    s_cell = ParagraphStyle('Cell', parent=styles['Normal'], fontSize=7.5, leading=9, textColor=colors.HexColor("#111827"))
    s_cellH = ParagraphStyle('CellH', parent=styles['Normal'], fontSize=7, leading=9, textColor=colors.white, alignment=TA_CENTER)

    story = []
    # Header
    story.append(Paragraph("MediKiosk", s_title))
    story.append(Paragraph("Structured Document Report &mdash; For Physician Review", ParagraphStyle('Sub', parent=s_small, alignment=TA_CENTER, textColor=colors.HexColor("#0891B2"))))
    story.append(Spacer(1, 3*mm))
    story.append(HRFlowable(width="100%", thickness=0.6, color=colors.HexColor("#0E7490")))
    story.append(Spacer(1, 3*mm))

    # Meta table
    meta = [
        [Paragraph(f"<b>Patient:</b> {identity.get('name') or 'Unknown'}", s_normal), Paragraph(f"<b>ABHA:</b> {identity.get('abha_id') or 'Not provided'}", s_normal)],
        [Paragraph(f"<b>Age/Sex:</b> {identity.get('age') or '-'} / {identity.get('sex') or '-'}", s_normal), Paragraph(f"<b>Session:</b> {session_id[:12]}...", s_small)],
        [Paragraph(f"<b>Generated:</b> {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}", s_small), Paragraph(f"<b>Total documents:</b> {len(documents)}", s_normal)],
    ]
    t = Table(meta, colWidths=[85*mm, 85*mm])
    t.setStyle(TableStyle([('BACKGROUND', (0,0), (-1,-1), colors.HexColor("#F0FDFA")), ('BOX', (0,0), (-1,-1), 0.6, colors.HexColor("#99F6E4")), ('INNERGRID', (0,0), (-1,-1), 0.3, colors.HexColor("#CCFBF1")), ('VALIGN', (0,0), (-1,-1), 'MIDDLE'), ('LEFTPADDING', (0,0), (-1,-1), 4), ('RIGHTPADDING', (0,0), (-1,-1), 4), ('TOPPADDING', (0,0), (-1,-1), 3), ('BOTTOMPADDING', (0,0), (-1,-1), 3)]))
    story.append(t)
    story.append(Spacer(1, 4*mm))

    if not documents:
        story.append(Paragraph("No documents were submitted for this session.", s_normal))
    else:
        # Summary counts
        type_counts = defaultdict(int)
        for d in documents:
            type_counts[d.get("doc_type","unknown")] += 1
        story.append(Paragraph(f"Overview: {', '.join([f'{k}: {v}' for k,v in type_counts.items()])} &middot; Sorted date-wise (oldest first)", s_small))
        story.append(Spacer(1, 2*mm))

        for date, docs in group_by_date(documents):
            story.append(Paragraph(f"Date: {date}", s_h1))
            for d in docs:
                doc_type = d.get("doc_type","unknown").replace("_"," ").title()
                story.append(Paragraph(f"{doc_type} &middot; ID {d.get('document_id','-')} {('&middot; ' + d.get('patient_name') if d.get('patient_name') else '')}", s_h2))
                if d.get("confidence_issues"):
                    story.append(Paragraph(f"<font color=\"#DC2626\">Confidence: {', '.join(d['confidence_issues'])}</font>", s_small))
                # Diagnoses
                if d.get("diagnoses"):
                    story.append(Paragraph("<b>Diagnoses:</b> " + ", ".join(d["diagnoses"]), s_normal))
                # Medications table
                if d.get("medications"):
                    med_data = [[Paragraph("<b>Medicine</b>", s_cellH), Paragraph("<b>Dose</b>", s_cellH), Paragraph("<b>Frequency</b>", s_cellH), Paragraph("<b>Duration</b>", s_cellH)]]
                    for m in d["medications"]:
                        med_data.append([Paragraph(str(m.get("name") or "-"), s_cell), Paragraph(str(m.get("dose") or "-"), s_cell), Paragraph(str(m.get("frequency") or "-"), s_cell), Paragraph(str(m.get("duration") or "-"), s_cell)])
                    mt = Table(med_data, colWidths=[55*mm, 35*mm, 45*mm, 35*mm], repeatRows=1)
                    mt.setStyle(TableStyle([('BACKGROUND', (0,0), (-1,0), colors.HexColor("#0E7490")), ('TEXTCOLOR', (0,0), (-1,0), colors.white), ('GRID', (0,0), (-1,-1), 0.4, colors.HexColor("#CBD5E1")), ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor("#F8FAFC")]), ('VALIGN', (0,0), (-1,-1), 'MIDDLE'), ('LEFTPADDING', (0,0), (-1,-1), 3), ('RIGHTPADDING', (0,0), (-1,-1), 3), ('TOPPADDING', (0,0), (-1,-1), 2), ('BOTTOMPADDING', (0,0), (-1,-1), 2)]))
                    story.append(Spacer(1, 1.5*mm))
                    story.append(mt)
                    story.append(Spacer(1, 1.5*mm))
                else:
                    if d.get("doc_type") == "prescription":
                        story.append(Paragraph("<i>No medicines extracted from this prescription image.</i>", s_small))
                # Lab values
                if d.get("lab_values"):
                    lab_data = [[Paragraph("<b>Test</b>", s_cellH), Paragraph("<b>Value</b>", s_cellH), Paragraph("<b>Unit</b>", s_cellH), Paragraph("<b>Reference</b>", s_cellH), Paragraph("<b>Flag</b>", s_cellH)]]
                    for lv in d["lab_values"]:
                        flag = "ABNORMAL" if lv.get("abnormal") else "-"
                        lab_data.append([Paragraph(str(lv.get("test") or "-"), s_cell), Paragraph(str(lv.get("value") or "-"), s_cell), Paragraph(str(lv.get("unit") or "-"), s_cell), Paragraph(str(lv.get("reference_range") or "-"), s_cell), Paragraph(f"<font color=\"{'#DC2626' if lv.get('abnormal') else '#6B7280'}\">{flag}</font>", s_cell)])
                    lt = Table(lab_data, colWidths=[55*mm, 30*mm, 30*mm, 40*mm, 15*mm], repeatRows=1)
                    lt.setStyle(TableStyle([('BACKGROUND', (0,0), (-1,0), colors.HexColor("#0E7490")), ('GRID', (0,0), (-1,-1), 0.4, colors.HexColor("#CBD5E1")), ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor("#F8FAFC")]), ('VALIGN', (0,0), (-1,-1), 'MIDDLE'), ('LEFTPADDING', (0,0), (-1,-1), 3), ('RIGHTPADDING', (0,0), (-1,-1), 3)]))
                    story.append(lt)
                    story.append(Spacer(1, 1.5*mm))
                if d.get("procedures"):
                    story.append(Paragraph("<b>Procedures:</b> " + ", ".join(d["procedures"]), s_normal))
                if d.get("ocr_text"):
                    txt = d["ocr_text"][:1200].replace("<","&lt;")
                    story.append(Paragraph(f"<b>Extracted text:</b><br/><font size=7 color=\"#4B5563\">{txt}</font>", s_small))
                if d.get("ai_summary"):
                    story.append(Paragraph(f"<b>AI Insight:</b> {d['ai_summary']}", ParagraphStyle('Insight', parent=s_small, textColor=colors.HexColor("#0F766E"), borderPadding=(2,4,2), backColor=colors.HexColor("#F0FDFA"))))
                story.append(Spacer(1, 2*mm))
            story.append(HRFlowable(width="100%", thickness=0.3, color=colors.HexColor("#E2E8F0")))

    story.append(Spacer(1, 6*mm))
    story.append(HRFlowable(width="100%", thickness=0.6, color=colors.HexColor("#0E7490")))
    story.append(Paragraph("AI-generated draft for physician review only &mdash; Not a diagnosis. Verify with source images. &middot; MediKiosk / SIH26047 &middot; DPDP Act 2023 compliant &middot; Session data auto-purged after HIS push.", ParagraphStyle('Footer', parent=s_small, alignment=TA_CENTER, textColor=colors.HexColor("#6B7280"))))
    doc.build(story)
    return buf.getvalue()


def _generate_with_pymupdf(session_id: str, identity: dict, documents: list[dict]) -> bytes:
    import pymupdf
    pdf = pymupdf.open()
    page = pdf.new_page(width=595, height=842)  # A4
    y = 40
    def add(text, size=10, bold=False, color=(0.06,0.46,0.57)):
        nonlocal y, page
        if y > 800:
            page = pdf.new_page(width=595, height=842)
            y = 40
        font = "helv"
        page.insert_text((40, y), text[:110], fontsize=size, fontname=font, color=color)
        y += size + 4
    add("MediKiosk - Structured Document Report", 16, True)
    add(f"Patient: {identity.get('name') or 'Unknown'}  ABHA: {identity.get('abha_id') or '-'}  Session: {session_id}", 8, False, (0.3,0.3,0.3))
    add(f"Generated: {datetime.now(timezone.utc).isoformat()}  Total docs: {len(documents)}", 7, False, (0.4,0.4,0.4))
    y += 6
    if not documents:
        add("No documents submitted.", 9, False, (0,0,0))
    else:
        for date, docs in group_by_date(documents):
            add(f"=== Date: {date} ===", 11, True, (0.06,0.46,0.57))
            for d in docs:
                add(f"[{d.get('doc_type','unknown').upper()}] ID {d.get('document_id')}", 8, True, (0,0,0))
                for diag in d.get("diagnoses", []):
                    add(f"  Diagnosis: {diag}", 7, False, (0,0,0))
                for m in d.get("medications", []):
                    add(f"  Med: {m.get('name')} | {m.get('dose') or '-'} | {m.get('frequency') or '-'} | {m.get('duration') or '-'}", 7, False, (0,0,0))
                for lv in d.get("lab_values", []):
                    flag = " ABNORMAL" if lv.get("abnormal") else ""
                    add(f"  Lab: {lv.get('test')} = {lv.get('value')} {lv.get('unit') or ''}{flag}", 7, False, (0,0,0))
                if d.get("ai_summary"):
                    add(f"  Note: {d['ai_summary'][:200]}", 7, False, (0.06,0.35,0.35))
                y += 4
    add("AI-generated draft for physician review only - Not a diagnosis.", 6, False, (0.5,0.5,0.5))
    out = io.BytesIO()
    pdf.save(out)
    return out.getvalue()


def _generate_txt_fallback(session_id: str, identity: dict, documents: list[dict]) -> bytes:
    text = build_structured_text(documents)
    header = f"MediKiosk Report - {identity.get('name')} - {session_id}\n{text}"
    return header.encode("utf-8")
