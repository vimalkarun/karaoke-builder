from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from .models import JobStatus, JobType, TrackStatus

StemName = Literal["original", "vocals", "instrumental", "drums", "bass", "other", "piano", "guitar"]
ExportFormat = Literal["mp3", "wav", "m4a", "flac"]
StemCount = Literal[2, 4, 6]
SeparationQuality = Literal["fast", "high"]


class TrackOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    artist: str | None
    original_filename: str
    duration_sec: float | None
    bpm: float | None
    musical_key: str | None
    status: TrackStatus
    vocals_path: str | None
    instrumental_path: str | None
    drums_path: str | None
    bass_path: str | None
    other_path: str | None
    piano_path: str | None
    guitar_path: str | None
    stem_count: int
    separation_quality: str
    source: str
    source_url: str | None
    lyrics_text: str | None
    lyrics_lrc: str | None
    lyrics_source: str | None
    preferred_pitch_semitones: float
    preferred_tempo_percent: float
    created_at: datetime


class TrackSettingsUpdate(BaseModel):
    preferred_pitch_semitones: float | None = None
    preferred_tempo_percent: float | None = None
    title: str | None = None
    artist: str | None = None


class JobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    track_id: str
    type: JobType
    status: JobStatus
    progress: float
    error_message: str | None
    result_path: str | None
    updated_at: datetime


class SeparateRequest(BaseModel):
    stem_count: StemCount = 2
    quality: SeparationQuality = "fast"


class YoutubeImportRequest(BaseModel):
    url: str
    # Personal-use disclaimer gate (plan §5): the frontend must have the user
    # explicitly confirm before this is ever sent.
    confirmed_personal_use: bool = False


class ExportRequest(BaseModel):
    stem: StemName = "instrumental"
    # When set, `stem` is ignored and every individual stem for the track's
    # stem_count is baked/converted and bundled into one ZIP instead.
    all_stems: bool = False
    format: ExportFormat = "mp3"
    bitrate_kbps: int = 192
    pitch_semitones: float = 0.0
    tempo_percent: float = 100.0
    trim_start: float = 0.0
    trim_end: float | None = None
    fade_in: float = 0.0
    fade_out: float = 0.0


class SystemInfo(BaseModel):
    gpu_available: bool


class LyricsUpdate(BaseModel):
    lyrics_text: str | None = None
    lyrics_lrc: str | None = None
    lyrics_source: str | None = None


class BurnVideoRequest(BaseModel):
    stem: StemName = "instrumental"
    pitch_semitones: float = 0.0
    tempo_percent: float = 100.0
    trim_start: float = 0.0
    trim_end: float | None = None
    fade_in: float = 0.0
    fade_out: float = 0.0
