import logging
import re
from typing import Any, Optional

import yaml

from app.models.schemas import (
    AskedQuestion,
    ExtractedSlot,
    InterviewState,
    NextTurn,
    RedFlag,
)

logger = logging.getLogger(__name__)


class OntologyNode:
    def __init__(self, raw: dict[str, Any], section_id: str) -> None:
        self.id: str = raw["id"]
        self.section_id = section_id
        self.text: str = raw.get("text", "")
        self.mcq_options: list[str] = raw.get("mcq_options", [])
        self.free_text: bool = raw.get("free_text", not self.mcq_options)
        self.multi_select: bool = raw.get("multi_select", False)
        self.red_flags: list[dict[str, Any]] = raw.get("red_flags", [])
        self.conditional_on_answered: Optional[str] = raw.get("conditional_on_answered")


class Ontology:
    def __init__(self, path: str) -> None:
        with open(path, "r", encoding="utf-8") as f:
            self.raw = yaml.safe_load(f)
        self.sections: list[dict[str, Any]] = self.raw["sections"]

    def section_ids(self) -> list[str]:
        return [s["id"] for s in self.sections]

    def entry_questions(self, section: dict[str, Any]) -> list[OntologyNode]:
        nodes: list[dict[str, Any]] = section.get("entry_questions") or section.get("questions") or []
        return [OntologyNode(n, section["id"]) for n in nodes]

    def followup_nodes(self, section: dict[str, Any]) -> list[OntologyNode]:
        nodes: list[dict[str, Any]] = section.get("followups") or []
        return [OntologyNode(n, section["id"]) for n in nodes]


REPEAT_PATTERNS = re.compile(
    r"(repeat|again|pardon|say again|come again|didn.?t (understand|get|hear)|could you repeat|please repeat|what did you say|sorry.*what|can you repeat|phir se|dobara|samajh nahi|sunai nahi|suna nahi|ek bar phir|dohrao|repeat the question|say it again|repeat that|bol do dobara|phir se bolo|repeat karo)",
    re.I,
)


