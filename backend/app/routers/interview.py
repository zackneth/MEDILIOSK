import uuid

from fastapi import APIRouter, HTTPException

from pydantic import BaseModel

from app.models.schemas import AnswerIn, InterviewState, NextTurn, SessionStart
from app.services.assistant import answer_interrupt
from app.services.interview_engine import get_engine
from app.services.localize import localize_question
from app.services.session_store import sessions


class AssistantIn(BaseModel):
    text: str

router = APIRouter(prefix="/interview", tags=["interview"])


def _finalize_turn(turn: NextTurn, record: dict) -> NextTurn:
    lang = record.get("lang", "en")
    if turn.question is not None:
        turn.question = localize_question(turn.question, lang)
    if record["state"].get("current_question"):
        record["state"]["current_question"] = turn.question.model_dump()
    return turn


@router.post("/start", response_model=NextTurn)
def start_interview(payload: SessionStart):
    if not payload.consent.history_capture:
        raise HTTPException(status_code=403, detail="History capture consent is required")
    session_id = uuid.uuid4().hex[:12]
    engine = get_engine(payload.mode)
    turn = engine.start(session_id, payload.mode)
    sessions[session_id] = {
        "identity": payload.identity.model_dump(),
        "consent": payload.consent.model_dump(),
        "lang": payload.consent.language or "en",
        "mode": payload.mode,
        "state": turn.state.model_dump(),
        "documents": [],
    }
    return _finalize_turn(turn, sessions[session_id])


@router.post("/{session_id}/answer", response_model=NextTurn)
def submit_answer(session_id: str, payload: AnswerIn):
    record = sessions.get(session_id)
    if not record:
        raise HTTPException(status_code=404, detail="Session not found")

    state = InterviewState(**record["state"])
    answer_text = payload.text or ""
    if payload.option_ids:
        q = state.current_question
        opts = []
        for idx in payload.option_ids:
            try:
                n = int(idx)
                if q and 0 <= n < len(q.mcq_options):
                    opts.append(q.mcq_options[n])
            except ValueError:
                continue
        answer_text = ", ".join(opts) if opts else answer_text
    elif payload.option_id:
        q = state.current_question
        if q and payload.option_id.isdigit() and int(payload.option_id) < len(q.mcq_options):
            answer_text = q.mcq_options[int(payload.option_id)]
    if payload.skipped:
        answer_text = ""

    engine = get_engine(record["mode"])
    turn = engine.submit_answer(state, answer_text, None, lang=record.get("lang", "en"))
    record["state"] = turn.state.model_dump()
    return _finalize_turn(turn, record)


@router.post("/{session_id}/assistant", response_model=NextTurn)
def assistant_query(session_id: str, payload: AssistantIn):
    """Interrupt handler: user asked about the app — LLM decides and answers, interview stays on same question."""
    record = sessions.get(session_id)
    if not record:
        raise HTTPException(status_code=404, detail="Session not found")
    state = InterviewState(**record["state"])
    q = state.current_question
    lang = record.get("lang", "en")
    answer = answer_interrupt(payload.text, q.text if q else None, lang)
    if not answer:
        # Not an assistant query — treat as repeat help
        return NextTurn(
            state=state,
            question=q,
            avatar_speech=q.text if q else "",
            progress_percent=0,
            is_assistant=False,
        )
    # Localized if needed — preserve progress
    total = 7
    prog = min(99, int(len(state.completed_sections) / max(total, 1) * 100))
    if q:
        q_local = localize_question(q, lang)
        record["state"]["current_question"] = q_local.model_dump()
        return NextTurn(
            state=state,
            question=q_local,
            avatar_speech=answer + " — " + q_local.text,
            progress_percent=prog,
            assistant_reply=answer,
            is_assistant=True,
        )
    return NextTurn(state=state, question=q, avatar_speech=answer, assistant_reply=answer, is_assistant=True, progress_percent=prog)


@router.get("/{session_id}/state", response_model=NextTurn)
def get_state(session_id: str):
    record = sessions.get(session_id)
    if not record:
        raise HTTPException(status_code=404, detail="Session not found")
    state = InterviewState(**record["state"])
    return NextTurn(state=state, question=state.current_question)
