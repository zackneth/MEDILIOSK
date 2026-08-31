import logging

from fastapi import APIRouter, File, Form, UploadFile, HTTPException
from httpx import HTTPError

from app.core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/stt", tags=["stt"])

# Whisper supports all 12 languages: hi, en, ta, te, kn, ml, mr, bn, gu, pa, or, as
SUPPORTED_LANGS = {"hi", "en", "ta", "te", "kn", "ml", "mr", "bn", "gu", "pa", "or", "as"}


def _normalize_lang(lang: str) -> str:
    code = (lang or "en").split("-")[0].lower()
    return code if code in SUPPORTED_LANGS else "en"


@router.post("")
async def speech_to_text(file: UploadFile = File(...), language: str = Form("en")):
    audio = await file.read()
    if not audio:
        raise HTTPException(status_code=400, detail="Empty audio")

    lang = _normalize_lang(language)

    # Primary: Whisper via Groq (whisper-large-v3) - free, supports all 12 languages
    if settings.groq_api_key:
        text = await _groq_transcribe(audio, lang)
        if text:
            return {"text": text, "engine": "whisper", "language": lang}

    # Fallback: Gemini transcription
    text = await _gemini_transcribe(audio)
    return {"text": text, "engine": "gemini", "language": lang}


async def _groq_transcribe(audio: bytes, language: str = "en") -> str | None:
    try:
        import httpx

        r = await httpx.AsyncClient(timeout=30).post(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {settings.groq_api_key}"},
            files={"file": ("speech.wav", audio, "audio/wav")},
            data={"model": "whisper-large-v3", "language": (language or "en").split("-")[0]},
        )
        if r.status_code == 200:
            return (r.json().get("text") or "").strip()
        logger.warning("Groq STT failed: %s %s", r.status_code, r.text[:150])
        return None
    except Exception as e:
        logger.warning("Groq STT error: %s", e)
        return None


async def _gemini_transcribe(audio: bytes) -> str:
    import base64

    from app.services.llm import llm_service

    b64 = base64.b64encode(audio).decode()
    try:
        response = llm_service.client.models.generate_content(
            model="gemini-3.6-flash",
            contents=[
                "Transcribe this audio exactly as spoken. Output only the transcription.",
                {"inline_data": {"mime_type": "audio/wav", "data": b64}},
            ],
            config={"temperature": 0.0},
        )
        return (response.text or "").strip()
    except Exception as e:
        logger.error("Gemini STT failed: %s", e)
        return ""
