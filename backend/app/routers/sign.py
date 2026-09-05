"""ISL -> text bridge for MediKiosk.

Deaf patient signs to webcam -> frontend extracts hand landmarks (MediaPipe JS)
-> sends label/landmarks here -> we normalize the ISL gloss into plain clinical
text that the existing interview engine already understands.

No heavy ML here on purpose: runs on CPU / cheap kiosk, demo-safe in 2 days.
Swap `normalize_gloss` internals for a trained LSTM later without changing the API.
"""

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/sign", tags=["sign"])

# ISL gloss -> clinical English text the ontology engine expects.
# Covers fingerspelling (A-Z pass-through) + core medical vocabulary for SIH demo.
GLOSS_MAP = {
    "YES": "yes",
    "NO": "no",
    "PAIN": "I have pain",
    "ACHE": "I have pain",
    "FEVER": "I have fever",
    "COUGH": "I have cough",
    "COLD": "I have cold",
    "HEADACHE": "I have headache",
    "CHEST_PAIN": "I have chest pain",
    "BREATHLESS": "I have difficulty breathing",
    "BREATHING": "I have difficulty breathing",
    "VOMITING": "I am vomiting",
    "VOMIT": "I am vomiting",
    "NAUSEA": "I feel nauseous",
    "DIZZY": "I feel dizzy",
    "HELP": "I need help",
    "MEDICINE": "medicine",
    "TABLET": "medicine",
    "WATER": "water",
    "DOCTOR": "doctor",
    "HOSPITAL": "hospital",
    "THANK_YOU": "thank you",
    "THANKS": "thank you",
}


class NormalizeIn(BaseModel):
    label: str


class NormalizeOut(BaseModel):
    gloss: str
    text: str


@router.get("/vocabulary")
def vocabulary():
    """List of supported ISL glosses for the kiosk UI."""
    return {"glosses": sorted(GLOSS_MAP.keys()), "fingerspelling": "A-Z supported via hold-to-confirm"}


@router.post("/normalize", response_model=NormalizeOut)
def normalize(payload: NormalizeIn):
    raw = (payload.label or "").strip().upper().replace(" ", "_")
    if len(raw) == 1 and raw.isalpha():
        return NormalizeOut(gloss=raw, text=raw)
    text = GLOSS_MAP.get(raw, payload.label.strip())
    return NormalizeOut(gloss=raw, text=text)
