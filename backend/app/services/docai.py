import base64
import io
import json
import logging
import re

import httpx
import pymupdf
from PIL import Image

from app.models.schemas import DocumentExtraction, LabValue
from app.services.llm import llm_service

logger = logging.getLogger(__name__)

EXTRACTION_SCHEMA = """{
  "doc_type": "prescription | lab_report | discharge_summary | unknown",
  "patient_name": "string or null",
  "date": "YYYY-MM-DD or null",
  "diagnoses": ["string"],
  "medications": [{"name": "", "dose": "", "frequency": "", "duration": ""}],
  "lab_values": [{"test": "", "value": "", "unit": "", "reference_range": ""}],
  "procedures": ["string"],
  "confidence_issues": ["list of fields you were unsure about"],
  "raw_text": "full verbatim transcription of all visible text in the document, line by line"
}"""

SYSTEM = (
    "You are Llama OCR — a specialist medical document extraction engine with expert handwriting recognition. "
    "Read the document image carefully even if handwriting is cursive, messy, or faint. "
    "Especially for doctor prescriptions: extract EVERY medicine name, dosage (e.g. 500mg, 10mg), "
    "frequency (e.g. 1-0-1, BD, TDS, OD, HS, twice daily, thrice daily), and duration (e.g. 5 days, 1 month). "
    "Expand shorthand: BD=twice daily, TDS=thrice daily, OD=once daily, HS=at bedtime. "
    "Never invent values. If a field is unreadable, leave it null and list it under confidence_issues. "
    "Also provide raw_text with verbatim transcription. Output only valid JSON."
)


