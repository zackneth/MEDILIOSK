import logging

from fastapi import APIRouter, Request

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/mock-his", tags=["mock-his"])
stored_bundles: list[dict] = []


@router.post("/fhir")
async def receive_bundle(request: Request):
    bundle = await request.json()
    stored_bundles.append(bundle)
    logger.info("Mock HIS received bundle with %s entries", len(bundle.get("entry", [])))
    return {
        "status": "accepted",
        "bundle_id": f"his-{len(stored_bundles):04d}",
        "entries_received": len(bundle.get("entry", [])),
        "note": "Mock hospital information system - replace with ABDM Gateway in production",
    }


@router.get("/bundles")
def list_bundles():
    return {"count": len(stored_bundles), "bundles": [b.get("timestamp") for b in stored_bundles]}
