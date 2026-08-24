"""Plain-DSP audio helpers: probing, key/BPM detection, format conversion,
and the pitch/tempo bake used at export time. None of this needs a model —
see plan §4 "Where AI is actually needed".
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

_PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Krumhansl-Kessler key profiles
_MAJOR_PROFILE = np.array(
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
)
_MINOR_PROFILE = np.array(
    [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
)


def probe(path: Path) -> tuple[float, int]:
    """Return (duration_seconds, sample_rate)."""
    info = sf.info(str(path))
    return info.duration, info.samplerate


def detect_key_and_bpm(path: Path) -> tuple[str, float]:
    y, sr = librosa.load(str(path), mono=True, duration=90.0)

    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    bpm = float(np.atleast_1d(tempo)[0])

    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    profile = chroma.mean(axis=1)

    best_score, best_key = -np.inf, "C major"
    for shift in range(12):
        major_score = np.corrcoef(np.roll(_MAJOR_PROFILE, shift), profile)[0, 1]
        minor_score = np.corrcoef(np.roll(_MINOR_PROFILE, shift), profile)[0, 1]
        if major_score > best_score:
            best_score, best_key = major_score, f"{_PITCH_CLASSES[shift]} major"
        if minor_score > best_score:
            best_score, best_key = minor_score, f"{_PITCH_CLASSES[shift]} minor"

    return best_key, round(bpm, 1)


def run_ffmpeg(args: list[str], cwd: Path | None = None) -> None:
    result = subprocess.run(
        ["ffmpeg", "-y", *args],
        capture_output=True,
        text=True,
        cwd=str(cwd) if cwd else None,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {result.stderr[-2000:]}")


def _ffprobe_sample_rate(path: Path) -> int:
    result = subprocess.run(
        [
            "ffprobe", "-v", "quiet", "-select_streams", "a:0",
            "-show_entries", "stream=sample_rate", "-of", "csv=p=0", str(path),
        ],
        capture_output=True,
        text=True,
    )
    return int(result.stdout.strip())


def _split_atempo(ratio: float) -> list[str]:
    """ffmpeg's atempo filter only accepts 0.5-2.0 per instance; chain
    multiple to cover a wider range."""
    if ratio <= 0:
        raise ValueError(f"Invalid tempo ratio: {ratio}")
    filters = []
    remaining = ratio
    while remaining > 2.0:
        filters.append("atempo=2.0")
        remaining /= 2.0
    while remaining < 0.5:
        filters.append("atempo=0.5")
        remaining /= 0.5
    if abs(remaining - 1.0) > 1e-6:
        filters.append(f"atempo={remaining:.6f}")
    return filters


def bake_pitch_tempo(src: Path, dst_wav: Path, pitch_semitones: float, tempo_percent: float) -> None:
    """Render `src` to `dst_wav` with pitch/tempo changes applied.

    Tries, in order:
    1. The Rubber Band CLI (`rubberband` on PATH) — best quality, pitch and
       tempo fully decoupled. See plan §3.
    2. ffmpeg's `rubberband` filter, present only in ffmpeg builds compiled
       with `--enable-librubberband`.
    3. A pure-ffmpeg fallback (`asetrate` for pitch + chained `atempo` to
       correct the resulting speed change back to the requested tempo) —
       lower quality but needs nothing beyond ffmpeg itself.
    """
    if pitch_semitones == 0.0 and tempo_percent == 100.0:
        run_ffmpeg(["-i", str(src), str(dst_wav)])
        return

    tempo_ratio = tempo_percent / 100.0

    if shutil.which("rubberband"):
        tmp_wav = dst_wav.with_name(dst_wav.stem + "_src.wav")
        run_ffmpeg(["-i", str(src), str(tmp_wav)])
        time_ratio = 1.0 / tempo_ratio  # rubberband --time: target duration multiplier
        result = subprocess.run(
            ["rubberband", "-p", str(pitch_semitones), "-t", f"{time_ratio:.6f}", str(tmp_wav), str(dst_wav)],
            capture_output=True,
            text=True,
        )
        tmp_wav.unlink(missing_ok=True)
        if result.returncode == 0:
            return

    try:
        filter_str = f"rubberband=pitch={2 ** (pitch_semitones / 12):.6f}:tempo={tempo_ratio:.6f}"
        run_ffmpeg(["-i", str(src), "-af", filter_str, str(dst_wav)])
        return
    except RuntimeError:
        pass

    sample_rate = _ffprobe_sample_rate(src)
    pitch_ratio = 2 ** (pitch_semitones / 12)
    resampled_rate = round(sample_rate * pitch_ratio)
    tempo_correction = tempo_ratio / pitch_ratio  # undo the speed change asetrate introduces
    filter_chain = f"asetrate={resampled_rate},aresample={sample_rate}"
    atempo_filters = _split_atempo(tempo_correction)
    if atempo_filters:
        filter_chain += "," + ",".join(atempo_filters)
    run_ffmpeg(["-i", str(src), "-af", filter_chain, str(dst_wav)])


def convert(src_wav: Path, dst: Path, fmt: str, bitrate_kbps: int) -> None:
    if fmt == "wav":
        run_ffmpeg(["-i", str(src_wav), str(dst)])
    elif fmt == "mp3":
        run_ffmpeg(["-i", str(src_wav), "-b:a", f"{bitrate_kbps}k", str(dst)])
    elif fmt == "m4a":
        run_ffmpeg(["-i", str(src_wav), "-c:a", "aac", "-b:a", f"{bitrate_kbps}k", str(dst)])
    elif fmt == "flac":
        run_ffmpeg(["-i", str(src_wav), str(dst)])
    else:
        raise ValueError(f"Unsupported export format: {fmt}")


def apply_trim_fade(
    src: Path,
    dst: Path,
    trim_start: float = 0.0,
    trim_end: float | None = None,
    fade_in: float = 0.0,
    fade_out: float = 0.0,
) -> None:
    """Trim to [trim_start, trim_end] (trim_end=None means to the end) and
    apply fade-in/out, in seconds. No-op (copy) if nothing was requested."""
    if trim_start <= 0.0 and trim_end is None and fade_in <= 0.0 and fade_out <= 0.0:
        shutil.copy2(src, dst)
        return

    total_duration, _ = probe(src)
    end = trim_end if trim_end is not None else total_duration
    clip_duration = max(0.0, end - trim_start)

    filters = []
    if trim_start > 0.0 or trim_end is not None:
        filters.append(f"atrim=start={trim_start}:end={end}")
        filters.append("asetpts=PTS-STARTPTS")
    if fade_in > 0.0:
        filters.append(f"afade=t=in:st=0:d={fade_in}")
    if fade_out > 0.0:
        fade_out_start = max(0.0, clip_duration - fade_out)
        filters.append(f"afade=t=out:st={fade_out_start}:d={fade_out}")

    run_ffmpeg(["-i", str(src), "-af", ",".join(filters), str(dst)])
