"""Subprocess entrypoint for running Demucs separation (invoked from
separation.py rather than `python -m demucs` directly).

Demucs 4.0.1's primary read path shells out to the `ffmpeg`/`ffprobe`
executables directly (fine, as long as they're on PATH for this process),
but falls back to `torchaudio.load()` if that fails, and writes output via
`torchaudio.save()` unconditionally. Current torchaudio routes both through
TorchCodec, which on Windows needs an ffmpeg *shared* build (separate
libavcodec/libavformat/libavutil DLLs) rather than the common static
"full_build" distribution — and separately, if the ffmpeg executables
themselves aren't on this process's PATH (e.g. a server left running in a
shell whose PATH predates an ffmpeg install), the executable-based read path
fails too, tripping the same TorchCodec fallback.

Rather than depend on exactly matching ffmpeg builds/PATH state, we patch
both `torchaudio.load` and `torchaudio.save` to go through `soundfile`
instead — same lossless round trip, no TorchCodec involved at all.
"""

import sys

import soundfile as sf
import torch
import torchaudio

_ENCODING_TO_SUBTYPE = {
    ("PCM_S", 16): "PCM_16",
    ("PCM_S", 24): "PCM_24",
    ("PCM_S", 32): "PCM_32",
    ("PCM_F", 32): "FLOAT",
}


def _load_via_soundfile(path, **_ignored):
    data, sample_rate = sf.read(str(path), dtype="float32", always_2d=True)  # (frames, channels)
    wav = torch.from_numpy(data.T)  # torchaudio convention: (channels, frames)
    return wav, sample_rate


def _save_via_soundfile(path, src, sample_rate, encoding=None, bits_per_sample=None, **_ignored):
    wav = src.detach().cpu().numpy().T  # torchaudio uses (channels, samples); soundfile wants (samples, channels)
    subtype = _ENCODING_TO_SUBTYPE.get((encoding, bits_per_sample), "PCM_16")
    sf.write(str(path), wav, sample_rate, subtype=subtype)


torchaudio.load = _load_via_soundfile
torchaudio.save = _save_via_soundfile

from demucs.separate import main  # noqa: E402  (must import after patching torchaudio)

if __name__ == "__main__":
    main(sys.argv[1:])
