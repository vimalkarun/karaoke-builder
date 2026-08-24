import zipfile
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .. import models, schemas
from ..config import EXPORTS_DIR, STEM_ATTR_MAP, STEM_NAMES_FOR_COUNT
from ..db import get_db
from ..services import audio
from ..services.job_queue import job_queue

router = APIRouter(prefix="/api", tags=["export"])


def _render_stem(src: Path, work_id: str, body: schemas.ExportRequest) -> Path:
    """Bake pitch/tempo, apply trim/fade, and convert to the target format.
    Returns the final rendered file. Intermediates are always cleaned up;
    the final file is cleaned up too if conversion itself fails, so a
    failed render never leaves debris in storage/exports.
    `work_id` must be unique per call (job_id, or job_id + stem name)."""
    baked = EXPORTS_DIR / f"_bake_{work_id}.wav"
    trimmed = baked
    final_path = EXPORTS_DIR / f"_final_{work_id}.{body.format}"
    try:
        audio.bake_pitch_tempo(src, baked, body.pitch_semitones, body.tempo_percent)

        if body.trim_start > 0 or body.trim_end is not None or body.fade_in > 0 or body.fade_out > 0:
            trimmed = EXPORTS_DIR / f"_trim_{work_id}.wav"
            audio.apply_trim_fade(baked, trimmed, body.trim_start, body.trim_end, body.fade_in, body.fade_out)

        audio.convert(trimmed, final_path, body.format, body.bitrate_kbps)
    except Exception:
        final_path.unlink(missing_ok=True)
        raise
    finally:
        baked.unlink(missing_ok=True)
        if trimmed != baked:
            trimmed.unlink(missing_ok=True)
    return final_path


@router.post("/tracks/{track_id}/export", response_model=schemas.JobOut)
def export_track(track_id: str, body: schemas.ExportRequest, db: Session = Depends(get_db)):
    track = db.get(models.Track, track_id)
    if not track:
        raise HTTPException(404, "Track not found")

    if body.all_stems:
        if track.status != models.TrackStatus.SEPARATED:
            raise HTTPException(400, "Track hasn't been separated into stems yet")
    else:
        src_path = getattr(track, STEM_ATTR_MAP[body.stem])
        if not src_path or not Path(src_path).exists():
            raise HTTPException(400, f"Stem '{body.stem}' is not available for this track yet")

    job = models.Job(track_id=track.id, type=models.JobType.EXPORT)
    db.add(job)
    db.commit()
    db.refresh(job)

    job_id = job.id
    stem_count = track.stem_count
    single_src = None if body.all_stems else Path(getattr(track, STEM_ATTR_MAP[body.stem]))

    def run():
        from ..db import SessionLocal

        session = SessionLocal()
        job_row = session.get(models.Job, job_id)
        try:
            job_row.status = models.JobStatus.RUNNING
            session.commit()

            if body.all_stems:
                track_row = session.get(models.Track, track_id)
                zip_path = EXPORTS_DIR / f"{job_id}.zip"
                try:
                    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                        for stem_name in STEM_NAMES_FOR_COUNT[stem_count]:
                            stem_src = Path(getattr(track_row, STEM_ATTR_MAP[stem_name]))
                            rendered = _render_stem(stem_src, f"{job_id}_{stem_name}", body)
                            zf.write(rendered, arcname=f"{stem_name}.{body.format}")
                            rendered.unlink(missing_ok=True)
                except Exception:
                    zip_path.unlink(missing_ok=True)
                    raise
                final_path = zip_path
            else:
                final_path = _render_stem(single_src, job_id, body)

            job_row.status = models.JobStatus.DONE
            job_row.progress = 100.0
            job_row.result_path = str(final_path)
            session.commit()
        except Exception as exc:
            job_row.status = models.JobStatus.ERROR
            job_row.error_message = str(exc)
            session.commit()
        finally:
            session.close()

    job_queue.submit(job_id, run)
    return job


@router.get("/exports/{job_id}/download")
def download_export(job_id: str, db: Session = Depends(get_db)):
    job = db.get(models.Job, job_id)
    if not job or job.type not in (models.JobType.EXPORT, models.JobType.BURN_VIDEO):
        raise HTTPException(404, "Export job not found")
    if job.status != models.JobStatus.DONE or not job.result_path:
        raise HTTPException(409, f"Export not ready (status: {job.status.value})")
    track = db.get(models.Track, job.track_id)
    filename = f"{track.title}.{Path(job.result_path).suffix.lstrip('.')}"
    return FileResponse(job.result_path, filename=filename)
