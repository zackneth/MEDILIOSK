import json
import logging
import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.config import settings
from app.models.schemas import PhysicianSummary, RedFlag, SummaryRequest
from app.services.bey_transcript import fetch_latest_transcript, structure_transcript
from app.services.fhir import fhir_service
from app.services.session_store import archive, sessions
from app.services.summary import summary_service

logger = logging.getLogger(__name__)


AGENT_IDS = {
    "allopathic": "b195bd7d-60db-49d5-9166-9f608ae43b5a",
    "ayush": "28907828-d01a-45a0-b876-33906a06af62",
}


class BeyTranscriptRequest(BaseModel):
    session_id: str
    agent_id: str = ""

router = APIRouter(prefix="/summary", tags=["summary"])


def _docs_ocr_text(documents: list[dict]) -> str:
    # Date-wise ordered OCR text for doctor readability
    try:
        from app.services.document_report import build_structured_text
        return build_structured_text(documents)
    except Exception:
        return "\n\n".join([d["ocr_text"] for d in documents if d.get("ocr_text")])


def _docs_ai_narrative(documents: list[dict]) -> str:
    parts = [d["ai_summary"] for d in documents if d.get("ai_summary")]
    return " ".join(parts)


def _docs_timeline_sorted(documents: list[dict]):
    """Return documents sorted date-wise for PhysicianSummary."""
    try:
        from app.models.schemas import DocumentExtraction
        sorted_docs = sorted(documents, key=lambda d: d.get("date") or "9999")
        # Convert to DocumentExtraction models for proper validation
        out = []
        for d in sorted_docs:
            try:
                out.append(DocumentExtraction(**d))
            except Exception:
                out.append(d)
        return out
    except Exception:
        return documents


@router.post("/generate", response_model=PhysicianSummary)
def generate_summary(payload: SummaryRequest):
    record = sessions.get(payload.session_id)
    if not record:
        raise HTTPException(status_code=404, detail="Session not found")
    state_data = {
        **record["state"],
        "identity": record["identity"],
        "documents": record["documents"],
    }
    summary = summary_service.generate(payload, state_data)
    summary.red_flags = [RedFlag(**rf) for rf in record["state"].get("red_flags", [])]
    summary.documents_ocr = _docs_ocr_text(record["documents"])
    summary.documents_ai_ocr = _docs_ai_narrative(record["documents"])
    summary.documents_timeline = _docs_timeline_sorted(record["documents"])
    # NEW: separate Document Summary (date-wise, isolated from AI conversation)
    try:
        from app.services.document_report import build_structured_text, group_by_date
        summary.document_summary = build_structured_text(record["documents"])
        summary.document_summary_grouped = [{"date": d, "documents": docs} for d, docs in group_by_date(record["documents"])]
    except Exception:
        summary.document_summary = _docs_ocr_text(record["documents"])
        summary.document_summary_grouped = []
    record["summary"] = summary.model_dump()
    return summary


@router.get("/{session_id}", response_model=PhysicianSummary)
def get_summary(session_id: str):
    record = sessions.get(session_id)
    if not record:
        raise HTTPException(status_code=404, detail="Session not found or cleared after HIS push")
    if "summary" not in record:
        return generate_summary(SummaryRequest(session_id=session_id))
    return PhysicianSummary(**record["summary"])


@router.post("/from-video", response_model=PhysicianSummary)
def summary_from_video(payload: BeyTranscriptRequest):
    record = sessions.get(payload.session_id)
    if not record:
        from app.models.schemas import InterviewState
        record = {
            "identity": {"abha_id": None, "name": "Video patient", "age": None, "sex": None},
            "consent": {"history_capture": True, "document_digitization": False, "share_with_physician": True, "language": "en"},
            "mode": "allopathic",
            "state": InterviewState(session_id=payload.session_id, mode="allopathic").model_dump(),
            "documents": [],
        }
        sessions[payload.session_id] = record

    result = fetch_latest_transcript(settings.bey_api_key, payload.agent_id or AGENT_IDS.get(record.get("mode"), AGENT_IDS["allopathic"]))
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])

    structured = structure_transcript(result["transcript"])
    red_flags = [RedFlag(code="RF_VIDEO", description=d, severity="urgent",
                         triggered_by_question="video_interview", triggered_by_answer="")
                 for d in (structured.get("red_flags") or [])]

    # also populate separate Document Summary for video flow
    try:
        from app.services.document_report import build_structured_text, group_by_date
        doc_sum = build_structured_text(record["documents"])
        doc_grouped = [{"date": d, "documents": docs} for d, docs in group_by_date(record["documents"])]
    except Exception:
        doc_sum = _docs_ocr_text(record["documents"])
        doc_grouped = []
    summary = PhysicianSummary(
        chief_complaint=structured.get("chief_complaint", ""),
        hpi=structured.get("hpi", ""),
        past_medical_surgical=structured.get("past_medical_surgical", ""),
        drug_allergy=structured.get("drug_allergy", ""),
        family_history=structured.get("family_history", ""),
        personal_history=structured.get("personal_history", ""),
        ros=structured.get("ros", ""),
        prior_investigations=structured.get("prior_investigations", ""),
        documents_ocr=_docs_ocr_text(record["documents"]),
        documents_ai_ocr=_docs_ai_narrative(record["documents"]),
        document_summary=doc_sum,
        document_summary_grouped=doc_grouped,
        red_flags=red_flags,
    )
    record["summary"] = summary.model_dump()
    record["video_transcript"] = result
    return summary


@router.post("/{session_id}/push-his")
def push_to_his(session_id: str):
    record = sessions.get(session_id)
    if not record:
        raise HTTPException(status_code=404, detail="Session not found")
    bundle = fhir_service.build_bundle(
        {
            **record["state"],
            "identity": record["identity"],
            "documents": record["documents"],
        }
    )
    result = fhir_service.push_to_his(bundle)
    if result.get("status_code") in (200, 201):
        if "summary" in record:
            archive[session_id] = {
                "summary": record["summary"],
                "identity": record.get("identity", {}),
                "documents": record.get("documents", []),
            }
        sessions.pop(session_id, None)
        return {"his_push": result, "session_cleared": True, "bundle_preview": bundle["entry"][:2]}
    return {"his_push": result, "session_cleared": False, "note": "Session retained for retry"}


@router.get("/docs-images/{session_id}")
def get_doc_images(session_id: str):
    rec = sessions.get(session_id) or archive.get(session_id)
    if not rec:
        raise HTTPException(status_code=404, detail="No documents")
    return {"documents": [
        {"document_id": d.get("document_id"), "image_url": d.get("image_url"), "doc_type": d.get("doc_type"), "date": d.get("date")}
        for d in rec.get("documents", []) if d.get("image_url")
    ]}


@router.get("/archived/{session_id}", response_model=PhysicianSummary)
def get_archived_summary(session_id: str):
    rec = archive.get(session_id)
    if not rec or "summary" not in rec:
        raise HTTPException(status_code=404, detail="No archived summary for this session")
    return PhysicianSummary(**rec["summary"])
