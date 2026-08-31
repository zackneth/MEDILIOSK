import json
import logging

from app.models.schemas import PhysicianSummary, SummaryRequest
from app.services.llm import llm_service

logger = logging.getLogger(__name__)

SUMMARY_SYSTEM = (
    "You are a clinical scribe. Convert the structured interview data into a concise, "
    "physician-ready history summary. Use only the provided data - never invent clinical "
    "findings. This is a DRAFT for physician review, not a diagnosis."
)

SECTIONS = [
    "chief_complaint",
    "hpi",
    "past_medical_surgical",
    "drug_allergy",
    "family_history",
    "personal_history",
    "ros",
]


class SummaryService:
    def generate(self, request: SummaryRequest, state_data: dict) -> PhysicianSummary:
        answers = state_data.get("answers", {})
        extracted = state_data.get("extracted", {})
        docs = state_data.get("documents", [])
        flags = state_data.get("red_flags", [])

        ai_doc_notes = " ".join([d.get("ai_summary", "") for d in docs if d.get("ai_summary")])

        prompt = (
            "Interview answers (question_id -> answer):\n"
            f"{json.dumps(answers, indent=1, default=str)}\n\n"
            "Documents extracted:\n"
            f"{json.dumps(docs, indent=1, default=str)[:4000]}\n\n"
            "Fill each section briefly (2-5 sentences max per section). Sections: "
            + ", ".join(SECTIONS)
            + '. Respond as JSON: {"chief_complaint": "", "hpi": "", "past_medical_surgical": "", '
            '"drug_allergy": "", "family_history": "", "personal_history": "", "ros": "", '
            '"prior_investigations": ""}'
        )

        data = {}
        try:
            data = llm_service.extract_json(prompt, system=SUMMARY_SYSTEM)
        except Exception as e:
            logger.error("Summary generation failed: %s", e)

        fallback = self._fallback_sections(state_data)
        summary = PhysicianSummary(
            chief_complaint=data.get("chief_complaint") or fallback.get("chief_complaint", ""),
            hpi=data.get("hpi") or fallback.get("hpi", ""),
            past_medical_surgical=data.get("past_medical_surgical") or fallback.get("past_medical_surgical", ""),
            drug_allergy=data.get("drug_allergy") or fallback.get("drug_allergy", ""),
            family_history=data.get("family_history") or fallback.get("family_history", ""),
            personal_history=data.get("personal_history") or fallback.get("personal_history", ""),
            ros=data.get("ros") or fallback.get("ros", ""),
            prior_investigations=data.get("prior_investigations") or self._prior_investigations(docs),
            documents_timeline=[],
            red_flags=[],
        )
        return summary

    def _fallback_sections(self, state_data: dict) -> dict[str, str]:
        """Deterministic Q&A digest per section, used when the LLM returns nothing."""
        answers = state_data.get("answers", {})
        if not answers:
            return {}
        mode = state_data.get("mode", "allopathic")
        try:
            from app.services.interview_engine import get_engine
            engine = get_engine(mode)
        except Exception:
            return {}
        qmeta: dict[str, tuple[str, str]] = {}
        for section in engine.ontology.sections:
            for node in engine.ontology.entry_questions(section) + engine.ontology.followup_nodes(section):
                qmeta[node.id] = (node.text, section["id"])

        section_map = {
            "hpi_socrates": "hpi",
            "chief_complaint_ayush": "hpi",
            "dashavidha": "ros",
            "ahara_vihara": "personal_history",
        }
        buckets: dict[str, list[str]] = {}
        for qid, ans in answers.items():
            meta = qmeta.get(qid)
            if not meta:
                continue
            text, section_id = meta
            target = section_map.get(section_id, section_id)
            a = ""
            if isinstance(ans, dict):
                opt = ans.get("option")
                a = ans.get("text") or (str(opt) if opt else "")
            elif isinstance(ans, str):
                a = ans
            if not a:
                continue
            buckets.setdefault(target, []).append(f"- {text} {a}")

        return {k: "\n".join(v) for k, v in buckets.items() if v}

    def _prior_investigations(self, docs: list[dict]) -> str:
        if not docs:
            return "No prior records digitized."
        try:
            from app.services.document_report import build_structured_text
            txt = build_structured_text(docs)
            # keep compact for LLM section, truncate if huge
            return txt[:3500] if len(txt) > 3500 else txt
        except Exception:
            parts = []
            for d in sorted(docs, key=lambda x: x.get("date") or "9999"):
                date = d.get("date") or "undated"
                for lv in d.get("lab_values", []) or []:
                    marker = " [ABNORMAL]" if lv.get("abnormal") else ""
                    parts.append(f"{date}: {lv.get('test')} = {lv.get('value')} {lv.get('unit') or ''}{marker}")
                for m in d.get("medications", []) or []:
                    parts.append(f"{date}: Rx {m.get('name')} {m.get('dose') or ''} {m.get('frequency') or ''} {m.get('duration') or ''}".strip())
                for dx in d.get("diagnoses", []) or []:
                    parts.append(f"{date}: documented diagnosis - {dx}")
            return "\n".join(parts) if parts else "No prior records digitized."


summary_service = SummaryService()
