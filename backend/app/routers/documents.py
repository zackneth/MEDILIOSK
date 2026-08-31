import logging
import os
import uuid

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse

from app.services.docai import docai_service
from app.services.session_store import archive, sessions

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/documents", tags=["documents"])

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

ALLOWED_IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tiff"}


@router.post("/{session_id}/upload")
async def upload_document(session_id: str, files: list[UploadFile] = File(...)):
    record = sessions.get(session_id)
    if not record:
        raise HTTPException(status_code=404, detail="Session not found")
    if not record["consent"].get("document_digitization"):
        raise HTTPException(status_code=403, detail="Document digitization consent is required")

    results = []
    for file in files:
        contents = await file.read()
        if len(contents) > 15 * 1024 * 1024:
            results.append({"filename": file.filename, "error": "File too large (max 15MB)"})
            continue

        doc_id = uuid.uuid4().hex[:8]
        ext = os.path.splitext(file.filename or "")[1].lower() or ".png"
        saved_name = f"{session_id}_{doc_id}{ext}"
        with open(os.path.join(UPLOAD_DIR, saved_name), "wb") as f:
            f.write(contents)

        extraction = docai_service.extract(contents, file.filename or f"doc_{doc_id}")
        extraction.document_id = doc_id
        extraction.image_url = f"/uploads/{saved_name}"

        try:
            extraction.ai_summary = docai_service.ai_narrative(extraction)
        except Exception as e:
            logger.warning("narrative failed: %s", e)

        record["documents"].append(extraction.model_dump())
        results.append(extraction.model_dump())

    return JSONResponse(content={
        "extractions": results,
        "count": len(results),
        "total_documents": len(record["documents"]),
    })


@router.get("/{session_id}/timeline")
def get_timeline(session_id: str):
    record = sessions.get(session_id) or archive.get(session_id)
    if not record:
        raise HTTPException(status_code=404, detail="Session not found")
    docs = sorted(record.get("documents", []), key=lambda d: d.get("date") or "9999")
    # Group date-wise for frontend convenience
    from app.services.document_report import group_by_date, build_structured_text
    grouped = [{"date": date, "documents": docs_on_date} for date, docs_on_date in group_by_date(docs)]
    return {"timeline": docs, "grouped": grouped, "structured_text": build_structured_text(docs), "count": len(docs)}


@router.get("/{session_id}/report-pdf")
def get_report_pdf(session_id: str):
    """Date-wise structured PDF for doctor - aggregates ALL documents."""
    record = sessions.get(session_id) or archive.get(session_id)
    if not record:
        raise HTTPException(status_code=404, detail="Session not found")
    docs = record.get("documents", [])
    if not docs:
        raise HTTPException(status_code=404, detail="No documents to generate report")
    from app.services.document_report import generate_pdf
    import io
    pdf_bytes = generate_pdf(session_id, record.get("identity", {}), docs)
    # Detect if fallback txt was returned (not PDF header)
    is_pdf = pdf_bytes[:4] == b"%PDF"
    media = "application/pdf" if is_pdf else "text/plain"
    ext = "pdf" if is_pdf else "txt"
    return StreamingResponse(io.BytesIO(pdf_bytes), media_type=media, headers={
        "Content-Disposition": f'attachment; filename="MediKiosk_Report_{session_id[:8]}.{ext}"'
    })


@router.get("/{session_id}/report-json")
def get_report_json(session_id: str):
    """Structured JSON date-wise report for doctor view."""
    record = sessions.get(session_id) or archive.get(session_id)
    if not record:
        raise HTTPException(status_code=404, detail="Session not found")
    docs = sorted(record.get("documents", []), key=lambda d: d.get("date") or "9999")
    from app.services.document_report import group_by_date, build_structured_text
    return {
        "session_id": session_id,
        "patient": record.get("identity", {}),
        "total_documents": len(docs),
        "grouped": [{"date": date, "documents": docs_on_date} for date, docs_on_date in group_by_date(docs)],
        "structured_text": build_structured_text(docs),
        "timeline": docs,
    }
