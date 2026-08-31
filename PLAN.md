# MediKiosk — SIH26047 Full Execution Plan
### AI-Powered Clinical History Platform with Live Talking Avatar
**PS:** SIH26047 — Patient Case-Taking Software (Ministry of Ayush)
**Idea submission deadline: 20 September 2026 | Today: 24 Aug 2026 → ~4 weeks**

---

## 0. GOLDEN RULE
Every feature we build must trace back to a sentence in the PS. Nothing extra, nothing missing.
The PS names exactly 4 modules + 5 patient-journey steps + 5 challenges. Our plan mirrors that 1:1.

---

## 1. SYSTEM ARCHITECTURE (one diagram for the PPT)

```
┌────────────────────────── KIOSK FRONTEND (React/Next.js) ──────────────────────────┐
│  Avatar Layer        Voice Layer         Touch Layer         Doc Scan Layer         │
│  (talking human      (mic in, TTS out)   (icon UI fallback)  (camera/file upload)  │
│   face, lip-synced)                                                                  │
└──────────────┬───────────────────────────────────────────────────────────────────────┘
               │ WebSocket / REST
┌──────────────▼──────────── BACKEND (FastAPI, Python) ───────────────────────────────┐
│ M1 Interview Engine   │ M2 Document AI      │ M3 Summary Generator │ M4 Consent    │
│ - clinical ontology   │ - VLM OCR extract   │ - merge history+docs │ - ABHA auth   │
│ - adaptive branching  │ - timeline builder  │ - physician format   │ - consent mgr │
│ - red-flag detector   │ - drug-interaction  │ - bilingual output   │ - FHIR push   │
│ - AYUSH Dashavidha    │   flags             │                      │ - session wipe│
└──────────────┬───────────────────────────────────────────────────────────────────────┘
               │
     ┌─────────┼──────────┬─────────────────┬──────────────────┐
     ▼         ▼          ▼                 ▼                  ▼
  LLM API   ASR/TTS    Vector/SQL DB    Mock HIS endpoint   (future) real ABDM gateway
  (Gemini/  (Bhashini/ (Postgres +      (FHIR R4 bundles)   via ABDM sandbox
   GPT)      Whisper/   JSONB)
             Sarvam)
```

Design principle to state on stage: **"The avatar is an accessibility layer over Module A — removable without changing the core engine."**

---

## 2. MODULE-WISE BUILD PLAN

### MODULE A — Conversational Multimodal History Engine (THE CORE — build first)
PS requirements it must satisfy:
- [ ] Structured clinical interview: CC → HPI → Past medical/surgical → Drug/allergy → Family → Personal → ROS
- [ ] Adaptive branching driven by answers ("chest pain" → SOCRATES probe: onset, character, radiation, aggravating/relieving)
- [ ] Dialogue manager constrained by a clinical history ontology (NOT free-form LLM chat)
- [ ] Dual-mode input: every question answerable by VOICE or TOUCH (MCQ tap options always visible)
- [ ] Indian-language ASR — use Bhashini / AI4Bharat APIs (named in PS; fallback: Whisper)
- [ ] TTS audio prompts (Bhashini TTS / Sarvam / Edge-TTS)
- [ ] Red-flag detection → immediate priority triage alert (acute chest pain + dyspnoea, stroke FAST signs, etc.) — never routine queue
- [ ] AYUSH MODE toggle: full Dashavidha Pariksha capture:
      Prakriti, Vikriti, Sara, Samhanana, Pramana, Satmya, Sattva,
      Ahara Shakti, Vyayama Shakti, Vaya + Ahara-Vihara assessment

Build details:
- Ontology = YAML/JSON state machine: sections → questions → follow-up rules → termination conditions. LLM fills free-text slots inside the ontology's slots only
- Each question object: {id, text_en, text_hi, mcq_options[], followup_rules[], redflag_rules[], ayush_field?}
- Interview state stored as structured JSON per session

### 🧑‍⚕️ AVATAR LAYER (differentiator — plugs into Module A output)
- Pipeline: LLM response text → TTS (streaming) → avatar lip-sync stream → kiosk screen
- Primary: D-ID or HeyGen streaming API (fastest integration, photorealistic)
- Open-source backup angle for pitch: local photoreal talking-head pipeline (e.g., streaming avatar model) = "no foreign cloud dependency" story
- Rules: avatar speaks ONLY the interview engine's scripted+LLM text; no autonomous claims; short utterances for low latency
- Graceful degradation: avatar fails → plain TTS voice mode continues (demo-safe)

