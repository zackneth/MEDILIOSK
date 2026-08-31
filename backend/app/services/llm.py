import json
import logging

from google import genai
from google.genai import types

from app.core.config import settings

logger = logging.getLogger(__name__)

MODEL = "gemini-2.0-flash"


class LLMService:
    def __init__(self) -> None:
        self._client = None

    @property
    def client(self) -> genai.Client:
        if self._client is None:
            if not settings.gemini_api_key:
                raise RuntimeError("GEMINI_API_KEY is not configured")
            self._client = genai.Client(api_key=settings.gemini_api_key)
        return self._client

    def generate(self, prompt: str, system: str | None = None, json_mode: bool = False, temperature: float = 0.3) -> str:
        try:
            return self._groq_generate(prompt, system, json_mode, temperature)
        except Exception as e:
            logger.warning("Groq failed (%s) - falling back to Gemini", str(e)[:120])

        try:
            config = types.GenerateContentConfig(temperature=temperature)
            if json_mode:
                config.response_mime_type = "application/json"
            contents = [prompt]
            if system:
                config.system_instruction = system
            response = self.client.models.generate_content(model=MODEL, contents=contents, config=config)
            text = response.text or ""
            if text.strip():
                return text
            raise RuntimeError("Gemini returned empty response")
        except Exception as e:
            logger.error("Gemini also failed: %s", str(e)[:120])
            raise

    def _groq_generate(self, prompt: str, system: str | None, json_mode: bool, temperature: float) -> str:
        if not settings.groq_api_key:
            raise RuntimeError("No Groq key configured for LLM fallback")
        import httpx

        msgs = []
        if system:
            msgs.append({"role": "system", "content": system})
        msgs.append({"role": "user", "content": prompt})
        body = {
            "model": "openai/gpt-oss-120b",
            "messages": msgs,
            "temperature": temperature,
        }
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        r = httpx.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {settings.groq_api_key}"},
            json=body,
            timeout=60,
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"] or ""

    def extract_json(self, prompt: str, system: str | None = None, schema_hint: str | None = None) -> dict:
        full = prompt
        if schema_hint:
            full += f"\n\nRespond ONLY with valid JSON matching this shape:\n{schema_hint}"
        raw = self.generate(full, system=system, json_mode=True, temperature=0.1)
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            start = raw.find("{")
            end = raw.rfind("}")
            if start != -1 and end != -1:
                try:
                    return json.loads(raw[start : end + 1])
                except json.JSONDecodeError:
                    pass
            logger.warning("LLM returned unparseable JSON: %s", raw[:200])
            return {}


llm_service = LLMService()
