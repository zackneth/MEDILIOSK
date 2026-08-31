import logging
import re

import httpx

from app.services.llm import llm_service

logger = logging.getLogger(__name__)

COMMON_INTERACTIONS = [
    ("warfarin", "aspirin", "Increased bleeding risk"),
    ("warfarin", "ibuprofen", "Increased bleeding risk (NSAID + anticoagulant)"),
    ("warfarin", "diclofenac", "Increased bleeding risk (NSAID + anticoagulant)"),
    ("warfarin", "clopidogrel", "Major bleeding risk (dual antithrombotics)"),
    ("aspirin", "clopidogrel", "Bleeding risk (dual antiplatelet therapy - flag for review)"),
    ("clopidogrel", "omeprazole", "Omeprazole may reduce clopidogrel effectiveness"),
    ("metformin", "iodinated contrast", "Hold metformin before contrast imaging - lactic acidosis risk"),
    ("glipizide", "fluconazole", "Fluconazole can cause hypoglycaemia with sulfonylureas"),
    ("lisinopril", "spironolactone", "Risk of hyperkalaemia (ACE inhibitor + potassium-sparing diuretic)"),
    ("enalapril", "spironolactone", "Risk of hyperkalaemia"),
    ("ramipril", "spironolactone", "Risk of hyperkalaemia"),
    ("amlodipine", "simvastatin", "Simvastatin dose limit with amlodipine - myopathy risk"),
    ("digoxin", "amiodarone", "Amiodarone raises digoxin levels - toxicity risk"),
    ("ciprofloxacin", "theophylline", "Ciprofloxacin raises theophylline levels"),
    ("tramadol", "sertraline", "Serotonin syndrome risk (opioid + SSRI)"),
]


def _norm(name: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", (name or "").lower()).strip()


def check_interactions(documents: list[dict]) -> dict:
    meds_by_doc: list[tuple[str, str, str]] = []
    for doc in documents:
        doc_id = doc.get("document_id", "?")
        date = doc.get("date") or ""
        for m in doc.get("medications", []) or []:
            name = m.get("name") or ""
            if name.strip():
                meds_by_doc.append((doc_id, _norm(name), f"{name} {m.get('dose') or ''}".strip()))

    alerts: list[dict] = []

    seen_pairs = set()
    for i in range(len(meds_by_doc)):
        for j in range(i + 1, len(meds_by_doc)):
            a_doc, a_norm, a_disp = meds_by_doc[i]
            b_doc, b_norm, b_disp = meds_by_doc[j]
            if a_norm == b_norm:
                continue
            for x, y, reason in COMMON_INTERACTIONS:
                pair_key = (x, y)
                if pair_key in seen_pairs:
                    continue
                if (x in a_norm and y in b_norm) or (y in a_norm and x in b_norm):
                    seen_pairs.add(pair_key)
                    alerts.append({
                        "severity": "high",
                        "type": "interaction",
                        "drugs": sorted([a_disp, b_disp]),
                        "reason": reason,
                    })

    dup: dict[str, list[str]] = {}
    for doc_id, norm, disp in meds_by_doc:
        dup.setdefault(norm, []).append(disp)
    for norm, displays in dup.items():
        unique = sorted(set(displays))
        if len(displays) > 1 and len(unique) > 1 or len(unique) > 1:
            continue
        if len(displays) > 1:
            alerts.append({
                "severity": "medium",
                "type": "duplicate",
                "drugs": [displays[0]],
                "reason": f"Same medication appears {len(displays)} times across documents",
            })

    return {"alerts": alerts, "total_medications": len(meds_by_doc)}