class DocumentAIService:
    def extract(self, file_bytes: bytes, filename: str) -> DocumentExtraction:
        lower = (filename or "").lower()
        if lower.endswith(".pdf"):
            page_images = self._pdf_to_pngs(file_bytes)
            if not page_images:
                return DocumentExtraction(document_id=self._mkid(filename), confidence_issues=["PDF could not be read"])
        else:
            page_images = [file_bytes]

        merged = DocumentExtraction(document_id=self._mkid(filename))
        ocr_lines: list[str] = []

        for idx, pg_bytes in enumerate(page_images):
            try:
                img = Image.open(io.BytesIO(pg_bytes))
                if img.mode not in ("RGB", "L"):
                    img = img.convert("RGB")
            except Exception as e:
                logger.error("Page %s unreadable: %s", idx + 1, e)
                continue
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            b64 = base64.b64encode(buf.getvalue()).decode()

            prompt = f"Extract all clinical information from this medical document image (page {idx + 1}, filename: {filename}). Pay special attention to handwritten prescriptions - read every medicine and dosage."
            # Llama OCR primary (Groq - Llama 4 Maverick vision) -> Gemini fallback -> Qwen fallback
            data = self._llama_extract(b64, prompt)
            if not self._has_content(data):
                gemini_data = self._gemini_extract(b64, prompt)
                if self._has_content(gemini_data):
                    data = gemini_data
                else:
                    groq_data = self._groq_vision_extract(b64, prompt)
                    if self._has_content(groq_data):
                        data = groq_data
                    elif gemini_data:
                        data = gemini_data

            if idx == 0:
                merged.doc_type = data.get("doc_type", "unknown")
                merged.patient_name = data.get("patient_name")
                merged.date = data.get("date")
            else:
                if not merged.date and data.get("date"):
                    merged.date = data.get("date")
            for k in ("diagnoses", "procedures"):
                for item in data.get(k, []) or []:
                    if item and item not in getattr(merged, k):
                        getattr(merged, k).append(item)
            for m in data.get("medications", []) or []:
                try:
                    from app.models.schemas import Medication
                    if isinstance(m, dict):
                        merged.medications.append(Medication(**{k: m.get(k) for k in ("name","dose","frequency","duration")}))
                    else:
                        merged.medications.append(m)
                except Exception:
                    merged.medications.append(m)
            for lv in data.get("lab_values", []) or []:
                lab = LabValue(**{k: lv.get(k) for k in ("test", "value", "unit", "reference_range")})
                lab.abnormal = self._is_abnormal(lab)
                merged.lab_values.append(lab)
            for c in data.get("confidence_issues", []) or []:
                if c not in merged.confidence_issues:
                    merged.confidence_issues.append(c)

            # Prefer raw_text from Llama OCR if available (verbatim transcription)
            if data.get("raw_text"):
                ocr_lines.append(f"[Page {idx + 1} · {data.get('doc_type','unknown')} · {data.get('date') or 'undated'}]\n" + data.get("raw_text","").strip())
            else:
                ocr_lines.append(self._page_text(data, idx + 1))

        merged.ocr_text = "\n\n".join([l for l in ocr_lines if l]).strip()
        return merged

    def ai_narrative(self, doc: DocumentExtraction) -> str:
        try:
            # handle both Medication objects and dicts
            meds = []
            for m in doc.medications:
                if hasattr(m, "model_dump"):
                    meds.append(m.model_dump())
                elif isinstance(m, dict):
                    meds.append(m)
                else:
                    meds.append({"name": str(m)})
            structured = {
                "doc_type": doc.doc_type, "date": doc.date, "diagnoses": doc.diagnoses,
                "medications": meds,
                "lab_values": [{"t": l.test, "v": l.value, "abnormal": l.abnormal} for l in doc.lab_values],
                "procedures": doc.procedures,
            }
            prompt = (
                "Write a concise clinical note (3-5 sentences) summarizing this digitized medical document. "
                "Mention key diagnoses, medications and any abnormal findings. Plain text only.\n\n"
                f"DATA: {json.dumps(structured)}"
            )
            note = llm_service.generate(prompt, temperature=0.2)
            return re.sub(r"\s+", " ", note).strip()[:600]
        except Exception as e:
            logger.warning("ai_narrative failed: %s", e)
            return ""

    def _pdf_to_pngs(self, pdf_bytes: bytes) -> list[bytes]:
        try:
            doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
            pngs = []
            for page in list(doc)[:3]:
                pix = page.get_pixmap(dpi=150)
                pngs.append(pix.tobytes("png"))
            return pngs
        except Exception as e:
            logger.error("PDF render failed: %s", e)
            return []

    def _page_text(self, data: dict, page_no: int) -> str:
        lines = [f"[OCR · Page {page_no}] type={data.get('doc_type', 'unknown')} date={data.get('date') or 'n/a'}"]
        for dx in data.get("diagnoses", []) or []:
            lines.append(f"Diagnosis: {dx}")
        for m in data.get("medications", []) or []:
            parts = [str(m.get(k) or "") for k in ("name", "dose", "frequency", "duration")]
            lines.append("Medication: " + " | ".join([p for p in parts if p]))
        for lv in data.get("lab_values", []) or []:
            mark = " [ABNORMAL]" if self._is_abnormal(LabValue(**{k: lv.get(k) for k in ("test", "value", "unit", "reference_range")})) else ""
            lines.append(f"Lab: {lv.get('test')} = {lv.get('value')} {lv.get('unit') or ''} (ref {lv.get('reference_range') or 'n/a'}){mark}")
        return "\n".join(lines[1:]) and "\n".join(lines)

    def _mkid(self, filename: str) -> str:
        return re.sub(r"[^a-zA-Z0-9_-]", "_", filename)[:60]

    def _has_content(self, d: dict) -> bool:
        return bool(d and any([d.get("diagnoses"), d.get("medications"), d.get("lab_values"), d.get("procedures")]))

    def _is_abnormal(self, lab: LabValue) -> bool:
        if not lab.value or not lab.reference_range:
            return False
        m_val = re.search(r"-?\d+(?:\.\d+)?", str(lab.value))
        ranges = re.findall(r"(\d+(?:\.\d+)?)\s*[-–to]+\s*(\d+(?:\.\d+)?)", str(lab.reference_range))
        if not m_val:
            return False
        val = float(m_val.group())
        if ranges:
            lo, hi = float(ranges[0][0]), float(ranges[0][1])
            return val < lo or val > hi
        m_lt = re.search(r"<\s*(\d+(?:\.\d+)?)", str(lab.reference_range))
        if m_lt and val >= float(m_lt.group(1)):
            return True
        m_gt = re.search(r">\s*(\d+(?:\.\d+)?)", str(lab.reference_range))
        if m_gt and val <= float(m_gt.group(1)):
            return True
        return False

    def _llama_extract(self, b64: str, prompt: str) -> dict:
        """Primary Llama OCR via Groq - Llama 4 Maverick vision (handwriting specialist). Falls back to Qwen if not available."""
        try:
            from app.core.config import settings
            if not settings.groq_api_key:
                return {}
            # Try Llama 4 models first, then Qwen as Llama-equivalent
            for model in ["meta-llama/llama-4-maverick-17b-128e-instruct", "meta-llama/llama-4-scout-17b-16e-instruct", "qwen/qwen3.6-27b"]:
                try:
                    r = httpx.post(
                        "https://api.groq.com/openai/v1/chat/completions",
                        headers={"Authorization": f"Bearer {settings.groq_api_key}"},
                        json={
                            "model": model,
                            "messages": [
                                {"role": "system", "content": SYSTEM},
                                {
                                    "role": "user",
                                    "content": [
                                        {"type": "text", "text": prompt + "\n\nRespond ONLY with valid JSON matching this shape:\n" + EXTRACTION_SCHEMA},
                                        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                                    ],
                                },
                            ],
                            "temperature": 0.1,
                            "max_tokens": 4096,
                        },
                        timeout=30,
                    )
                    if r.status_code != 200:
                        # 404 means model not available for this key - skip Llama, will fallback to Qwen/Gemini
                        if r.status_code == 404 and "llama" in model:
                            logger.info("Llama model %s not available for this Groq key, skipping", model)
                            continue
                        logger.warning("Llama OCR %s failed: %s %s", model, r.status_code, r.text[:150])
                        continue
                    content = r.json()["choices"][0]["message"]["content"] or ""
                    content = re.sub(r"<think>.*?</think>", "", content, flags=re.S)
                    content = content.replace("```json", "").replace("```", "")
                    start = content.find("{")
                    end = content.rfind("}")
                    if start == -1 or end == -1:
                        continue
                    parsed = json.loads(content[start : end + 1])
                    if self._has_content(parsed) or parsed.get("raw_text"):
                        logger.info("Llama OCR succeeded with %s", model)
                        return parsed
                except Exception as e:
                    logger.warning("Llama OCR %s error: %s", model, str(e)[:120])
                    continue
            return {}
        except Exception as e:
            logger.error("Llama OCR outer error: %s", e)
            return {}

    def _gemini_extract(self, b64: str, prompt: str) -> dict:
        try:
            response = llm_service.client.models.generate_content(
                model="gemini-2.0-flash",
                contents=[
                    prompt,
                    {"inline_data": {"mime_type": "image/png", "data": b64}},
                ],
                config={
                    "system_instruction": SYSTEM,
                    "response_mime_type": "application/json",
                    "temperature": 0.1,
                },
            )
            raw = response.text or "{}"
            return json.loads(raw)
        except Exception as e:
            logger.warning("Gemini extraction failed (%s) - trying Groq vision", str(e)[:100])
            return {}

    def _groq_vision_extract(self, b64: str, prompt: str) -> dict:
        try:
            from app.core.config import settings

            r = httpx.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.groq_api_key}"},
                json={
                    "model": "qwen/qwen3.6-27b",
                    "messages": [
                        {"role": "system", "content": SYSTEM},
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": prompt + "\n\nRespond ONLY with valid JSON matching this shape:\n" + EXTRACTION_SCHEMA},
                                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                            ],
                        },
                    ],
                    "temperature": 0.1,
                    "max_tokens": 4096,
                },
                timeout=120,
            )
            if r.status_code != 200:
                logger.warning("Groq vision failed: %s %s", r.status_code, r.text[:120])
                return {}
            content = r.json()["choices"][0]["message"]["content"] or ""
            content = re.sub(r"<think>.*?</think>", "", content, flags=re.S)
            content = content.replace("```json", "").replace("```", "")
            start = content.find("{")
            end = content.rfind("}")
            if start == -1 or end == -1:
                return {}
            return json.loads(content[start : end + 1])
        except Exception as e:
            logger.error("Groq vision error: %s", e)
            return {}


docai_service = DocumentAIService()
