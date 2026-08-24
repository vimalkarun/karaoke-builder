# Karaoke Builder

A local-first web app that turns any track into a pitch-adjustable, stem-separated
karaoke backing track. See [docs/PLAN.md](docs/PLAN.md) for the full product plan and
phased roadmap. This scaffold implements **Phases 1–4**:

- Local file import and YouTube import (yt-dlp, personal-use disclaimer gate), library
  list, playback
- Demucs 2/4/6-stem separation as a background job, with a fast/high-quality model
  choice (the UI suggests "high" automatically when a GPU is detected)
- Pitch (semitones) and tempo (%) control during playback, independent of each other
- A per-stem mixer (volume, pan, mute, solo) once a track has more than 2 stems
- Export any stem to MP3/WAV/M4A/FLAC, with pitch/tempo baked in, plus a waveform
  trim/fade editor and loop-preview for picking an export range
- Lyrics: paste text, tap-to-sync timing while the track plays, and a synced
  line-by-line karaoke display during playback. An auto-transcribe (faster-whisper)
  fallback for when no lyrics text exists, flagged as a low-confidence draft. An
  auto-align option (also faster-whisper, matched against your own lyric lines) gets
  a starting LRC straight from the vocal stem + known text, landing directly in the
  tweakable timing editor
- Suggested pitch shift: pick a target key and get the semitone shift to move the
  detected key there, using the key/BPM detection already in place
- Practice mode: record yourself over the backing track via mic, then compare against
  the original vocals side by side. Client-side only — no server persistence, download
  your take instead
- Burn to video: renders an MP4 (any stem, pitch/tempo/trim applied) with synced lyrics
  burned in as captions on a plain background, for playback on a TV or projector
- Backup & restore: bundles track metadata, lyrics/LRC, and original audio into a ZIP
  (stems optional — excluded by default since they're regenerable via Separate and are
  the bulk of storage size). Restoring is idempotent: tracks already present (matched
  on title + filename + duration) are skipped, so re-restoring the same backup, or one
  that overlaps your current library, never creates duplicates

It's a client–server app: a Python (FastAPI) backend does the heavy lifting on your
desktop, and a React frontend talks to it over HTTP. Open the frontend from your
phone's browser on the same Wi-Fi to use it there too — no app store involved.

## Prerequisites

- **Python 3.10+**
- **Node 20.19+ or 22.12+** recommended (developed against 20.10 — works, but `npm`
  will print engine warnings you can ignore)
