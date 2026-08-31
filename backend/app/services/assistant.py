import logging
import re

from app.services.llm import llm_service

logger = logging.getLogger(__name__)

SYSTEM = (
    "You are MediKiosk Assistant — the helpful voice of the MediKiosk SIH26047 clinical kiosk. "
    "MediKiosk is an AI-powered OPD history kiosk: patient identifies via ABHA/Aadhaar, gives audio-guided "
    "DPDP Act 2023 + ABDM consent in 12 languages (EN/HI and 10 more), talks to Dr. Sahayak (BeyondPresence avatar "
    "or voice/touch fallback) through an ontology-constrained interview (SOCRATES adaptive + AYUSH Dashavidha Pariksha), "
    "scans prescriptions/lab reports via Gemini Vision OCR (timeline + abnormal + drug-interaction flags), generates a "
    "structured physician summary (CC→HPI→PMH→Drug/Allergy→Family→Personal→ROS→Investigations), pushes FHIR R4 bundle to HIS "
    "linked to ABHA, then auto-purges session data. Red-flag symptoms trigger instant priority triage. Summary is always "
    "a physician-editable draft — never autonomous diagnosis. "
    "Be concise (2-4 sentences), friendly, in user's language. Never give medical diagnosis. If asked about privacy, "
    "stress DPDP compliance, purpose-limited consent, granular revocable toggles, data minimisation, temporary session."
)

# Fast heuristic — catches obvious meta-questions without LLM call
APP_KEYWORDS = re.compile(
    r"(medikiosk|kiosk|app|application|how (does|do) (this|it|you) work|what (is|are) (this|you|medikiosk)|who are you|privacy|consent|abha|abdm|fhir|data.*store|where.*data|is.*safe|is.*secure|dpdp|ayush|ocr|scan|report|summary|his|hospital|triage|red flag|language|hindi|microphone|voice|avatar|doctor sahayak|side effect|medicine|explain|help me|i don.?t understand|samajh nahi|batao)",
    re.I,
)
QUESTION_RE = re.compile(r"\?|^(what|why|how|where|when|who|which|can you|can i|could you|tell me|explain|help|is this|are you|do you|will you|aap|yeh kya|ye kya|kaise|kya hai|samjhao|batao|i want|i need|please)", re.I)


REPEAT_RE = re.compile(
    r"(repeat|again|pardon|say again|come again|didn.?t (understand|get|hear)|could you repeat|please repeat|what did you say|sorry.*what|can you repeat|phir se|dobara|samajh nahi|sunai nahi|suna nahi|ek bar phir|dohrao|repeat the question|say it again|repeat that|bol do dobara|phir se bolo|repeat karo)",
    re.I,
)

def _heuristic_is_repeat(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False
    # allow up to 12 words for natural repeat phrases like "I didn't understand, can you please repeat the question"
    if REPEAT_RE.search(t) and len(t.split()) <= 15:
        return True
    # very short repeat tokens
    if t.lower().strip() in ("repeat", "again", "pardon", "phir se", "dobara"):
        return True
    return False

def llm_is_repeat(user_text: str, current_question: str | None, lang: str = "en") -> bool:
    try:
        prompt = (
            f"Current clinical question: \"{current_question or 'N/A'}\"\n"
            f"User said: \"{user_text}\"\n"
            f"Is the user asking to REPEAT / re-hear the current question (e.g. 'repeat', 'say again', 'phir se bolo', 'I didn't understand, please repeat')?\n"
            "Reply ONLY JSON: {\"is_repeat\": true/false}"
        )
        data = llm_service.extract_json(prompt, system="You are a classifier for a medical kiosk. Detect repeat requests. Reply only JSON.")
        return bool(data.get("is_repeat"))
    except Exception as e:
        logger.warning("llm_is_repeat failed: %s", e)
        return False

def _heuristic_is_assistant(text: str) -> bool:
    t = (text or "").strip()
    if not t or len(t.split()) < 3:
        return False
    # any app-keyword statement should be considered interrupt even without ?
    if APP_KEYWORDS.search(t):
        return True
    # any question-like -> assistant
    if "?" in t or QUESTION_RE.search(t):
        return True
    return False


def answer_interrupt(user_text: str, current_question: str | None, lang: str = "en") -> str | None:
    """
    Returns assistant answer string if user_text is a meta-question about the app.
    Returns None if it's a clinical answer (should proceed with interview).
    Always uses LLM to decide — heuristic is just a fast-path to skip LLM for obvious clinical answers.
    """
    t = (user_text or "").strip()
    if not t:
        return None

    # Very short clinical answers like "chest pain", "2 days", "yes" should never be treated as assistant
    # But short help phrases should be assistant
    t_low = t.lower().strip()
    if t_low in ("help", "help me", "help please", "please help"):
        # direct assistant without LLM
        if lang.startswith("hi"):
            return "मैं आपकी मदद के लिए हूँ — आप मुझसे ऐप, गोपनीयता या अगले सवाल के बारे में पूछ सकते हैं।"
        return "I’m here to help — you can ask me about the app, privacy, or say ‘repeat’ to hear the question again."
    if len(t.split()) <= 2 and not "?" in t and not APP_KEYWORDS.search(t):
        return None

    # Broad gate: any question-like OR app-keyword statement must go to LLM — LLM decides
    should_ask_llm = _heuristic_is_assistant(t) or ("?" in t) or (QUESTION_RE.search(t) is not None) or (APP_KEYWORDS.search(t) is not None)
    if not should_ask_llm:
        # short statement without keywords/question is likely clinical answer like "chest pain for 2 days" — skip LLM
        return None

    prompt = (
        f"Current interview question (clinical): \"{current_question or 'N/A'}\"\n"
        f"User just said: \"{t}\"\n"
        f"User language code: {lang}\n\n"
        "Decide: Is this a VALID clinical answer to the current question (e.g. symptom, duration, yes/no, medicine name, pain description), "
        "or is it an INTERRUPT — a meta-question, help request, or any utterance NOT directly answering the clinical question (about the app, privacy, data, how it works, or any general question)?\n"
        "If it's a valid clinical answer, respond with JSON {\"is_assistant_query\": false}.\n"
        "If it's an interrupt/meta-question/general question, respond with JSON {\"is_assistant_query\": true, \"answer\": \"helpful answer in user's language (2-4 sentences, friendly, no diagnosis)\"}.\n"
        "Respond ONLY with valid JSON."
    )
    try:
        data = llm_service.extract_json(prompt, system=SYSTEM)
        if data.get("is_assistant_query") and data.get("answer"):
            ans = str(data["answer"]).strip()
            # keep answer concise
            if ans:
                return ans[:600]
        return None
    except Exception as e:
        logger.warning("assistant LLM failed: %s", e)
        # fallback: if heuristic said assistant, give canned answer
        if _heuristic_is_assistant(t):
            if lang.startswith("hi"):
                return "MediKiosk आपका OPD इतिहास कियोस्क है — ABHA से पहचान, 12 भाषाओं में सहमति, AI डॉक्टर से बातचीत, दस्तावेज़ स्कैन और FHIR के ज़रिए डॉक्टर को संरचित सारांश। आपका डेटा केवल इलाज के लिए है और सबमिशन के बाद मिटा दिया जाता है।"
            return "MediKiosk is your OPD history kiosk — ABHA identification, audio consent in 12 languages, AI interview with Dr. Sahayak, document scan via AI, and a structured FHIR summary sent to your doctor. Your data is temporary and auto-purged after submission."
        return None
