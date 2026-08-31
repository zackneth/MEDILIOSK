import re, httpx, json, time, sys
sys.stdout.reconfigure(encoding='utf-8')

env_text = open(r"C:\Users\NETHAN\Projects\MediKiosk\backend\.env", encoding="utf-8").read()
m = re.search(r'BEY_API_KEY="?([^"\r\n]+)"?', env_text)
bey = m.group(1).strip().strip('"')
headers = {"x-api-key": bey, "Content-Type": "application/json"}
base = "https://api.bey.dev"

LANGS = {
    "en": ("English", "Hello! I am Dr. Sahayak, your digital health assistant. What is the main problem you are experiencing today?"),
    "hi": ("Hindi", "नमस्ते! मैं डॉ. सहायक हूँ। आज आपको मुख्य समस्या क्या है?"),
    "ta": ("Tamil", "வணக்கம்! நான் டாக்டர் சகாயக். இன்று உங்கள் முக்கிய பிரச்சனை என்ன?"),
    "te": ("Telugu", "నమస్కారం! నేను డాక్టర్ సహాయక్. ఈరోజు మీ ప్రధాన సమస్య ఏమిటి?"),
    "kn": ("Kannada", "ನಮಸ್ಕಾರ! ನಾನು ಡಾ. ಸಹಾಯಕ್. ಇಂದು ನಿಮ್ಮ ಮುಖ್ಯ ಸಮಸ್ಯೆ ಏನು?"),
    "ml": ("Malayalam", "നമസ്കാരം! ഞാൻ ഡോ. സഹായക് ആണ്. ഇന്ന് നിങ്ങളുടെ പ്രധാന പ്രശ്നം എന്താണ്?"),
    "mr": ("Marathi", "नमस्कार! मी डॉ. सहाय्यक आहे. आज तुमची मुख्य समस्या काय आहे?"),
    "bn": ("Bengali", "নমস্কার! আমি ডা. সহায়ক। আজ আপনার প্রধান সমস্যা কী?"),
    "gu": ("Gujarati", "નમસ્તે! હું ડૉ. સહાયક છું. આજે તમારી મુખ્ય સમસ્યા શું છે?"),
    "pa": ("Punjabi", "ਸਤ ਸ੍ਰੀ ਅਕਾਲ! ਮੈਂ ਡਾ. ਸਹਾਇਕ ਹਾਂ। ਅੱਜ ਤੁਹਾਡੀ ਮੁੱਖ ਸਮੱਸਿਆ ਕੀ ਹੈ?"),
    "or": ("Odia", "ନମସ୍କାର! ମୁଁ ଡା. ସହାୟକ। ଆଜି ଆପଣଙ୍କର ମୁଖ୍ୟ ସମସ୍ୟା କଣ?"),
    "as": ("Assamese", "নমস্কাৰ! মই ডাঃ সহায়ক। আজি আপোনাৰ মূল সমস্যা কি?"),
}

AVATAR_ID = "f30d7eef-6e71-433f-938d-cecdd8c0b653"

def get_existing():
    r = httpx.get(f"{base}/v1/agents", headers=headers, params={"limit": 50}, timeout=30)
    r.raise_for_status()
    return r.json().get("data", [])

existing = get_existing()
by_name = {a.get("name"): a for a in existing}
print(f"Found {len(existing)} existing agents")

created = {}
for code, (lang_name, greeting) in LANGS.items():
    name = f"MediKiosk Doctor - {code.upper()} - {lang_name}"
    # also check old HD naming
    if name in by_name:
        aid = by_name[name]["id"]
        print(f"REUSE {code} {name}: {aid}")
        created[code] = aid
        continue
    # check if generic HD exists for en/hi reuse mapping
    if code == "en" and "MediKiosk Doctor HD" in by_name:
        # keep but also ensure en mapping
        aid = by_name["MediKiosk Doctor HD"]["id"]
        print(f"REUSE EN HD {aid} for en")
        created[code] = aid
        continue

    system_prompt = f"""You are "Dr. Sahayak", a calm, empathetic AI medical intake assistant at a hospital OPD kiosk in India. You are a real-time video avatar - patient sees your face and hears your voice.

CRITICAL LANGUAGE RULE: You MUST respond ONLY in {lang_name} ({code}). Even if the patient speaks English or another language, translate your reply to {lang_name}. Never reply in English unless {lang_name} is English.

Your job: conduct structured clinical history in {lang_name}:
1. Chief complaint + SOCRATES if chest pain
2. History of present illness
3. Past medical history (diabetes, BP, heart, asthma, thyroid, surgeries)
4. Drug and allergy
5. Family history
6. Personal history
7. Review of systems

RED FLAG: chest pain with radiation/breathlessness/sweating, sudden weakness/slurred speech/facial droop -> say team alerted urgently.

RULES: ONE question at a time in simple spoken {lang_name}, under 35 words, warm, low-literacy friendly. After ALL sections, say in {lang_name}: "Thank you. Your history is recorded. Please press Continue."
"""
    payload = {
        "name": name,
        "avatar_id": AVATAR_ID,
        "system_prompt": system_prompt,
        "greeting": greeting,
        "max_session_length_minutes": 15,
    }
    try:
        r = httpx.post(f"{base}/v1/agents", headers=headers, json=payload, timeout=30)
        if r.status_code in (200, 201):
            aid = r.json().get("id") or r.json().get("data",{}).get("id")
            print(f"CREATED {code} {name}: {aid}")
            created[code] = aid
        else:
            print(f"FAILED {code} {r.status_code} {r.text[:300]}")
    except Exception as e:
        print(f"ERR {code} {e}")
    time.sleep(0.6)

print("\n=== AGENT_IDS ===")
for k,v in created.items():
    print(f'{k}: {v}')

# write to file for frontend
out_path = r"C:\Users\NETHAN\Projects\MediKiosk\frontend\.env"
# preserve existing
try:
    existing_env = open(out_path, encoding="utf-8").read()
except:
    existing_env = ""
# update or append per-lang vars
lines = existing_env.splitlines()
# build map
for code, aid in created.items():
    key = f"VITE_BEY_AGENT_ID_{code.upper()}"
    found=False
    for i,l in enumerate(lines):
        if l.startswith(key+"="):
            lines[i]=f"{key}={aid}"
            found=True
            break
    if not found:
        lines.append(f"{key}={aid}")
    # also ensure base IDs
    if code=="en":
        # update base allopathic
        for i,l in enumerate(lines):
            if l.startswith("VITE_BEY_AGENT_ID=") and not l.startswith("VITE_BEY_AGENT_ID_"):
                lines[i]=f"VITE_BEY_AGENT_ID={aid}"
                break
open(out_path, "w", encoding="utf-8").write("\n".join(lines)+"\n")
print(f"Wrote {out_path}")
