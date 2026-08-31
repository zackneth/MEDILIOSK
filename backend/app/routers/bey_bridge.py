import asyncio
import logging
import time
import uuid
import json as _json

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse

from app.models.schemas import AnswerIn, InterviewState, PatientIdentity, SessionStart
from app.services.interview_engine import get_engine
from app.services.localize import LANG_NAMES
from app.services.session_store import sessions

logger = logging.getLogger(__name__)

router = APIRouter(tags=["bey-bridge"])

active_bey_sessions: dict[str, str] = {}
DEFAULT_IDENTITY = {"abha_id": None, "name": "Walk-in", "age": None, "sex": None}


@router.post("/interview/{session_id}/activate-for-avatar")
def activate_for_avatar(session_id: str):
    if session_id not in sessions:
        return JSONResponse(status_code=404, content={"detail": "Session not found"})
    active_bey_sessions["current"] = session_id
    return {"activated": True, "session_id": session_id}


@router.post("/v1/chat/completions")
async def bey_bridge(request: Request):
    body = await request.json()
    wants_stream = bool(body.get("stream"))
    messages = body.get("messages", [])
    user_msgs = [m for m in messages if m.get("role") == "user"]
    latest_user = user_msgs[-1]["content"] if user_msgs else ""

    session_id = active_bey_sessions.get("current")
    if not session_id or session_id not in sessions:
        session_id = _bootstrap_session()
        active_bey_sessions["current"] = session_id

    record = sessions[session_id]
    state = InterviewState(**record["state"])

    # language-aware: use session lang (12 languages) for greeting + question
    lang = record.get("lang") or record.get("consent", {}).get("language") or "en"
    lang_name = LANG_NAMES.get(lang, "English")

    reply_text = ""
    if not state.current_question:
        record["mode"] = record.get("mode", "allopathic")
        engine = get_engine(record["mode"])
        turn = engine.start(session_id, record["mode"])
        # localize the initial question via engine's lang handling
        # engine.start doesn't localize, so translate greeting + question
        record["state"] = turn.state.model_dump()
        # force localize question if not en
        if lang != "en" and turn.question:
            from app.services.localize import localize_question
            turn.question = localize_question(turn.question, lang)
            record["state"]["current_question"] = turn.question.model_dump()
            reply_text = turn.question.text
        else:
            reply_text = turn.avatar_speech or ""
        # greeting in patient's language
        if lang == "hi":
            reply_text = f"नमस्ते, मैं डॉ. सहायक हूँ। {reply_text}"
        elif lang != "en":
            reply_text = f"Namaste, I am Dr. Sahayak. [{lang_name}] {reply_text}"
        else:
            reply_text = f"Namaste, I am your digital health assistant. {reply_text}"
    else:
        qid = state.current_question.id
        engine = get_engine(record.get("mode", "allopathic"))
        turn = engine.submit_answer(state, latest_user, None, lang=lang)
        record["state"] = turn.state.model_dump()
        reply_text = turn.avatar_speech or ""
        # if backend returned English but patient selected other language, translate reply
        if lang != "en" and reply_text and turn.question:
            # reply_text already contains localized question if is_repeat/is_assistant path handles lang
            # for clinical next question, ensure it's localized
            if turn.question and lang in LANG_NAMES:
                from app.services.localize import localize_question
                localized_q = localize_question(turn.question, lang)
                # if reply was the question text, replace with localized
                if reply_text.strip() == turn.question.text.strip() or turn.question.text in reply_text:
                    reply_text = reply_text.replace(turn.question.text, localized_q.text)
        if lang != "en" and reply_text:
            # ensure avatar speaks in target language: if reply still English, translate via LLM
            try:
                # quick check: if reply contains only English ascii and lang is non-en, translate
                is_english = all(ord(c) < 128 for c in reply_text[:80])
                if is_english and lang in LANG_NAMES:
                    from app.services.llm import llm_service
                    trans = llm_service.generate(
                        f"Translate this to natural spoken {lang_name}, keep medical terms simple. Text: \"{reply_text}\"",
                        system=f"You are a translator to {lang_name}. Reply only translated text.",
                        temperature=0.2,
                    )
                    if trans and len(trans.strip()) > 5:
                        reply_text = trans.strip()
            except Exception as e:
                logger.warning("bey video translate failed (%s): %s", lang, e)
        if turn.red_flag_alert and turn.red_flag_alert.severity == "emergency":
            reply_text += " I have alerted the medical team for urgent review."
        if not turn.question:
            reply_text += " You may now proceed to document scanning."

    completion_id = f"chatcmpl-{uuid.uuid4().hex[:12]}"
    created = int(time.time())

    if not wants_stream:
        return {
            "id": completion_id,
            "object": "chat.completion",
            "created": created,
            "model": body.get("model", "medikiosk-engine"),
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": reply_text},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        }

    async def sse():
        chunk_base = {
            "id": completion_id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": body.get("model", "medikiosk-engine"),
        }
        first = {**chunk_base, "choices": [{"index": 0, "delta": {"role": "assistant"}, "finish_reason": None}]}
        yield f"data: {_json.dumps(first)}\n\n"
        for word in reply_text.split(" "):
            piece = word + " "
            delta = {**chunk_base, "choices": [{"index": 0, "delta": {"content": piece}, "finish_reason": None}]}
            yield f"data: {_json.dumps(delta)}\n\n"
            await asyncio.sleep(0.02)
        done = {**chunk_base, "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}
        yield f"data: {_json.dumps(done)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(sse(), media_type="text/event-stream")


def _bootstrap_session() -> str:
    import uuid as _uuid

    sid = _uuid.uuid4().hex[:12]
    payload_mode = "allopathic"
    sessions[sid] = {
        "identity": dict(DEFAULT_IDENTITY),
        "consent": {"history_capture": True, "document_digitization": True, "share_with_physician": True, "language": "en"},
        "mode": payload_mode,
        "state": InterviewState(session_id=sid, mode=payload_mode).model_dump(),
        "documents": [],
    }
    return sid
