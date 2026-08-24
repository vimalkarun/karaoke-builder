from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
STORAGE_DIR = BACKEND_DIR / "storage"
ORIGINALS_DIR = STORAGE_DIR / "originals"
STEMS_DIR = STORAGE_DIR / "stems"
EXPORTS_DIR = STORAGE_DIR / "exports"

for d in (ORIGINALS_DIR, STEMS_DIR, EXPORTS_DIR):
    d.mkdir(parents=True, exist_ok=True)

DATABASE_URL = f"sqlite:///{BACKEND_DIR / 'app.db'}"

# Model choice for 2/4-stem separation: "fast" stays usable on CPU, "high"
# (htdemucs_ft) is a 4x ensemble — noticeably slower, worth it with a GPU.
# 6-stem always uses its own dedicated model regardless of quality choice.
# See services/separation.py.
DEMUCS_MODEL_FAST = "htdemucs"
DEMUCS_MODEL_HIGH = "htdemucs_ft"
DEMUCS_MODEL_6STEM = "htdemucs_6s"

ALLOWED_UPLOAD_EXTENSIONS = {".mp3", ".wav", ".m4a", ".flac", ".ogg", ".aac"}

# Maps a stem name (as used in the API) to the Track column that holds its
# file path. Shared between routers/tracks.py (streaming) and
# routers/export.py (export) so the two never drift apart.
STEM_ATTR_MAP = {
    "original": "original_path",
    "vocals": "vocals_path",
    "instrumental": "instrumental_path",
    "drums": "drums_path",
    "bass": "bass_path",
    "other": "other_path",
    "piano": "piano_path",
    "guitar": "guitar_path",
}

# The individual stems produced for a given stem_count — mirrors the
# frontend's STEMS_FOR_COUNT (src/api/client.ts). Used for "export all
# stems as a ZIP", where every one of these gets baked/converted and
# bundled together.
STEM_NAMES_FOR_COUNT = {
    2: ["vocals", "instrumental"],
    4: ["vocals", "drums", "bass", "other"],
    6: ["vocals", "drums", "bass", "other", "piano", "guitar"],
}