### MODULE B — Medical Document Digitization & Intelligence
- [ ] Upload/scan prescriptions, lab reports, discharge summaries
- [ ] Extraction pipeline: PRIMARY = vision-language model single pass (Gemini 2.5 Flash recommended; Qwen2.5-VL as on-prem story), FALLBACK = Surya OCR → LLM structuring, LAST = Tesseract (printed only)
- [ ] Structured output schema (strict JSON):
      {patient_name, date, diagnoses[],
       medications[{name, dose, frequency, duration}],
       lab_values[{test, value, unit, reference_range, abnormal?}],
       procedures[], confidence_per_field, illegible_flags[]}
- [ ] Automatic dating + chronological medical timeline UI
- [ ] Abnormal-value highlighting vs reference ranges
- [ ] Drug-interaction flagging (RxNorm/open drug DB lookup, small curated interaction table acceptable for prototype)
- [ ] Low-confidence fields surfaced to patient/physician for confirmation (maps to "editable & verifiable")

### MODULE C — Structured History Summary Generator
- [ ] Merge interview JSON + extracted document data
- [ ] Output EXACT standard order: Chief complaint → HPI → Past medical/surgical → Drug & allergy → Family → Personal → ROS → Prior investigations summary
- [ ] Appears on physician dashboard BEFORE patient enters room
- [ ] ALWAYS a draft: physician can accept / edit each field / reject — never auto-saved diagnosis
- [ ] Physician-facing language: English/Hindi; patient-facing: audio confirmation in local language
- [ ] One-page printable/PDF summary

### MODULE D — Consent, Privacy & ABDM Integration
- [ ] Identity step: enter/scan ABHA ID (mock verify) OR Aadhaar OR new registration
- [ ] Language selection first screen
- [ ] AUDIO-guided consent (for low-literacy) — DPDP compliant notice: what data, why, who sees it
- [ ] Granular checkboxes: history capture ✅ / document digitization ✅ / share with treating physician ✅ — revocable button
- [ ] Session data purge after submission — visible "Session cleared ✓" state (slide moment!)
- [ ] FHIR R4 bundle generation (Patient, DocumentReference, Observation resources) POSTed to mock HIS endpoint
- [ ] Architecture slide shows where real ABDM Gateway/HIE would plug in (ABDM Sandbox docs referenced)

---

## 3. REQUIREMENT TRACEABILITY MATRIX (put condensed version in PPT appendix)

| # | PS requirement | Where we solve it |
|---|---|---|
| C1 | Multilingual multi-accent voice in noisy OPDs | Bhashini/AI4Bharat ASR + mic-array note + touch fallback |
| C2 | Zero-training low-literacy usability | Icon UI + audio prompts + AVATAR face + MCQ taps |
| C3 | Free narration → standardized structure | Ontology-constrained dialogue manager + slot-filling |
| C3b | Dashavidha Pariksha (AYUSH mode) | Dedicated interview branch, all 10 parameters |
| C4 | Handwritten+printed multilingual OCR | VLM extraction + Surya fallback + confidence flags |
| C5 | DPDP 2023 + ABDM consent | Audio granular revocable consent + session purge + FHIR |
| M-A | SOCRATES-style adaptive probing | Follow-up rule engine per chief complaint |
| M-A2 | Red-flag priority alert | Symptom→triage rule layer, overrides queue |
| M-B1 | Extract dx, meds+dose, labs+ranges, surgeries | Strict extraction schema + validation |
| M-B2 | Chronological timeline | Date normalization + ordering UI |
| M-B3 | Abnormal values + drug interactions | Range checker + interaction table flags |
| M-C1 | Standard summary format, pre-consult display | Physician dashboard, exact section order |
| M-C2 | Draft-only, never autonomous diagnosis | Accept/edit/reject per field; disclaimer everywhere |
| M-C3 | Bilingual outputs | EN/HI physician view; local-language patient audio |
| M-D1 | ABHA/Aadhaar/new registration | Step 1 identity screens |
| M-D2 | Session termination & secure processing | Auto-purge + no-retention design |
| J1-J5 | Patient journey steps 1–5 | Demo script follows them EXACTLY |

---

## 4. TIMELINE (24 Aug → 20 Sep idea lock; then finale prep)

### Week 1 (24–31 Aug): Foundations
- Day 1–2: Repo, FastAPI skeleton, React kiosk shell, Postgres schema
- Day 2–4: Clinical ontology v1 (allopathic full path incl. SOCRATES branches for top 10 chief complaints: chest pain, fever, headache, cough, abdominal pain, breathlessness, joint pain, dizziness, vomiting, injury)
- Day 3–5: Interview engine API (slot-filling, branching, red-flag rules) + unit tests
- Day 5–7: ASR (Whisper local first) + TTS wired into frontend; voice loop working end-to-end in English

