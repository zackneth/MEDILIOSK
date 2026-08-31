from fastapi import APIRouter, HTTPException

from app.models.schemas import ConsentGrant
from app.services.session_store import sessions

router = APIRouter(prefix="/consent", tags=["consent"])


@router.get("/notice")
def consent_notice(language: str = "en"):
    notices = {
        "en": {
            "title": "Your Data, Your Consent",
            "points": [
                "We will record your medical history through this conversation.",
                "We will digitize any medical documents you upload.",
                "The structured history is shared ONLY with the treating physician.",
                "Data is used only for your care - never for anything else.",
                "Temporary session data is deleted immediately after submission.",
                "You may withdraw consent at any time before submission.",
            ],
            "law": "Compliant with Digital Personal Data Protection Act 2023 and ABDM consent framework.",
        },
        "hi": {
            "title": "आपका डेटा, आपकी सहमति",
            "points": [
                "हम इस बातचीत से आपका मेडिकल इतिहास रिकॉर्ड करेंगे।",
                "हम आपके द्वारा अपलोड किए गए मेडिकल दस्तावेज़ों को डिजिटाइज़ करेंगे।",
                "इतिहास केवल इलाज करने वाले डॉक्टर के साथ साझा किया जाएगा।",
                "डेटा केवल आपके इलाज के लिए उपयोग किया जाएगा।",
                "सबमिशन के तुरंत बाद अस्थायी सत्र डेटा हटा दिया जाएगा।",
                "जमा करने से पहले आप कभी भी सहमति वापस ले सकते हैं।",
            ],
            "law": "डिजिटल पर्सनल डेटा प्रोटेक्शन अधिनियम 2023 और ABDM सहमति ढांचे के अनुपालन में।",
        },
    }
    return notices.get(language, notices["en"])


@router.post("/{session_id}/revoke")
def revoke_consent(session_id: str):
    record = sessions.pop(session_id, None)
    if not record:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"revoked": True, "session_cleared": True}
