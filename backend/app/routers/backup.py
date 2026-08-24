"""Backup/restore for the whole library (plan §Phase 5 "self-hosted, no
cloud" reach item — reinterpreted from "multi-device sync" since the
existing client-server architecture already gives every device on the LAN
shared access to one library; what's actually missing is protection
against losing that one copy, and a way to move it to a new machine).

A backup bundles track metadata (titles, lyrics/LRC, per-track pitch/tempo
defaults) and original audio into a ZIP. Stems are excluded by default —
they're the bulk of storage size and fully regenerable by re-running
Separate — but can be included for a zero-regeneration restore. Exports are
never included; they're throwaway renders.
"""

from __future__ import annotations

import json
import shutil
import tempfile
import zipfile
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask

from .. import models
from ..config import ORIGINALS_DIR, STEM_ATTR_MAP, STEMS_DIR
from ..db import get_db

router = APIRouter(prefix="/api/backup", tags=["backup"])

_MANIFEST_FIELDS = [
    "title",
    "artist",
    "original_filename",
    "duration_sec",
    "sample_rate",
    "bpm",
    "musical_key",
    "source",
    "source_url",
    "lyrics_text",
    "lyrics_lrc",
    "lyrics_source",
    "preferred_pitch_semitones",
    "preferred_tempo_percent",
]


@router.get("")
def create_backup(include_stems: bool = False, db: Session = Depends(get_db)):
    tracks = db.query(models.Track).all()
    manifest: list[dict] = []

    tmp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    tmp_path = Path(tmp.name)
    tmp.close()

    try:
        with zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for track in tracks:
                entry = {field: getattr(track, field) for field in _MANIFEST_FIELDS}
                entry["stem_count"] = track.stem_count
                entry["separation_quality"] = track.separation_quality
                entry["original_archive_path"] = None
                entry["stem_archive_paths"] = {}

                if track.original_path and Path(track.original_path).exists():
                    src = Path(track.original_path)
                    arcname = f"originals/{track.id}{src.suffix}"
                    zf.write(src, arcname=arcname)
                    entry["original_archive_path"] = arcname

                if include_stems:
                    for stem_name, attr in STEM_ATTR_MAP.items():
                        if stem_name == "original":
                            continue
                        path = getattr(track, attr)
                        if path and Path(path).exists():
                            src = Path(path)
                            arcname = f"stems/{track.id}/{stem_name}{src.suffix}"
                            zf.write(src, arcname=arcname)
                            entry["stem_archive_paths"][stem_name] = arcname

                manifest.append(entry)

            zf.writestr("manifest.json", json.dumps({"version": 1, "tracks": manifest}, indent=2))
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise

    return FileResponse(
        tmp_path,
        filename="karaoke-builder-backup.zip",
        media_type="application/zip",
        background=BackgroundTask(lambda: tmp_path.unlink(missing_ok=True)),
    )


@router.post("/restore")
def restore_backup(file: UploadFile, db: Session = Depends(get_db)):
    work_dir = Path(tempfile.mkdtemp(prefix="kb_restore_"))
    try:
        zip_path = work_dir / "upload.zip"
        with zip_path.open("wb") as out:
            shutil.copyfileobj(file.file, out)

        try:
            with zipfile.ZipFile(zip_path) as zf:
                zf.extractall(work_dir)
        except zipfile.BadZipFile:
            raise HTTPException(400, "Not a valid ZIP file")

        manifest_path = work_dir / "manifest.json"
        if not manifest_path.exists():
            raise HTTPException(400, "Not a Karaoke Builder backup (missing manifest.json)")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

        restored = 0
        skipped = 0
        for entry in manifest.get("tracks", []):
            # Restoring the same backup twice (or onto a machine that
            # already has some of these tracks) shouldn't create duplicates.
            existing = (
                db.query(models.Track)
                .filter(
                    models.Track.title == entry.get("title"),
                    models.Track.original_filename == entry.get("original_filename"),
                    models.Track.duration_sec == entry.get("duration_sec"),
                )
                .first()
            )
            if existing:
                skipped += 1
                continue

            track = models.Track(
                title=entry.get("title") or "Restored track",
                artist=entry.get("artist"),
                original_filename=entry.get("original_filename") or "",
                original_path="",
                duration_sec=entry.get("duration_sec"),
                sample_rate=entry.get("sample_rate"),
                bpm=entry.get("bpm"),
                musical_key=entry.get("musical_key"),
                source=entry.get("source") or "upload",
                source_url=entry.get("source_url"),
                lyrics_text=entry.get("lyrics_text"),
                lyrics_lrc=entry.get("lyrics_lrc"),
                lyrics_source=entry.get("lyrics_source"),
                preferred_pitch_semitones=entry.get("preferred_pitch_semitones") or 0.0,
                preferred_tempo_percent=entry.get("preferred_tempo_percent") or 100.0,
                status=models.TrackStatus.UPLOADED,
            )
            db.add(track)
            db.flush()  # assigns track.id

            archive_original = entry.get("original_archive_path")
            if archive_original:
                src = work_dir / archive_original
                if src.exists():
                    dest = ORIGINALS_DIR / f"{track.id}{src.suffix}"
                    shutil.copy2(src, dest)
                    track.original_path = str(dest)

            stem_paths = entry.get("stem_archive_paths") or {}
            if stem_paths:
                final_dir = STEMS_DIR / track.id
                final_dir.mkdir(parents=True, exist_ok=True)
                for stem_name, archive_rel in stem_paths.items():
                    src = work_dir / archive_rel
                    if not src.exists():
                        continue
                    dest = final_dir / src.name
                    shutil.copy2(src, dest)
                    setattr(track, STEM_ATTR_MAP[stem_name], str(dest))
                if track.vocals_path or track.instrumental_path:
                    track.status = models.TrackStatus.SEPARATED
                    track.stem_count = entry.get("stem_count") or 2
                    track.separation_quality = entry.get("separation_quality") or "fast"

            restored += 1

        db.commit()
        return {"restored": restored, "skipped": skipped}
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
