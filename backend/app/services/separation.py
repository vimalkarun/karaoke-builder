"""Demucs stem separation, invoked as a subprocess (CLI) rather than the
Python API so the backend isn't tightly coupled to a specific demucs
version — see plan §3 "every column is swappable".
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

import soundfile as sf

from ..config import DEMUCS_MODEL_6STEM, DEMUCS_MODEL_FAST, DEMUCS_MODEL_HIGH, STEMS_DIR

STEM_NAMES: dict[int, list[str]] = {
    4: ["vocals", "drums", "bass", "other"],
    6: ["vocals", "drums", "bass", "other", "piano", "guitar"],
}


def has_gpu() -> bool:
    try:
        import torch

        return bool(
            torch.cuda.is_available()
            or (getattr(torch.backends, "mps", None) and torch.backends.mps.is_available())
        )
    except Exception:
        return False


def _pick_model(stem_count: int, quality: str) -> tuple[str, bool]:
    """Returns (model_name, two_stems)."""
    if stem_count == 6:
        return DEMUCS_MODEL_6STEM, False
    if stem_count == 4:
        return (DEMUCS_MODEL_HIGH if quality == "high" else DEMUCS_MODEL_FAST), False
    if stem_count == 2:
        return (DEMUCS_MODEL_HIGH if quality == "high" else DEMUCS_MODEL_FAST), True
    raise ValueError(f"Unsupported stem_count: {stem_count}")


def _bounce_instrumental(final_dir: Path, stem_names: list[str]) -> Path:
    """Sum every non-vocal stem into a single instrumental.wav, so 4/6-stem
    tracks still get a one-click "just the backing track" without the user
    opening the mixer."""
    non_vocal = [name for name in stem_names if name != "vocals"]
    mix = None
    sample_rate = None
    for name in non_vocal:
        data, sr = sf.read(str(final_dir / f"{name}.wav"), dtype="float32", always_2d=True)
        mix = data if mix is None else mix + data
        sample_rate = sr
    dst = final_dir / "instrumental.wav"
    sf.write(str(dst), mix, sample_rate)
    return dst


def separate(track_id: str, src: Path, stem_count: int = 2, quality: str = "fast") -> dict[str, Path]:
    """Run Demucs separation for `src`.

    Returns {stem_name: Path}, copied into a stable per-track directory
    under storage/stems/<track_id>/. Always includes an "instrumental" key
    (the "everything but vocals" bounce) regardless of stem_count, plus
    "vocals" and, for 4/6-stem, the individual stems for the mixer.
    """
    model, two_stems = _pick_model(stem_count, quality)
    work_dir = STEMS_DIR / f"_work_{track_id}"
    work_dir.mkdir(parents=True, exist_ok=True)

    runner = Path(__file__).parent / "_demucs_runner.py"
    cmd = [sys.executable, str(runner), "-n", model]
    if two_stems:
        cmd += ["--two-stems", "vocals"]
    cmd += ["-o", str(work_dir), str(src)]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        # demucs prints its own diagnostics (e.g. "could not load using X") to
        # stdout, not stderr, and a native crash can exit non-zero with both
        # streams empty — surface everything we have so this is diagnosable.
        detail = (result.stderr.strip() or result.stdout.strip() or "(no output captured)")[-2000:]
        raise RuntimeError(f"demucs failed (exit code {result.returncode}): {detail}")

    stem_source_dir = work_dir / model / src.stem
    final_dir = STEMS_DIR / track_id
    final_dir.mkdir(parents=True, exist_ok=True)
    outputs: dict[str, Path] = {}

    if two_stems:
        for produced_name, output_name in (("vocals", "vocals"), ("no_vocals", "instrumental")):
            src_file = stem_source_dir / f"{produced_name}.wav"
            if not src_file.exists():
                raise RuntimeError(f"demucs did not produce expected output in {stem_source_dir}")
            dst_file = final_dir / f"{output_name}.wav"
            shutil.copy2(src_file, dst_file)
            outputs[output_name] = dst_file
    else:
        stem_names = STEM_NAMES[stem_count]
        for name in stem_names:
            src_file = stem_source_dir / f"{name}.wav"
            if not src_file.exists():
                raise RuntimeError(f"demucs did not produce expected stem '{name}' in {stem_source_dir}")
            dst_file = final_dir / f"{name}.wav"
            shutil.copy2(src_file, dst_file)
            outputs[name] = dst_file
        outputs["instrumental"] = _bounce_instrumental(final_dir, stem_names)

    shutil.rmtree(work_dir, ignore_errors=True)
    return outputs
