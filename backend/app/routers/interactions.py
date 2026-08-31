import json
import logging

from fastapi import APIRouter, HTTPException

from app.services.drugcheck import check_interactions
from app.services.session_store import sessions

router = APIRouter(prefix="/documents", tags=["documents"])

logger = logging.getLogger(__name__)


@router.get("/{session_id}/interactions")
def get_interactions(session_id: str):
    record = sessions.get(session_id)
    if not record:
        raise HTTPException(status_code=404, detail="Session not found")
    return check_interactions(record["documents"])
