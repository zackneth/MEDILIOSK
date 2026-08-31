# MediKiosk — SIH26047

AI-powered clinical history platform with a live talking AI doctor. Smart India Hackathon 2026, PS SIH26047 (Ministry of Ayush — Patient Case-Taking Software).

## What it does
A patient walks into an OPD kiosk and:
1. **Identifies** (name/ABHA) + gives **audio-guided DPDP/ABDM consent** in English or Hindi
2. **Talks to Dr. Sahayak** — a real-time photoreal video avatar conducting a structured clinical history (SOCRATES adaptive questioning; AYUSH Dashavidha Pariksha mode available)
3. Red-flag symptoms (radiating chest pain, stroke signs) trigger an instant priority triage alert
4. **Scans old prescriptions/lab reports** → Gemini vision OCR extracts diagnoses, medications, lab values → chronological timeline + abnormal-value + drug-interaction flags
5. A **structured physician summary** (CC→HPI→PMH→Drug/Allergy→Family→Personal→ROS→Investigations) is generated, pushed as a FHIR R4 bundle to the hospital HIS, linked to ABHA — then session data is auto-purged
6. The physician reviews/edits a pre-consult summary in seconds and can export it as PDF

## Two interview brains
- **Video mode** (primary): BeyondPresence conversational avatar with clinical system prompt. Transcript pulled post-call and structured by Gemini.
- **Kiosk/touch mode** (fallback): our ontology-constrained state-machine engine (`backend/app/ontology/`) with branching follow-ups, red-flag rules, multi-select MCQs, voice input via Gemini STT.

## Run it
```bash
# backend
cd backend
pip install -r requirements.txt
copy .env.example .env   # add GEMINI_API_KEY + BEY_API_KEY
python -m uvicorn app.main:app --port 8000

# frontend
cd frontend
npm install
npm run dev              # http://localhost:5173
```

### Environment keys
| Key | Where | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | Google AI Studio | Interview translation, doc OCR, transcript structuring, STT |
| `BEY_API_KEY` | bey.studio/settings/api-keys | Video avatar |
| `VITE_BEY_AGENT_ID` | frontend/.env | Agent id from `python backend/setup_bey_hd.py` |

## Architecture
```
React/Vite kiosk ── FastAPI ──┬─ Interview engine (ontology YAML state machine + red flags)
                              ├─ Gemini VLM document-AI (structured JSON extraction)
                              ├─ Gemini transcript structuring (video interviews)
                              ├─ BeyondPresence API (avatar) / Gemini STT (voice fallback)
                              └─ FHIR R4 bundles → HIS (mock; ABDM Sandbox = production path)
```

## Compliance notes
- Consent captured before processing, purpose-limited, granular & revocable (DPDP Act 2023 + ABDM consent framework patterns)
- Temporary sessions; data purged immediately after HIS submission
- Summary is always a physician-editable draft — never an autonomous diagnosis
