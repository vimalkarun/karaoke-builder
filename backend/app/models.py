import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(timezone.utc)


class TrackStatus(str, enum.Enum):
    IMPORTING = "importing"
    UPLOADED = "uploaded"
    SEPARATING = "separating"
    SEPARATED = "separated"
    ERROR = "error"


class JobStatus(str, enum.Enum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    ERROR = "error"


class JobType(str, enum.Enum):
    IMPORT = "import"
    SEPARATE = "separate"
    EXPORT = "export"
    TRANSCRIBE = "transcribe"
    BURN_VIDEO = "burn_video"
    ALIGN = "align"


class Track(Base):
    __tablename__ = "tracks"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    title: Mapped[str] = mapped_column(String)
    artist: Mapped[str | None] = mapped_column(String, nullable=True)

    original_filename: Mapped[str] = mapped_column(String)
    original_path: Mapped[str] = mapped_column(String)

    duration_sec: Mapped[float | None] = mapped_column(Float, nullable=True)
    sample_rate: Mapped[int | None] = mapped_column(Float, nullable=True)
    bpm: Mapped[float | None] = mapped_column(Float, nullable=True)
    musical_key: Mapped[str | None] = mapped_column(String, nullable=True)

    status: Mapped[TrackStatus] = mapped_column(
        Enum(TrackStatus), default=TrackStatus.UPLOADED
    )
    vocals_path: Mapped[str | None] = mapped_column(String, nullable=True)
    instrumental_path: Mapped[str | None] = mapped_column(String, nullable=True)
    # Populated for 4/6-stem separations only (§Phase 2); instrumental_path
    # above always holds the "everything but vocals" quick-playback bounce
    # regardless of stem_count, so 2-stem tracks work unchanged.
    drums_path: Mapped[str | None] = mapped_column(String, nullable=True)
    bass_path: Mapped[str | None] = mapped_column(String, nullable=True)
    other_path: Mapped[str | None] = mapped_column(String, nullable=True)
    piano_path: Mapped[str | None] = mapped_column(String, nullable=True)
    guitar_path: Mapped[str | None] = mapped_column(String, nullable=True)
    stem_count: Mapped[int] = mapped_column(default=2)
    separation_quality: Mapped[str] = mapped_column(String, default="fast")

    source: Mapped[str] = mapped_column(String, default="upload")  # "upload" | "youtube"
    source_url: Mapped[str | None] = mapped_column(String, nullable=True)

    # Lyrics (§Phase 3). lyrics_text is the plain, untimed lines a user pastes
    # (or that a transcription draft produces); lyrics_lrc is the timed
    # source of truth once synced — manually via tap-to-sync (first-class,
    # not a fallback — see plan §1/§4) or as a low-confidence ASR draft.
    lyrics_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    lyrics_lrc: Mapped[str | None] = mapped_column(Text, nullable=True)
    lyrics_source: Mapped[str | None] = mapped_column(String, nullable=True)  # "manual" | "whisper-draft"

    # Re-usable per-song settings (§1 "Added: library & workflow")
    preferred_pitch_semitones: Mapped[float] = mapped_column(Float, default=0.0)
    preferred_tempo_percent: Mapped[float] = mapped_column(Float, default=100.0)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    jobs: Mapped[list["Job"]] = relationship(back_populates="track", cascade="all, delete-orphan")


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    track_id: Mapped[str] = mapped_column(ForeignKey("tracks.id"))
    type: Mapped[JobType] = mapped_column(Enum(JobType))
    status: Mapped[JobStatus] = mapped_column(Enum(JobStatus), default=JobStatus.QUEUED)
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    error_message: Mapped[str | None] = mapped_column(String, nullable=True)
    result_path: Mapped[str | None] = mapped_column(String, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    track: Mapped["Track"] = relationship(back_populates="jobs")
