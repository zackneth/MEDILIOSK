import json
import logging
import re

import httpx

from app.services.llm import llm_service

logger = logging.getLogger(__name__)

STRUCTURE_SYSTEM = """You are a clinical scribe. You receive a raw spoken interview transcript between an AI doctor avatar (Dr. Sahayak) and a patient. Convert it into a structured clinical history. Use ONLY information present in the transcript - never invent findings.

Respond ONLY with JSON:
{"chief_complaint": "", "hpi": "", "past_medical_surgical": "", "drug_allergy": "", "family_history": "", "personal_history": "", "ros": "", "prior_investigations": "", "red_flags": ["descriptions of any emergency symptoms mentioned"]}

Each section 1-4 sentences max. If a section was never discussed, leave empty string."""


def fetch_latest_transcript(api_key: str, agent_id: str) -> dict:
    headers = {"x-api-key": api_key}
    base = "https://api.bey.dev"
    r = httpx.get(f"{base}/v1/calls", headers=headers, params={"agent_id": agent_id, "limit": 10}, timeout=30)
    r.raise_for_status()
    calls = r.json().get("data", [])
    if not calls:
        return {"error": "No video calls found for this agent yet"}
    latest = calls[0]
    call_id = latest["id"]
    r2 = httpx.get(f"{base}/v1/calls/{call_id}/messages", headers=headers, timeout=30)
    r2.raise_for_status()
    raw = r2.json()
    msgs = raw.get("data", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
    lines = []
    last = None
    for m in msgs:
        role = "Doctor" if m.get("sender") in ("ai", "agent", "assistant") else "Patient"
        text = (m.get("message") or m.get("content") or m.get("text") or "").strip()
        if not text:
            continue
        if text.strip('"') == last:
            continue
        last = text.strip('"')
        lines.append(f"{role}: {last}")
    if not lines:
        return {"error": "Call found but no messages recorded yet"}
    return {"call_id": call_id, "transcript": "\n".join(lines), "message_count": len(lines)}


def structure_transcript(transcript: str) -> dict:
    try:
        data = llm_service.extract_json(
            f"TRANSCRIPT:\n{transcript}\n\nStructure this into the JSON format.",
            system=STRUCTURE_SYSTEM,
        )
        return data
    except Exception as e:
        logger.error("structure_transcript failed: %s", e)
        return {}
