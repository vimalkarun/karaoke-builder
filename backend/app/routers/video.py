from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..config import EXPORTS_DIR, STEM_ATTR_MAP
from ..db import get_db
from ..services import audio, video
from ..services.job_queue import job_queue

router = APIRouter(prefix="/api/tracks", tags=["video"])


@router.post("/{track_id}/burn-video", response_model=schemas.JobOut)
def burn_video_track(track_id: str, body: schemas.BurnVideoRequest, db: Session = Depends(get_db)):
    track = db.get(models.Track, track_id)
    if not track:
        raise HTTPException(404, "Track not found")

    src_path = getattr(track, STEM_ATTR_MAP[body.stem])
    if not src_path or not Path(src_path).exists():
        raise HTTPException(400, f"Stem '{body.stem}' is not available for this track yet")

    job = models.Job(track_id=track.id, type=models.JobType.BURN_VIDEO)
    db.add(job)
    db.commit()
    db.refresh(job)

    job_id = job.id
    src = Path(src_path)
    lyrics_lrc = track.lyrics_lrc

    def run():
        from ..db import SessionLocal

        session = SessionLocal()
        job_row = session.get(models.Job, job_id)
        # Cleaned up in `finally` regardless of outcome — a failed ffmpeg
        # step used to leave these behind indefinitely (see e.g. the
        # subtitles-filter path-escaping bug this pipeline hit once).
        intermediates: list[Path] = []
        try:
            job_row.status = models.JobStatus.RUNNING
            session.commit()

            baked = EXPORTS_DIR / f"_bake_{job_id}.wav"
            intermediates.append(baked)
            audio.bake_pitch_tempo(src, baked, body.pitch_semitones, body.tempo_percent)

            trimmed = baked
            if body.trim_start > 0 or body.trim_end is not None or body.fade_in > 0 or body.fade_out > 0:
                trimmed = EXPORTS_DIR / f"_trim_{job_id}.wav"
                intermediates.append(trimmed)
                audio.apply_trim_fade(baked, trimmed, body.trim_start, body.trim_end, body.fade_in, body.fade_out)

            srt_path = None
            if lyrics_lrc:
                duration, _ = audio.probe(trimmed)
                srt_text = video.lrc_to_srt(lyrics_lrc, duration)
                if srt_text:
                    srt_path = EXPORTS_DIR / f"_lyrics_{job_id}.srt"
                    srt_path.write_text(srt_text, encoding="utf-8")
                    intermediates.append(srt_path)

            final_path = EXPORTS_DIR / f"{job_id}.mp4"
            video.burn_video(trimmed, srt_path, final_path)

            job_row.status = models.JobStatus.DONE
            job_row.progress = 100.0
            job_row.result_path = str(final_path)
            session.commit()
        except Exception as exc:
            job_row.status = models.JobStatus.ERROR
            job_row.error_message = str(exc)
            session.commit()
        finally:
            for path in intermediates:
                path.unlink(missing_ok=True)
            session.close()

    job_queue.submit(job_id, run)
    return job