def _is_repeat_intent(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False
    # allow up to 15 words — natural repeat phrases are often longer: "I didn't understand, can you please repeat the question"
    if REPEAT_PATTERNS.search(t) and len(t.split()) <= 15:
        return True
    if t.lower().strip() in ("repeat", "again", "pardon", "phir se", "dobara"):
        return True
    return False


def _match(answer_text: str, rule: dict[str, Any]) -> bool:
    lowered = (answer_text or "").lower()
    for term in rule.get("match_any", []):
        if term.lower() in lowered:
            return True
    pattern = rule.get("match_regex")
    if pattern and re.search(pattern, lowered):
        return True
    return False


class InterviewEngine:
    def __init__(self, ontology_path: str) -> None:
        self.ontology = Ontology(ontology_path)

    def start(self, session_id: str, mode: str) -> NextTurn:
        state = InterviewState(session_id=session_id, mode=mode)
        first_section = self.ontology.sections[0]
        node = self.ontology.entry_questions(first_section)[0]
        question = self._to_question(node)
        state.current_section = first_section["id"]
        state.current_question = question
        return NextTurn(
            state=state,
            question=question,
            avatar_speech=self._speech_wrap(question),
            progress_percent=0,
        )

    def submit_answer(self, state: InterviewState, answer_text: str, option_id: str | None, lang: str = "en") -> NextTurn:
        q = state.current_question

        # --- REPEAT intent: ALL responses reach LLM decision — heuristic fast path + LLM fallback ---
        if q is not None and answer_text and not option_id:
            if _is_repeat_intent(answer_text):
                return NextTurn(
                    state=state,
                    question=q,
                    avatar_speech=self._speech_wrap(q),
                    progress_percent=min(99, int(len(state.completed_sections) / max(len(self.ontology.section_ids()), 1) * 100)),
                    is_repeat=True,
                )
            # LLM fallback for repeat: only if utterance looks like a question/help, not for every clinical answer
            if len(answer_text.strip().split()) >= 3 and (
                "?" in answer_text or "repeat" in answer_text.lower() or "phir" in answer_text.lower() or "dobara" in answer_text.lower() or "again" in answer_text.lower() or "pardon" in answer_text.lower()
            ):
                try:
                    from app.services.assistant import llm_is_repeat
                    if llm_is_repeat(answer_text, q.text, lang):
                        return NextTurn(
                            state=state,
                            question=q,
                            avatar_speech=self._speech_wrap(q),
                            progress_percent=min(99, int(len(state.completed_sections) / max(len(self.ontology.section_ids()), 1) * 100)),
                            is_repeat=True,
                        )
                except Exception as e:
                    logger.warning("repeat LLM fallback failed: %s", e)

        # --- ASSISTANT interrupt: user asked about the app itself — let LLM answer, stay on same question ---
        t_low = (answer_text or "").lower().strip()
        is_short_help = t_low in ("help", "help me", "help please", "please help", "help me please")
        if q is not None and answer_text and not option_id and (len(answer_text.strip().split()) >= 3 or is_short_help):
            try:
                from app.services.assistant import answer_interrupt

                assistant_answer = answer_interrupt(answer_text, q.text, lang)
                if assistant_answer:
                    return NextTurn(
                        state=state,
                        question=q,
                        avatar_speech=assistant_answer + " — " + self._speech_wrap(q),
                        progress_percent=min(99, int(len(state.completed_sections) / max(len(self.ontology.section_ids()), 1) * 100)),
                        assistant_reply=assistant_answer,
                        is_assistant=True,
                    )
            except Exception as e:
                logger.warning("assistant interrupt check failed: %s", e)

        effective_answer = answer_text or option_id or "(skipped)"
        if q is not None:
            state.answers[q.id] = {"text": answer_text, "option": option_id}
            state.extracted[q.id] = ExtractedSlot(value=effective_answer, confidence="high")
            flags = self._check_red_flags(q.id, effective_answer, state)
            for f in flags:
                if f.code not in {x.code for x in state.red_flags}:
                    state.red_flags.append(f)
            if any(f.severity == "emergency" for f in state.red_flags):
                state.triage_priority = "priority"

        next_node = self._advance(state)
        if next_node is None:
            state.finished = True
            state.current_question = None
            return NextTurn(
                state=state,
                question=None,
                avatar_speech="Thank you. Your medical history has been recorded and sent to the doctor.",
                progress_percent=100,
            )
        question = self._to_question(next_node)
        state.current_question = question
        done_sections = len(state.completed_sections)
        total = len(self.ontology.section_ids())
        progress = min(99, int(done_sections / max(total, 1) * 100))
        latest_flag = state.red_flags[-1] if state.red_flags else None
        alert = latest_flag if (flags or []) else None
        speech = self._speech_wrap(question)
        if alert is not None and alert.severity == "emergency":
            speech = "This may need urgent attention. I have alerted the triage team. " + speech
        return NextTurn(
            state=state,
            question=question,
            avatar_speech=speech,
            red_flag_alert=alert,
            progress_percent=progress,
        )

    def _check_red_flags(self, question_id: str, answer: str, state: InterviewState) -> list[RedFlag]:
        flags: list[RedFlag] = []
        for section in self.ontology.sections:
            all_nodes = self.ontology.entry_questions(section) + self.ontology.followup_nodes(section)
            for node in all_nodes:
                if node.red_flags and (node.id == question_id):
                    for rule in node.red_flags:
                        parent_ok = True
                        if "with_parent_match" in rule:
                            cc = state.extracted.get("cc_primary")
                            parent_ok = cc is not None and cc.value and any(
                                t.lower() in cc.value.lower() for t in rule["with_parent_match"]
                            )
                        if _match(answer, rule) and parent_ok:
                            flags.append(
                                RedFlag(
                                    code=rule.get("code", "RF_UNKNOWN"),
                                    description=rule.get("description", ""),
                                    severity=rule.get("severity", "urgent"),
                                    triggered_by_question=question_id,
                                    triggered_by_answer=answer[:200],
                                )
                            )
        return flags

    def _advance(self, state: InterviewState) -> Optional[OntologyNode]:
        current_idx = self.ontology.section_ids().index(state.current_section)
        current_section = self.ontology.sections[current_idx]
        asked = set(state.answers.keys())

        branch_pool = self._select_branch(current_section, state)
        pool_nodes: list[OntologyNode] = []
        if isinstance(branch_pool, list):
            pool_nodes.extend(branch_pool)

        candidates = (
            [n for n in self.ontology.entry_questions(current_section)]
            + self.ontology.followup_nodes(current_section)
            + pool_nodes
        )
        for node in candidates:
            if node.id in asked:
                continue
            if node.conditional_on_answered and node.conditional_on_answered not in asked:
                continue
            return node

        state.completed_sections.append(current_section["id"])

        for idx in range(current_idx + 1, len(self.ontology.sections)):
            section = self.ontology.sections[idx]
            branch = self._select_branch(section, state)
            if branch == "skip":
                continue
            state.current_section = section["id"]
            entry = self.ontology.entry_questions(section)
            pool = branch if isinstance(branch, list) else entry
            for node in pool:
                if node.id not in asked:
                    return node
            continue
        return None

    def _select_branch(self, section: dict[str, Any], state: InterviewState) -> Any:
        branches = section.get("branches")
        if not branches:
            return None
        cc = state.extracted.get("cc_primary")
        cc_val = (cc.value if cc else "") or ""
        for br in branches:
            when = br.get("when_contains", [])
            if any(w.lower() in cc_val.lower() for w in when):
                return [OntologyNode(n, section["id"]) for n in br.get("questions", [])]
        default = branches[-1].get("default")
        if default:
            return [OntologyNode(n, section["id"]) for n in default.get("questions", [])]
        return "skip"

    def _to_question(self, node: OntologyNode) -> AskedQuestion:
        return AskedQuestion(
            id=node.id,
            section=node.section_id,
            text=node.text,
            mcq_options=node.mcq_options,
            allows_free_text=node.free_text or not node.mcq_options,
            multi_select=node.multi_select,
        )

    def _speech_wrap(self, question: AskedQuestion) -> str:
        return question.text


engine_allopathic = InterviewEngine("app/ontology/clinical_ontology.yaml")
engine_ayush = InterviewEngine("app/ontology/ayush_dashavidha.yaml")


def get_engine(mode: str) -> InterviewEngine:
    return engine_ayush if mode == "ayush" else engine_allopathic
