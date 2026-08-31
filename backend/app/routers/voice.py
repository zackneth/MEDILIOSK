from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel

from app.services import edge_tts

router = APIRouter(prefix="/voice", tags=["voice"])


class TTSRequest(BaseModel):
    text: str
    lang: str = "en"


@router.post("/tts")
async def text_to_speech(req: TTSRequest):
    # Free Edge TTS - supports all 12 languages, no API key needed
    audio = await edge_tts.synthesize(req.text, req.lang)
    if not audio:
        return Response(status_code=204)
    return Response(content=audio, media_type="audio/mpeg")
