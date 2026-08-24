from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..db import get_db

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.get("/{job_id}", response_model=schemas.JobOut)
def get_job(job_id: str, db: Session = Depends(get_db)):
    job = db.get(models.Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job


@router.get("/by-track/{track_id}", response_model=list[schemas.JobOut])
def list_jobs_for_track(track_id: str, db: Session = Depends(get_db)):
    return (
        db.query(models.Job)
        .filter(models.Job.track_id == track_id)
        .order_by(models.Job.created_at.desc())
        .all()
    )
