""""Burn to video" export (plan §Phase 4): backing track + synced lyrics on a
plain background, muxed into an MP4 for playback on a TV/projector.

Built entirely on ffmpeg (already a hard dependency) — no new native
dependency. Subtitle burning uses ffmpeg's `subtitles` filter, which needs
libass; the gyan.dev full builds already used in this project have it
(`--enable-libass`), same as `--enable-librubberband` for pitch/tempo.
"""

from __future__ import annotations

import os
from pathlib import Path

from .audio import probe, run_ffmpeg
from .lyrics import parse_lrc


def _format_srt_timestamp(seconds: float) -> str:
    seconds = max(0.0, seconds)
    hours, remainder = divmod(seconds, 3600)
    minutes, remainder = divmod(remainder, 60)
    secs = int(remainder)
    millis = round((remainder - secs) * 1000)
    return f"{int(hours):02d}:{int(minutes):02d}:{secs:02d},{millis:03d}"


def lrc_to_srt(lrc_text: str, total_duration: float) -> str:
    """LRC only marks line *starts*; each line's end is the next line's
    start (or the track's end for the last line)."""
    lines = parse_lrc(lrc_text)
    if not lines:
        return ""

    entries = []
    for i, line in enumerate(lines):
        start = line["time"]
        end = lines[i + 1]["time"] if i + 1 < len(lines) else total_duration
        end = max(end, start + 0.5)
        entries.append((start, end, line["text"]))

    blocks = [
        f"{idx}\n{_format_srt_timestamp(start)} --> {_format_srt_timestamp(end)}\n{text}\n"
        for idx, (start, end, text) in enumerate(entries, start=1)
    ]
    return "\n".join(blocks)


def burn_video(
    audio_path: Path,
    srt_path: Path | None,
    output_path: Path,
    resolution: str = "1280x720",
    background_color: str = "0x14161b",
) -> None:
    """Render `audio_path` (+ optional `srt_path` lyrics) onto a plain
    color background as an MP4, sized to the audio's duration.

    ffmpeg's `subtitles` filter parses its argument as colon-separated
    key=value pairs, which collides head-on with a Windows drive-letter
    colon (`C:\\...`). Backslash-escaping the colon looks right but doesn't
    survive the filter's own value-unescaping pass — it still mis-parses
    into a bogus `original_size` option. Rather than fight that escaping,
    every path here is made relative to a shared working directory (all
    three files already live under storage/exports/), so no path ever
    contains a colon or backslash in the first place.
    """
    duration, _ = probe(audio_path)
    cwd = output_path.parent

    cmd = [
        "-f", "lavfi", "-i", f"color=c={background_color}:s={resolution}:d={duration:.3f}",
        "-i", os.path.relpath(audio_path, cwd),
    ]
    if srt_path is not None:
        style = "FontName=Arial,FontSize=28,PrimaryColour=&H00FFFFFF,BorderStyle=1,Outline=2,Alignment=2,MarginV=60"
        srt_rel = os.path.relpath(srt_path, cwd).replace("\\", "/")
        cmd += ["-vf", f"subtitles={srt_rel}:force_style='{style}'"]
    cmd += [
        "-c:v", "libx264", "-tune", "stillimage", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        "-shortest",
        output_path.name,
    ]
    run_ffmpeg(cmd, cwd=cwd)
