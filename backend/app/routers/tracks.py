import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .. import models, schemas
from ..config import ALLOWED_UPLOAD_EXTENSIONS, ORIGINALS_DIR, STEM_ATTR_MAP
from ..db import get_db
from ..services import audio, separation, youtube
from ..services.job_queue import job_queue

router = APIRouter(prefix="/api/tracks", tags=["tracks"])


@router.post("/upload", response_model=schemas.TrackOut)
async def upload_track(file: UploadFile, db: Session = Depends(get_db)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(400, f"Unsupported file type: {ext or 'unknown'}")

    track = models.Track(
        title=Path(file.filename).stem,
        original_filename=file.filename,
        original_path="",
    )
    db.add(track)
    db.flush()  # assigns track.id

    dest = ORIGINALS_DIR / f"{track.id}{ext}"
    with dest.open("wb") as out:
        shutil.copyfileobj(file.file, out)
    track.original_path = str(dest)

    try:
        duration, sample_rate = audio.probe(dest)
        track.duration_sec = duration
        track.sample_rate = sample_rate
    except Exception:
        pass  # library entry still usable; playback will surface a real error if the file is bad

    db.commit()
    db.refresh(track)
    return track


@router.get("", response_model=list[schemas.TrackOut])
def list_tracks(db: Session = Depends(get_db)):
    return db.query(models.Track).order_by(models.Track.created_at.desc()).all()


@router.get("/{track_id}", response_model=schemas.TrackOut)
def get_track(track_id: str, db: Session = Depends(get_db)):
    track = db.get(models.Track, track_id)
    if not track:
        raise HTTPException(404, "Track not found")
    return track


@router.patch("/{track_id}", response_model=schemas.TrackOut)
def update_track(track_id: str, body: schemas.TrackSettingsUpdate, db: Session = Depends(get_db)):
    track = db.get(models.Track, track_id)
    if not track:
        raise HTTPException(404, "Track not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(track, field, value)
    db.commit()
    db.refresh(track)
    return track


@router.delete("/{track_id}", status_code=204)
def delete_track(track_id: str, db: Session = Depends(get_db)):
    track = db.get(models.Track, track_id)
    if not track:
        raise HTTPException(404, "Track not found")
    for attr in STEM_ATTR_MAP.values():
        path = getattr(track, attr)
        if path:
            Path(path).unlink(missing_ok=True)
    db.delete(track)
    db.commit()


@router.get("/{track_id}/stream/{stem}")
def stream_track(track_id: str, stem: str, db: Session = Depends(get_db)):
    if stem not in STEM_ATTR_MAP:
        raise HTTPException(400, f"Unknown stem '{stem}'")
    track = db.get(models.Track, track_id)
    if not track:
        raise HTTPException(404, "Track not found")
    path = getattr(track, STEM_ATTR_MAP[stem])
    if not path or not Path(path).exists():
        raise HTTPException(404, f"Stem '{stem}' not available for this track yet")
    return FileResponse(path)


@router.post("/{track_id}/separate", response_model=schemas.JobOut)
def separate_track(track_id: str, body: schemas.SeparateRequest = schemas.SeparateRequest(), db: Session = Depends(get_db)):
    track = db.get(models.Track, track_id)
    if not track:
        raise HTTPException(404, "Track not found")

    job = models.Job(track_id=track.id, type=models.JobType.SEPARATE)
    track.status = models.TrackStatus.SEPARATING
    db.add(job)
    db.commit()
    db.refresh(job)

    job_id = job.id
    src_path = Path(track.original_path)
    stem_count = body.stem_count
    quality = body.quality

    def run():
        from ..db import SessionLocal

        session = SessionLocal()
        try:
            job_row = session.get(models.Job, job_id)
            track_row = session.get(models.Track, track_id)
            job_row.status = models.JobStatus.RUNNING
            session.commit()

            outputs = separation.separate(track_id, src_path, stem_count=stem_count, quality=quality)

            try:
                key, bpm = audio.detect_key_and_bpm(src_path)
                track_row.musical_key = key
                track_row.bpm = bpm
            except Exception:
                pass

            for stem_name in ("vocals", "instrumental", "drums", "bass", "other", "piano", "guitar"):
                path = outputs.get(stem_name)
                setattr(track_row, STEM_ATTR_MAP[stem_name], str(path) if path else None)
            track_row.stem_count = stem_count
            track_row.separation_quality = quality
            track_row.status = models.TrackStatus.SEPARATED
            job_row.status = models.JobStatus.DONE
            job_row.progress = 100.0
            session.commit()
        except Exception as exc:
            job_row = session.get(models.Job, job_id)
            track_row = session.get(models.Track, track_id)
            job_row.status = models.JobStatus.ERROR
            job_row.error_message = str(exc)
            track_row.status = models.TrackStatus.ERROR
            session.commit()
        finally:
            session.close()

    job_queue.submit(job_id, run)
    return job


@router.post("/import-youtube", response_model=schemas.JobOut)
def import_youtube(body: schemas.YoutubeImportRequest, db: Session = Depends(get_db)):
    if not body.confirmed_personal_use:
        raise HTTPException(
            400,
            "YouTube import requires confirming personal use — see docs/PLAN.md §5. "
            "Never redistribute downloaded audio.",
        )

    track = models.Track(
        title="Importing from YouTube…",
        original_filename="",
        original_path="",
        source="youtube",
        source_url=body.url,
        status=models.TrackStatus.IMPORTING,
    )
    db.add(track)
    db.flush()

    job = models.Job(track_id=track.id, type=models.JobType.IMPORT)
    db.add(job)
    db.commit()
    db.refresh(job)

    job_id = job.id
    track_id = track.id
    url = body.url

    def run():
        from ..db import SessionLocal

        session = SessionLocal()
        try:
            job_row = session.get(models.Job, job_id)
            track_row = session.get(models.Track, track_id)
            job_row.status = models.JobStatus.RUNNING
            session.commit()

            path, info = youtube.download_audio(url, track_id)

            track_row.title = info.get("title") or track_row.title
            track_row.artist = info.get("uploader")
            track_row.original_filename = f"{track_row.title}.mp3"
            track_row.original_path = str(path)

            try:
                duration, sample_rate = audio.probe(path)
                track_row.duration_sec = duration
                track_row.sample_rate = sample_rate
            except Exception:
                pass

            track_row.status = models.TrackStatus.UPLOADED
            job_row.status = models.JobStatus.DONE
            job_row.progress = 100.0
            session.commit()
        except Exception as exc:
            job_row = session.get(models.Job, job_id)
            track_row = session.get(models.Track, track_id)
            job_row.status = models.JobStatus.ERROR
            job_row.error_message = str(exc)
            track_row.status = models.TrackStatus.ERROR
            session.commit()
        finally:
            session.close()

    job_queue.submit(job_id, run)
    return job
