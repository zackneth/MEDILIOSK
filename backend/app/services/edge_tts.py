import io
import logging

logger = logging.getLogger(__name__)

# Edge TTS voices for 12 languages - all free, no API key
VOICE_MAP = {
    "en": "en-IN-NeerjaNeural",  # English India female
    "hi": "hi-IN-SwaraNeural",    # Hindi female
    "ta": "ta-IN-PallaviNeural",  # Tamil
    "te": "te-IN-ShrutiNeural",   # Telugu
    "kn": "kn-IN-GaganNeural",    # Kannada - switched to Male (was Sapna) per user feedback
    "ml": "ml-IN-SobhanaNeural",  # Malayalam
    "mr": "mr-IN-AarohiNeural",   # Marathi
    "bn": "bn-IN-TanishaaNeural", # Bengali
    "gu": "gu-IN-DhwaniNeural",   # Gujarati
    "pa": "pa-IN-GurleenNeural",  # Punjabi - fallback to hi if not available
    "or": "or-IN-SubhasiniNeural",# Odia - fallback to bn if not available
    "as": "as-IN-YashicaNeural",  # Assamese - fallback to bn if not available
}

# Fallback voices if primary not available
FALLBACKS = {
    "pa": "hi-IN-SwaraNeural",
    "or": "bn-IN-TanishaaNeural",
    "as": "bn-IN-TanishaaNeural",
}


def get_voice(lang: str) -> str:
    code = (lang or "en").split("-")[0].lower()
    return VOICE_MAP.get(code, "en-IN-NeerjaNeural")


async def synthesize(text: str, lang: str = "en") -> bytes | None:
    if not text or not text.strip():
        return None
    try:
        import edge_tts

        voice = get_voice(lang)
        # edge_tts.Communicate does its own SSML wrapping + escaping.
        # Passing manual <speak> tags causes them to be spoken literally
        # (e.g. "speak version equals 1.0 ..."). Use plain text + rate/pitch params.
        for attempt_voice in [voice, FALLBACKS.get(lang.split("-")[0].lower()), "en-IN-NeerjaNeural"]:
            if not attempt_voice:
                continue
            try:
                communicate = edge_tts.Communicate(text, attempt_voice, rate="-4%", pitch="+1Hz")
                audio_data = b""
                async for chunk in communicate.stream():
                    if chunk["type"] == "audio":
                        audio_data += chunk["data"]
                if audio_data:
                    return audio_data
            except Exception as e:
                logger.warning("Edge TTS voice %s failed: %s", attempt_voice, e)
                continue
        return None
    except ImportError:
        logger.warning("edge-tts not installed - run pip install edge-tts")
        return None
    except Exception as e:
        logger.warning("Edge TTS error: %s", e)
        return None
