from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import init_db
from .routers import backup, export, jobs, lyrics, system, tracks, video

app = FastAPI(title="Karaoke Builder", version="0.1.0")

# Local-first tool: the UI may be opened from this machine or from a phone
# on the same Wi-Fi (plan §2), so allow any origin rather than hardcoding one.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tracks.router)
app.include_router(jobs.router)
app.include_router(export.router)
app.include_router(system.router)
app.include_router(lyrics.router)
app.include_router(video.router)
app.include_router(backup.router)


@app.on_event("startup")
def on_startup():
    init_db()


@app.get("/api/health")
def health():
    return {"status": "ok"}
