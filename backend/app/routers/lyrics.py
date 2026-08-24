from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..db import get_db
from ..services import lyrics
from ..services.job_queue import job_queue

router = APIRouter(prefix="/api/tracks", tags=["lyrics"])


@router.patch("/{track_id}/lyrics", response_model=schemas.TrackOut)
def update_lyrics(track_id: str, body: schemas.LyricsUpdate, db: Session = Depends(get_db)):
    track = db.get(models.Track, track_id)
    if not track:
        raise HTTPException(404, "Track not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(track, field, value)
    db.commit()
    db.refresh(track)
    return track


@router.post("/{track_id}/transcribe", response_model=schemas.JobOut)
def transcribe_track(track_id: str, db: Session = Depends(get_db)):
    track = db.get(models.Track, track_id)
    if not track:
        raise HTTPException(404, "Track not found")

    # Prefer the isolated vocal stem when available — much better ASR
    # accuracy than transcribing over the full instrumental mix.
    source_path = track.vocals_path or track.original_path
    if not source_path or not Path(source_path).exists():
        raise HTTPException(400, "No audio available to transcribe yet")

    job = models.Job(track_id=track.id, type=models.JobType.TRANSCRIBE)
    db.add(job)
    db.commit()
    db.refresh(job)

    job_id = job.id
    src = Path(source_path)

    def run():
        from ..db import SessionLocal

        session = SessionLocal()
        try:
            job_row = session.get(models.Job, job_id)
            track_row = session.get(models.Track, track_id)
            job_row.status = models.JobStatus.RUNNING
            session.commit()

            text, lrc = lyrics.transcribe(src)

            track_row.lyrics_text = text
            track_row.lyrics_lrc = lrc
            track_row.lyrics_source = "whisper-draft"
            job_row.status = models.JobStatus.DONE
            job_row.progress = 100.0
            session.commit()
        except Exception as exc:
            job_row = session.get(models.Job, job_id)
            job_row.status = models.JobStatus.ERROR
            job_row.error_message = str(exc)
            session.commit()
        finally:
            session.close()

    job_queue.submit(job_id, run)
    return job


@router.post("/{track_id}/align-lyrics", response_model=schemas.JobOut)
def align_lyrics_track(track_id: str, db: Session = Depends(get_db)):
    track = db.get(models.Track, track_id)
    if not track:
        raise HTTPException(404, "Track not found")
    if not track.lyrics_text:
        raise HTTPException(400, "Paste lyrics text first")
    if not track.vocals_path or not Path(track.vocals_path).exists():
        raise HTTPException(400, "Separate the track into stems first — alignment needs the isolated vocal")

    job = models.Job(track_id=track.id, type=models.JobType.ALIGN)
    db.add(job)
    db.commit()
    db.refresh(job)

    job_id = job.id
    vocals_path = Path(track.vocals_path)
    lyrics_text = track.lyrics_text

    def run():
        from ..db import SessionLocal

        session = SessionLocal()
        try:
            job_row = session.get(models.Job, job_id)
            track_row = session.get(models.Track, track_id)
            job_row.status = models.JobStatus.RUNNING
            session.commit()

            lrc = lyrics.align_to_vocals(vocals_path, lyrics_text)

            track_row.lyrics_lrc = lrc
            track_row.lyrics_source = "auto-aligned"
            job_row.status = models.JobStatus.DONE
            job_row.progress = 100.0
            session.commit()
        except Exception as exc:
            job_row = session.get(models.Job, job_id)
            job_row.status = models.JobStatus.ERROR
            job_row.error_message = str(exc)
            session.commit()
        finally:
            session.close()

    job_queue.submit(job_id, run)
    return job
