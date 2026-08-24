# Karaoke Builder — Development Plan

Source: prepared for vimalkarun@gmail.com, draft v3, 20 Aug 2026. Decisions locked — see §7.

## 1. Platform decision

Local-first web app: a FastAPI backend running on your desktop (full CPU/GPU access,
easy YouTube download server-side) with a browser-based UI. Reachable from your phone
over home Wi-Fi — that's the "mobile app." No native mobile app, no app-store submission
(app stores restrict apps that download streaming/video content). Optional Tauri/Electron
shell later for a double-click launcher; not required to use it.

## 2. Technology stack

- **Audio engine**: Demucs (`htdemucs` for Phase 1, CPU-friendly; `htdemucs_ft` if a GPU
  is available) for stem separation; Rubber Band for high-quality pitch/tempo bake at
  export time; yt-dlp for YouTube import (Phase 2); ffmpeg for format/bitrate conversion;
  librosa for key/BPM detection (DSP, no ML needed).
- **Lyrics & alignment** (Phase 3): torchaudio MMS_FA as the default forced aligner
  (any Indic script or romanized text); faster-whisper as an ASR fallback only when no
  lyrics text exists anywhere; LRC as the internal timing format.
- **Server & UI**: FastAPI + SQLite backend; React + wavesurfer.js frontend; Web Audio
  API (+ a WASM time-stretch library) for real-time pitch/tempo preview during playback,
  with Rubber Band used for the final high-fidelity export render.

## 3. Legal notes

- Streaming-service downloading (Spotify/Apple Music/etc.) is out of scope — DRM
  circumvention, not just a ToS issue.
- YouTube downloading via yt-dlp is against YouTube's ToS but is the de facto standard
  for personal offline tools. Strictly personal/household use, never redistribute
  downloaded audio, never ship a build that does this to an app store.

## 4. Phased roadmap

- **Phase 0** — lock decisions (done, see §5 below).
- **Phase 1 (this scaffold)** — local file import, library, playback; Demucs 2-stem
  separation as a background job; pitch (semitones) and tempo (%) control; export mixed
  track to MP3/WAV.
- **Phase 2** — YouTube import; 4/6-stem separation with quality/speed choice; per-stem
  mixer (volume/mute/solo/pan); more export formats (M4A, FLAC); waveform trim/fade/loop.
- **Phase 3** — lyrics: transcription + forced alignment → LRC, manual correction editor,
  synced karaoke display, key/BPM auto-detect with suggested pitch shift.
- **Phase 4** — mic practice/record mode; "burn to video" export (MP4).
- **Phase 5 (optional)** — polished phone-over-LAN UI, pluggable cloud separation
  backend, multi-device library sync.

## 5. Decisions — locked (20 Aug 2026)

- Platform → local web app (server + browser UI, phone over Wi-Fi).
- Hardware → plan for CPU-only, GPU as a bonus (auto-offer `htdemucs_ft` if CUDA/MPS
  is detected).
- Acquisition scope → local files + YouTube only.
- Audience → personal, may share with family (run on a home server everyone can reach;
  never redistribute tracks outside the household).
