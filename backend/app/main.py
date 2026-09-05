import logging
import os
import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.routers import bey_bridge, consent, documents, interactions, interview, mock_his, sign, stt, summary, voice

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("medikiosk")

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# ---- serve the built React app (single-container deployment) ----
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FRONTEND_DIST = os.path.join(_ROOT, "frontend", "dist")

app = FastAPI(
    title="MediKiosk API",
    description="AI-powered clinical history platform - SIH26047",
    version="0.1.0",
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    t0 = time.time()
    response = await call_next(request)
    logger.info("%s %s -> %s (%.2fs)", request.method, request.url.path, response.status_code, time.time() - t0)
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(interview.router)
app.include_router(documents.router)
app.include_router(interactions.router)
app.include_router(summary.router)
app.include_router(consent.router)
app.include_router(mock_his.router)
app.include_router(bey_bridge.router)
app.include_router(sign.router)
app.include_router(stt.router)
app.include_router(voice.router)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


@app.get("/health")
def health():
    return {"ok": True}


if os.path.isdir(FRONTEND_DIST):
    from fastapi.responses import FileResponse

    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        file_path = os.path.join(FRONTEND_DIST, full_path)
        if full_path and os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))
