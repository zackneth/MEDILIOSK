from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class ConsentGrant(BaseModel):
    history_capture: bool = False
    document_digitization: bool = False
    share_with_physician: bool = False
    language: str = "en"
    granted_at: Optional[datetime] = None
    revoked: bool = False


class PatientIdentity(BaseModel):
    abha_id: Optional[str] = None
    aadhaar_last4: Optional[str] = None
    name: Optional[str] = None
    age: Optional[int] = None
    sex: Optional[Literal["male", "female", "other"]] = None
    is_new_registration: bool = False


class SessionStart(BaseModel):
    identity: PatientIdentity
    consent: ConsentGrant
    mode: Literal["allopathic", "ayush"] = "allopathic"


class AnswerIn(BaseModel):
    question_id: str
    text: Optional[str] = None
    option_id: Optional[str] = None
    option_ids: Optional[list[str]] = None
    skipped: bool = False


class ExtractedSlot(BaseModel):
    value: Optional[str] = None
    normalized: Optional[str] = None
    confidence: Literal["high", "medium", "low"] = "high"
    illegible_or_unsure: bool = False


class RedFlag(BaseModel):
    code: str
    description: str
    severity: Literal["emergency", "urgent"]
    triggered_by_question: str
    triggered_by_answer: str


class AskedQuestion(BaseModel):
    id: str
    section: str
    text: str
    text_hi: Optional[str] = None
    mcq_options: list[str] = Field(default_factory=list)
    allows_free_text: bool = True
    multi_select: bool = False


class InterviewState(BaseModel):
    session_id: str
    mode: Literal["allopathic", "ayush"] = "allopathic"
    current_section: str = "chief_complaint"
    current_question: Optional[AskedQuestion] = None
    answers: dict[str, Any] = Field(default_factory=dict)
    extracted: dict[str, ExtractedSlot] = Field(default_factory=dict)
    red_flags: list[RedFlag] = Field(default_factory=list)
    completed_sections: list[str] = Field(default_factory=list)
    triage_priority: Literal["routine", "priority"] = "routine"
    finished: bool = False


class NextTurn(BaseModel):
    state: InterviewState
    question: Optional[AskedQuestion]
    avatar_speech: Optional[str] = None
    red_flag_alert: Optional[RedFlag] = None
    progress_percent: int = 0
    assistant_reply: Optional[str] = None
    is_assistant: bool = False
    is_repeat: bool = False


class Medication(BaseModel):
    name: Optional[str] = None
    dose: Optional[str] = None
    frequency: Optional[str] = None
    duration: Optional[str] = None


class LabValue(BaseModel):
    test: Optional[str] = None
    value: Optional[str] = None
    unit: Optional[str] = None
    reference_range: Optional[str] = None
    abnormal: bool = False


class DocumentExtraction(BaseModel):
    document_id: str
    doc_type: Literal["prescription", "lab_report", "discharge_summary", "unknown"] = "unknown"
    patient_name: Optional[str] = None
    date: Optional[str] = None
    diagnoses: list[str] = Field(default_factory=list)
    medications: list[Medication] = Field(default_factory=list)
    lab_values: list[LabValue] = Field(default_factory=list)
    procedures: list[str] = Field(default_factory=list)
    confidence_issues: list[str] = Field(default_factory=list)
    ocr_text: str = ""
    ai_summary: str = ""
    image_url: str = ""


class SummaryRequest(BaseModel):
    session_id: str


class PhysicianSummary(BaseModel):
    chief_complaint: str = ""
    hpi: str = ""
    past_medical_surgical: str = ""
    drug_allergy: str = ""
    family_history: str = ""
    personal_history: str = ""
    ros: str = ""
    prior_investigations: str = ""
    ayush_dashavidha: dict[str, str] = Field(default_factory=dict)
    documents_ocr: str = ""
    documents_ai_ocr: str = ""
    documents_timeline: list[DocumentExtraction] = Field(default_factory=list)
    # NEW: separate Document Summary (date-wise, from uploaded docs) - isolated from AI conversation
    document_summary: str = ""
    document_summary_grouped: list[dict] = Field(default_factory=list)
    red_flags: list[RedFlag] = Field(default_factory=list)
    disclaimer: str = "AI-generated draft for physician review. Not a diagnosis."