### Week 2 (31 Aug – 7 Sep): Depth
- Bhashini/Sarvam ASR-TTS integration (Hindi) + language switcher
- Module B: VLM extraction pipeline + schema validation + test set (20 images: handwritten scripts, lab reports, Hindi labels) → measure accuracy
- Timeline UI + abnormal-value highlighting
- AYUSH Dashavidha branch ontology (get an Ayurveda student/faculty to review question phrasing!)

### Week 3 (7–14 Sep): Differentiators
- Avatar integration (D-ID/HeyGen stream or open-source); latency tuning; fallback mode
- Module C summary generator + physician dashboard + PDF export
- Module D: consent flow (audio-guided), mock FHIR bundles, mock HIS endpoint, session wipe
- Red-flag triage alert demo path

### Week 4 (14–20 Sep): Polish + Submission
- Multilingual QA (Hindi end-to-end run), edge cases, error states
- PPT (SIH format), demo video, public GitHub repo cleanup + README
- Dry-run demos ×3, record backup video
- SUBMIT before deadline buffer (target: submit by 17 Sep)

### Between selection & finale
- On-prem Qwen2.5-VL option, more regional languages, knowledge-graph mention slides, deployment guide, hospital pilot proposal

---

## 5. TEAM ROLES (6 members — adjust to actual team)
1. **AI/Conversation lead**: ontology, interview engine, prompts, red-flag rules
2. **Backend lead**: FastAPI, sessions, FHIR, consent service, integrations
3. **Frontend/kiosk lead**: React UI, icon-driven UX, accessibility flows, physician dashboard
4. **Vision/Doc-AI lead**: VLM pipeline, OCR fallbacks, timeline, interaction flags
5. **Avatar/voice lead**: TTS/ASR wiring, avatar streaming, latency, audio QA
6. **Research/pitch lead**: AYUSH domain accuracy, compliance slides, PPT/video, eval metrics
(Each also does testing; leads pair on integration days.)

---

## 6. DEMO SCRIPT (finale — follows PS journey steps verbatim)
1. **Identify**: select Hindi → ABHA entry → audio-guided consent (show revoke + granular toggles)
2. **Converse**: judge speaks to AVATAR doctor: "Mujhe seene mein dard ho raha hai" → SOCRATES follow-ups in Hindi; mid-interview trigger a red-flag answer → triage ALERT overlay fires
3. **Scan**: photograph a crumpled handwritten prescription live → structured meds appear on timeline, one abnormal lab value flagged
4. **Summarize & Route**: generate summary → push FHIR bundle to mock HIS (show JSON) → "Session cleared ✓"
5. **Consult**: switch to physician dashboard → complete history read in seconds → edit one field → accept → PDF
Close with metrics slide: ASR WER, extraction field accuracy, red-flag recall on test set, avg interview duration.

## 7. EVALUATION SLIDE (PS says solution must be "evaluable")
- Answer accuracy & citation of guideline source for red-flag rules
- Extraction precision/recall on labeled doc test set (n≥20)
- Safe-abstention rate: % of uncertain items correctly flagged low-confidence instead of guessed
- Multilingual quality: EN vs HI completion success rate
- Latency budget: <2.5s avatar response target

## 8. RISK REGISTER
| Risk | Mitigation |
|---|---|
| Avatar API latency/cost at venue | Pre-render greeting; short utterances; TTS-only fallback rehearsed |
| Noisy-room ASR failure | Touch MCQ fallback every step; external mic in kit |
| Handwriting extraction misses | Confidence flags + manual confirm flow (turns weakness into feature) |
| AYUSH terminology errors | Review by BAMS student/faculty BEFORE recording demo video |
| Scope creep (knowledge graph etc.) | Explicitly "Phase 2 roadmap" slide only — not built |
| Judge asks "is this a gimmick avatar?" | Line: avatar is Module A's zero-training accessibility front-end, architecturally removable |

## 9. COMPLIANCE CHECKLIST (DPDP + ABDM — say these exact things if asked)
- Consent captured BEFORE any processing; purpose-limited to care delivery
- Notice in user's chosen language; audio for low-literacy
- Granular + revocable consent artifacts (ABDM pattern)
- Data minimization; temporary session storage; auto-purge post-submission
- FHIR R4 for interoperability; ABDM Sandbox documented as production path
- Never autonomous diagnosis; physician-in-the-loop by design

---
*Source: SIH26047 official PS text (sih.gov.in snapshot). All checklist items map to explicit PS statements.*
