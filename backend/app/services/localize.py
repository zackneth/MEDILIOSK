import logging

from app.models.schemas import AskedQuestion
from app.services.llm import llm_service

logger = logging.getLogger(__name__)

_cache: dict[tuple[str, str], AskedQuestion] = {}


LANG_NAMES = {
    "hi": "Hindi", "ta": "Tamil", "te": "Telugu", "kn": "Kannada", "ml": "Malayalam",
    "mr": "Marathi", "bn": "Bengali", "gu": "Gujarati", "pa": "Punjabi", "or": "Odia", "as": "Assamese",
}

def localize_question(q: AskedQuestion, lang: str) -> AskedQuestion:
    if not q.text or not lang or lang == "en":
        return q
    if lang not in LANG_NAMES:
        return q
    key = (q.id, lang)
    if key in _cache:
        return _cache[key]
    try:
        lang_name = LANG_NAMES[lang]
        options_json = json_list(q.mcq_options)
        prompt = (
            f"Translate this medical intake question into simple spoken {lang_name} for a patient. "
            f"Reply ONLY with JSON: {{\"text\": \"...\", \"options\": {options_json}}}\n"
            "Keep numbers and medicine names unchanged. Keep translation natural and short.\n\n"
            f"Question: {q.text}"
        )
        data = llm_service.extract_json(prompt)
        hi_text = (data.get("text") or "").strip()
        hi_opts = data.get("options") if isinstance(data.get("options"), list) else None
        update = {}
        if hi_text:
            update["text"] = hi_text
        if hi_opts and len(hi_opts) == len(q.mcq_options):
            update["mcq_options"] = [str(o) for o in hi_opts]
        if update:
            localized = q.model_copy(update=update)
            _cache[key] = localized
            return localized
    except Exception as e:
        logger.warning("localize_question failed for %s (%s): %s", q.id, lang, e)
    return q


def json_list(items: list[str]) -> str:
    import json as _json
    return _json.dumps(items, ensure_ascii=False)
