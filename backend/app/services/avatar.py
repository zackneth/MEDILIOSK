import logging

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

BEY_BASE = "https://api.bey.dev"


class BeyondPresenceService:
    def __init__(self) -> None:
        self._headers = {"x-api-key": settings.bey_api_key, "Content-Type": "application/json"}

    def verify_key(self) -> bool:
        try:
            r = httpx.get(f"{BEY_BASE}/v1/auth/verify", headers=self._headers, timeout=10)
            return 200 <= r.status_code < 300
        except httpx.HTTPError as e:
            logger.error("Bey key verification failed: %s", e)
            return False

    def list_avatars(self) -> list[dict]:
        try:
            r = httpx.get(f"{BEY_BASE}/v1/avatars", headers=self._headers, timeout=15)
            r.raise_for_status()
            return r.json() if isinstance(r.json(), list) else r.json().get("items", [])
        except (httpx.HTTPError, ValueError) as e:
            logger.error("Bey list avatars failed: %s", e)
            return []

    def create_session(self, session_id: str) -> dict:
        payload = {
            "agent_id": settings.bey_avatar_id,
            "metadata": {"medikiosk_session": session_id},
        }
        try:
            r = httpx.post(f"{BEY_BASE}/v1/calls", json=payload, headers=self._headers, timeout=20)
            r.raise_for_status()
            return r.json()
        except (httpx.HTTPError, ValueError) as e:
            logger.error("Bey create session failed: %s", e)
            return {"error": str(e), "fallback": "tts_only"}

    def speak(self, session_ref: dict, text: str) -> dict:
        call_id = session_ref.get("id")
        if not call_id:
            return {"fallback": "tts_only"}
        try:
            r = httpx.post(
                f"{BEY_BASE}/v1/calls/{call_id}/speak",
                json={"text": text},
                headers=self._headers,
                timeout=10,
            )
            r.raise_for_status()
            return r.json()
        except httpx.HTTPError as e:
            logger.error("Bey speak failed: %s", e)
            return {"fallback": "tts_only"}


avatar_service = BeyondPresenceService()