- **[ffmpeg](https://ffmpeg.org/download.html)** on your `PATH` — required for all
  format conversion and export
- **[Rubber Band CLI](https://breakfastquay.com/rubberband/)** on your `PATH` —
  optional but recommended for higher-quality pitch/tempo bake at export time. Without
  it, export falls back to ffmpeg's `rubberband` filter (only present in ffmpeg builds
  compiled with `--enable-librubberband`) or plain passthrough if neither is available.

## Backend setup

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate          # Windows; use `source .venv/bin/activate` on macOS/Linux
pip install -r requirements.txt
```

`requirements.txt` includes `demucs`, which pulls in PyTorch — a large download. If you
want to control the PyTorch build for your machine (CPU-only vs. CUDA), install it
first:

```bash
pip install torch --index-url https://download.pytorch.org/whl/cpu   # CPU-only
pip install -r requirements.txt
```

Run the server:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

`--host 0.0.0.0` is what makes it reachable from your phone over LAN. The API is now at
`http://<this-machine>:8000`; check `http://localhost:8000/api/health`.

## Frontend setup

```bash
cd frontend
npm install
npm run dev
```

Open the printed URL (defaults to `http://localhost:5173`) on this machine, or
`http://<this-machine-LAN-IP>:5173` from your phone. The frontend expects the backend
on port 8000 of whatever host you loaded the page from — see `src/api/client.ts`.

## HTTPS for phone access (Practice mode's mic)

Browsers only allow microphone access (`getUserMedia`, used by Practice mode) on a
"secure context" — HTTPS, or exactly `localhost`. Opening this app from a phone at
`http://<lan-ip>:5173` is neither, so the mic silently never works there. To fix it,
generate a self-signed cert once:

```bash
cd backend
python scripts/generate_dev_cert.py
```

This writes `backend/certs/cert.pem` and `key.pem`, covering `localhost`, `127.0.0.1`,
and this machine's current LAN IP(s) (re-run it if your IP changes, e.g. a new DHCP
lease). Then start both servers over HTTPS:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --ssl-certfile certs/cert.pem --ssl-keyfile certs/key.pem
```

The frontend's `vite.config.ts` auto-detects these certs and serves over HTTPS too —
no flag needed, just `npm run dev` as usual. Each device shows a one-time "connection
isn't private" warning on first visit (expected for a self-signed cert — click through
it: Chrome → "Advanced" → "Proceed").

**Windows Firewall caveat:** on a network profile set to "Public" (common on
Windows for unfamiliar/work Wi-Fi), inbound connections to dev-server ports are
blocked by default — a phone on the same Wi-Fi won't even reach the login page,
regardless of the HTTPS setup above. This is independent of anything in this repo;
confirm with `Test-NetConnection -ComputerName <lan-ip> -Port 5173` from the same
machine. If it fails, either switch the network to "Private" in Windows Settings, or
add a scoped inbound-allow rule for ports 8000/5173. On a corporate-managed laptop,
check with IT before changing firewall settings — this can be blocked by policy for
good reasons and the LAN-access feature is optional.

## Notes on scope

- Separation runs one job at a time (`backend/app/services/job_queue.py`) — simple and
  predictable for a personal machine; revisit if this ever needs to serve concurrent
  users.
- Playback pitch/tempo uses [SoundTouchJS](https://github.com/cutterbl/SoundTouchJS) in
  the browser for a fast, real-time preview, applied uniformly across every stem in the
  mixer so they stay in sync. Export uses Rubber Band server-side for a higher-fidelity
  final render — these are intentionally different engines for different jobs (preview
  vs. final bake).
- Key/BPM detection and pitch shifting are both plain DSP (librosa, Rubber Band) — no
  ML involved; see plan §4 for what actually needs AI later (lyrics alignment,
  transcription).
- 4-stem separation produces vocals/drums/bass/other; 6-stem adds piano/guitar
  (`htdemucs_6s`, which doesn't have a separate high-quality variant — the quality
  picker only applies to 2/4-stem). A 2-stem "instrumental" bounce is always computed
  and stored too, so quick playback works the same regardless of stem count.
- YouTube import needs `yt-dlp` kept reasonably current (`pip install -U yt-dlp`) since
  it breaks against YouTube periodically — deliberately unpinned in requirements.txt.
  Strictly personal/household use; see plan §5 before changing the disclaimer gate.
- The waveform editor (in the export dialog) previews at original pitch/tempo — it's
  for picking a trim/fade range and isn't wired into the pitch-shifted mixer playback.
- Dedicated forced-alignment models (MMS_FA / NeMo, plan §3) still aren't used — that
  still means new model downloads and real native-dependency risk (this project already
  hit that twice, with rubberband and torchcodec). Instead, `align_to_vocals`
  (`backend/app/services/lyrics.py`) gets a similar practical result from what's
  already installed: faster-whisper's word-level timestamps say *when* words are sung,
  and a sequence-matching pass (stdlib `difflib`, no new dependency) maps that timing
  onto the user's own trusted lyric lines — their spelling/script always wins, only the
  timing is borrowed from ASR. Verified against real synthesized speech: lines that
  actually matched landed on Whisper's exact word timestamp; a fabricated unspoken line
  correctly fell back to linear interpolation between its neighbors instead of a hole.
  Accuracy depends on how well Whisper's transcription lines up with the pasted text,
  which is exactly why the result always lands in the tap/type/nudge editor as a
  draft — never a silent final answer — same as the whisper-draft transcription path.
- Both faster-whisper paths (auto-align and the no-lyrics transcribe fallback) use the
  "base" model, not "small" — reproduced directly against a real 4:40 track that
  "small" failed on (`mkl_malloc: failed to allocate memory`) while "base" completed
  successfully, on a machine that was otherwise busy (browser/IDE/background apps
  eating RAM — `Memory Compression` alone was holding ~2GB). Word-level timing doesn't
  need "small"'s extra transcription accuracy the way the no-lyrics fallback's actual
  recognized *text* does, so it's a clearly good trade for alignment specifically, and
  applied to both paths for consistency. There's also one automatic retry (5s pause) if
  the failure recurs, since it reproduced as intermittent — immediately retrying the
  same "base" model after a failed load succeeded. If it still fails after that, the
  error message says to close other applications and retry, rather than surfacing the
  raw MKL error text.
- Practice mode's recording is whatever format `MediaRecorder` gives the browser
  (webm/opus in Chrome, ogg in Firefox) — fine for in-browser playback and download,
  not transcoded server-side.
- Burn-to-video subtitles are line-level (from the same LRC used for the karaoke
  display), not per-word karaoke highlighting — and there's no custom background image
  yet, just a plain color matching the app's theme. Both are reasonable follow-ups if
  wanted, not attempted here to keep the ffmpeg filtergraph (already fiddly with
  Windows path escaping) from getting more fragile.
- All of Phases 1–4 from the original plan are now built. Phase 5 (LAN/phone UI polish,
  HTTPS for mic access, backup/restore) is done too, with cloud separation deliberately
  out of scope per plan §5's local-first stance. What's left is the deferred
  forced-alignment upgrade noted above.
- "Multi-device sync" from the original Phase 5 wishlist didn't need a new feature —
  the client-server architecture already means every device on the LAN sees the same
  library on the backend machine, no syncing involved. What that setup actually lacks
  is protection against losing the *one* copy on that machine, and a way to move it to
  a new machine — that's what backup/restore (above) is actually for.
- Grid layouts with number/text inputs (e.g. Export/Burn-to-video's trim & fade fields)
  need `min-width: 0` on the grid item — a `<input type="number">`'s browser-default
  intrinsic width (~170px) can force a `1fr` column past its share and overflow the
  modal once it's narrower than about 340px, which only shows up on a phone-width
  screen. Verified narrow-viewport rendering directly (Playwright at 390px), not just
  assumed from the CSS.
