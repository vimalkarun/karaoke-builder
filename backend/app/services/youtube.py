"""YouTube import via yt-dlp (plan §Phase 2).

Personal-use only — see docs/PLAN.md §5: keep it strictly personal/household
use, never redistribute downloaded audio, never ship a build that does this
to an app store. The API layer requires an explicit confirmation flag before
this is ever called; see schemas.YoutubeImportRequest.
"""

from __future__ import annotations

from pathlib import Path

import yt_dlp

from ..config import ORIGINALS_DIR


def download_audio(url: str, track_id: str) -> tuple[Path, dict]:
    """Download the best available audio for `url` as an mp3 into
    ORIGINALS_DIR, named after `track_id`. Returns (path, info_dict) where
    info_dict is yt-dlp's extracted metadata (title, uploader, duration).
    """
    outtmpl = str(ORIGINALS_DIR / f"{track_id}.%(ext)s")
    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": outtmpl,
        "postprocessors": [
            {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}
        ],
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)

    final_path = ORIGINALS_DIR / f"{track_id}.mp3"
    if not final_path.exists():
        raise RuntimeError("yt-dlp did not produce the expected output file")
    return final_path, info
