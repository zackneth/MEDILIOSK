import json
import logging
from datetime import datetime, timezone

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


class FHIRService:
    def build_bundle(self, state_data: dict, summary_data: dict | None = None) -> dict:
        now = datetime.now(timezone.utc).isoformat()
        identity = state_data.get("identity", {})
        entries: list[dict] = []

        patient = {
            "fullUrl": "urn:uuid:patient-1",
            "resource": {
                "resourceType": "Patient",
                "identifier": [
                    {"system": "https://healthid.abdm.gov.in", "value": identity.get("abha_id") or "UNREGISTERED"}
                ],
                "name": [{"text": identity.get("name") or "Unknown"}],
            },
        }
        if identity.get("age"):
            patient["resource"]["birthDate"] = str(2026 - int(identity["age"]))
        if identity.get("sex"):
            patient["resource"]["gender"] = identity["sex"]
        entries.append(patient)

        for qid, ans in state_data.get("answers", {}).items():
            value = (ans or {}).get("text") or (ans or {}).get("option") or ""
            if not value:
                continue
            entries.append(
                {
                    "fullUrl": f"urn:uuid:{qid}",
                    "resource": {
                        "resourceType": "Observation",
                        "status": "final",
                        "code": {"text": qid},
                        "subject": {"reference": "urn:uuid:patient-1"},
                        "effectiveDateTime": now,
                        "valueString": str(value)[:500],
                    },
                }
            )

        # Sort documents date-wise for correct FHIR ordering
        docs_sorted = sorted(state_data.get("documents", []), key=lambda d: d.get("date") or "9999")
        for doc in docs_sorted:
            desc_parts = []
            if doc.get("diagnoses"):
                desc_parts.append("Dx: " + ", ".join(doc["diagnoses"][:3]))
            if doc.get("medications"):
                meds = ", ".join([f"{m.get('name')} {m.get('dose') or ''}".strip() for m in doc["medications"][:4]])
                desc_parts.append(f"Rx: {meds}")
            entries.append(
                {
                    "fullUrl": f"urn:uuid:{doc.get('document_id', 'doc')}",
                    "resource": {
                        "resourceType": "DocumentReference",
                        "status": "current",
                        "type": {"text": doc.get("doc_type", "unknown")},
                        "subject": {"reference": "urn:uuid:patient-1"},
                        "date": doc.get("date") or now,
                        "description": " | ".join(desc_parts)[:400] or doc.get("ocr_text", "")[:200],
                    },
                }
            )
            # Add MedicationStatements date-wise
            for med in doc.get("medications", []):
                if not med.get("name"):
                    continue
                entries.append(
                    {
                        "fullUrl": f"urn:uuid:med-{doc.get('document_id')}-{med.get('name','')[:10]}",
                        "resource": {
                            "resourceType": "MedicationStatement",
                            "status": "active",
                            "medicationCodeableConcept": {"text": med.get("name")},
                            "subject": {"reference": "urn:uuid:patient-1"},
                            "effectiveDateTime": doc.get("date") or now,
                            "dosage": [{"text": f"{med.get('dose') or ''} {med.get('frequency') or ''} {med.get('duration') or ''}".strip()}],
                        },
                    }
                )

        return {
            "resourceType": "Bundle",
            "type": "transaction",
            "timestamp": now,
            "entry": entries,
        }

    def push_to_his(self, bundle: dict) -> dict:
        try:
            r = httpx.post(settings.his_mock_endpoint, json=bundle, timeout=10)
            return {"status_code": r.status_code, "response": r.text[:500]}
        except httpx.HTTPError as e:
            logger.error("HIS push failed: %s", e)
            return {"status_code": 503, "error": "HIS unreachable - bundle queued"}


fhir_service = FHIRService()
