"""LRC parsing/building, the faster-whisper ASR fallback, and auto-alignment
of known lyrics to the vocal stem (plan §Phase 3).

Dedicated forced-alignment models (MMS_FA / NeMo, per plan §3) are still not
used — they need model downloads and real native-dependency risk (this
project already hit that twice with rubberband/torchcodec). Instead,
`align_to_vocals` gets a similar practical result from what's already
installed: faster-whisper's word-level timestamps say *when* words are sung,
and a sequence-matching pass maps that timing onto the user's own trusted
lyric lines (their spelling/script wins, ASR's timing is what's borrowed).
It's an approximation, not true forced alignment — accuracy depends on how
well Whisper's transcription of the sung audio lines up with the pasted
text — which is exactly why the result always lands as a draft feeding the
existing tap/type/nudge editor, not a silent final answer.
"""

from __future__ import annotations

import difflib
import re
import time
from pathlib import Path
from typing import Any

_LRC_LINE = re.compile(r"^\[(\d+):(\d+(?:\.\d+)?)\](.*)$")
_WORD_SPLIT = re.compile(r"\s+")
_PUNCTUATION = re.compile(r"[^\w\s]", re.UNICODE)

# "small" (~500MB) can fail to even load on a machine that's otherwise busy —
# reproduced directly against a real 4:40 track: "small" hit
# `mkl_malloc: failed to allocate memory` mid-transcription, while "base"
# (~150MB) completed the same file successfully. Alignment only needs rough
# word timing (the actual lyric text is already known and unused for
# transcription quality), so trading some ASR accuracy for a much smaller
# memory footprint is a clearly good trade here — unlike the no-lyrics
# transcribe fallback, where the recognized text itself is the product.
_MODEL_SIZE = "base"
_CPU_THREADS = 2
_MEMORY_ERROR_MARKERS = ("malloc", "memory", "allocate")


def _is_memory_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(marker in text for marker in _MEMORY_ERROR_MARKERS)


def _run_whisper(audio_path: Path, *, word_timestamps: bool, max_retries: int = 1) -> tuple[list[Any], Any]:
    """Load the model and fully materialize its (lazily-generated) segments,
    retrying on a transient memory-allocation failure — observed in practice
    to succeed on immediate retry once whatever else was using RAM let go of
    some of it. Raises a clear, actionable error if it still can't recover.
    """
    from faster_whisper import WhisperModel

    last_error: Exception | None = None
    for attempt in range(max_retries + 1):
        try:
            model = WhisperModel(_MODEL_SIZE, device="cpu", compute_type="int8", cpu_threads=_CPU_THREADS)
            segments, info = model.transcribe(
                str(audio_path), beam_size=5, vad_filter=True, word_timestamps=word_timestamps
            )
            return list(segments), info  # materialize while the model is still alive
        except RuntimeError as exc:
            if not _is_memory_error(exc):
                raise
            last_error = exc
            if attempt < max_retries:
                time.sleep(5)

    raise RuntimeError(
        "Ran out of memory running the transcription model — this machine is "
        "very low on free RAM right now. Close other applications and try again."
    ) from last_error


def parse_lrc(text: str) -> list[dict]:
    """Parse `[mm:ss.xx]lyric text` lines into [{time, text}], time in seconds."""
    lines = []
    for raw_line in text.splitlines():
        match = _LRC_LINE.match(raw_line.strip())
        if not match:
            continue
        minutes, seconds, lyric = match.groups()
        time = int(minutes) * 60 + float(seconds)
        lines.append({"time": round(time, 2), "text": lyric.strip()})
    lines.sort(key=lambda line: line["time"])
    return lines


def build_lrc(lines: list[dict]) -> str:
    """Inverse of parse_lrc: [{time, text}] -> LRC text."""
    out = []
    for line in sorted(lines, key=lambda l: l["time"]):
        minutes, seconds = divmod(max(0.0, line["time"]), 60)
        out.append(f"[{int(minutes):02d}:{seconds:05.2f}]{line['text']}")
    return "\n".join(out)


def _normalize_word(word: str) -> str:
    return _PUNCTUATION.sub("", word).strip().lower()


def _interpolate(times: list[float | None], total_duration: float) -> list[float]:
    """Fill in lines that found no matching word by spacing them evenly
    between their nearest matched neighbors (or the track's ends)."""
    n = len(times)
    if n == 0:
        return []
    anchored = [(i, t) for i, t in enumerate(times) if t is not None]
    if not anchored:
        return [round(i * total_duration / n, 2) for i in range(n)]

    result: list[float] = list(times)  # type: ignore[assignment]
    first_i, first_t = anchored[0]
    for i in range(first_i):
        result[i] = max(0.0, first_t - (first_i - i) * 2.0)

    for (i1, t1), (i2, t2) in zip(anchored, anchored[1:]):
        span = i2 - i1
        for i in range(i1 + 1, i2):
            result[i] = round(t1 + (t2 - t1) * (i - i1) / span, 2)

    last_i, last_t = anchored[-1]
    for i in range(last_i + 1, n):
        result[i] = min(total_duration, last_t + (i - last_i) * 2.0)

    return result


def align_to_vocals(vocals_path: Path, lyrics_text: str) -> str:
    """Approximate forced alignment: transcribe `vocals_path` with
    word-level timestamps, then sequence-match the recognized words against
    `lyrics_text`'s own words to borrow timing for the user's actual lines.
    Returns LRC text with exactly the same lines as `lyrics_text`, one
    timestamp each — always meant to be reviewed/corrected, not final.
    """
    from .audio import probe

    total_duration, _ = probe(vocals_path)

    segments, _info = _run_whisper(vocals_path, word_timestamps=True)

    recognized: list[tuple[str, float]] = []
    for segment in segments:
        for word in segment.words or []:
            normalized = _normalize_word(word.word)
            if normalized:
                recognized.append((normalized, word.start))

    lines = [line.strip() for line in lyrics_text.split("\n") if line.strip()]
    known: list[tuple[str, int]] = []  # (normalized word, owning line index)
    for line_idx, line in enumerate(lines):
        for raw_word in _WORD_SPLIT.split(line):
            normalized = _normalize_word(raw_word)
            if normalized:
                known.append((normalized, line_idx))

    line_times: dict[int, float] = {}
    if recognized and known:
        known_seq = [w for w, _ in known]
        recognized_seq = [w for w, _ in recognized]
        matcher = difflib.SequenceMatcher(None, known_seq, recognized_seq, autojunk=False)
        for block in matcher.get_matching_blocks():
            for offset in range(block.size):
                _, line_idx = known[block.a + offset]
                _, time = recognized[block.b + offset]
                # First match found for a line wins — later words in the
                # same line would anchor later than the line's true start.
                line_times.setdefault(line_idx, time)

    times = [line_times.get(i) for i in range(len(lines))]
    filled = _interpolate(times, total_duration)

    return build_lrc([{"time": t, "text": text} for t, text in zip(filled, lines)])


def transcribe(path: Path) -> tuple[str, str]:
    """Run faster-whisper on `path`, returning (lyrics_text, lyrics_lrc).

    Segment-level timestamps become LRC lines directly — a draft, always
    flagged low-confidence to the user and expected to be hand-corrected.
    """
    segments, _info = _run_whisper(path, word_timestamps=False)

    lrc_lines = []
    text_lines = []
    for segment in segments:
        text = segment.text.strip()
        if not text:
            continue
        lrc_lines.append({"time": segment.start, "text": text})
        text_lines.append(text)

    return "\n".join(text_lines), build_lrc(lrc_lines)
