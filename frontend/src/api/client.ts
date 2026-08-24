// Backend always listens on :8000. Deriving the host (not hardcoding
// "localhost") is what lets this same build be opened from a phone on the
// same Wi-Fi and still reach the right machine — see plan §2.
const API_BASE = `${window.location.protocol}//${window.location.hostname}:8000`;

export type TrackStatus = 'importing' | 'uploaded' | 'separating' | 'separated' | 'error';
export type Stem = 'original' | 'vocals' | 'instrumental' | 'drums' | 'bass' | 'other' | 'piano' | 'guitar';
export type ExportFormat = 'mp3' | 'wav' | 'm4a' | 'flac';
export type StemCount = 2 | 4 | 6;
export type SeparationQuality = 'fast' | 'high';

export interface Track {
  id: string;
  title: string;
  artist: string | null;
  original_filename: string;
  duration_sec: number | null;
  bpm: number | null;
  musical_key: string | null;
  status: TrackStatus;
  vocals_path: string | null;
  instrumental_path: string | null;
  drums_path: string | null;
  bass_path: string | null;
  other_path: string | null;
  piano_path: string | null;
  guitar_path: string | null;
  stem_count: StemCount;
  separation_quality: SeparationQuality;
  source: 'upload' | 'youtube';
  source_url: string | null;
  lyrics_text: string | null;
  lyrics_lrc: string | null;
  lyrics_source: 'manual' | 'whisper-draft' | 'auto-aligned' | null;
  preferred_pitch_semitones: number;
  preferred_tempo_percent: number;
  created_at: string;
}

export interface LyricLine {
  time: number;
  text: string;
}

export interface Job {
  id: string;
  track_id: string;
  type: 'import' | 'separate' | 'export' | 'transcribe' | 'burn_video' | 'align';
  status: 'queued' | 'running' | 'done' | 'error';
  progress: number;
  error_message: string | null;
  result_path: string | null;
  updated_at: string;
}

export interface SystemInfo {
  gpu_available: boolean;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const jsonHeaders = { 'Content-Type': 'application/json' };

// Stems available for a given stem_count, in mixer display order.
export const STEMS_FOR_COUNT: Record<StemCount, Stem[]> = {
  2: ['vocals', 'instrumental'],
  4: ['vocals', 'drums', 'bass', 'other'],
  6: ['vocals', 'drums', 'bass', 'other', 'piano', 'guitar'],
};

export const api = {
  listTracks: () => request<Track[]>('/api/tracks'),

  uploadTrack: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<Track>('/api/tracks/upload', { method: 'POST', body: form });
  },

  importYoutube: (url: string) =>
    request<Job>('/api/tracks/import-youtube', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ url, confirmed_personal_use: true }),
    }),

  getTrack: (id: string) => request<Track>(`/api/tracks/${id}`),

  updateTrackSettings: (
    id: string,
    body: Partial<Pick<Track, 'preferred_pitch_semitones' | 'preferred_tempo_percent' | 'title' | 'artist'>>,
  ) => request<Track>(`/api/tracks/${id}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify(body) }),

  deleteTrack: (id: string) => request<void>(`/api/tracks/${id}`, { method: 'DELETE' }),

  separateTrack: (id: string, stemCount: StemCount, quality: SeparationQuality) =>
    request<Job>(`/api/tracks/${id}/separate`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ stem_count: stemCount, quality }),
    }),

  getJob: (id: string) => request<Job>(`/api/jobs/${id}`),

  streamUrl: (trackId: string, stem: Stem) => `${API_BASE}/api/tracks/${trackId}/stream/${stem}`,

  exportTrack: (
    id: string,
    body: {
      stem: Stem;
      all_stems?: boolean;
      format: ExportFormat;
      bitrate_kbps: number;
      pitch_semitones: number;
      tempo_percent: number;
      trim_start?: number;
      trim_end?: number | null;
      fade_in?: number;
      fade_out?: number;
    },
  ) => request<Job>(`/api/tracks/${id}/export`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }),

  exportDownloadUrl: (jobId: string) => `${API_BASE}/api/exports/${jobId}/download`,

  systemInfo: () => request<SystemInfo>('/api/system/info'),

  updateLyrics: (id: string, body: { lyrics_text?: string | null; lyrics_lrc?: string | null; lyrics_source?: string | null }) =>
    request<Track>(`/api/tracks/${id}/lyrics`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify(body) }),

  transcribeTrack: (id: string) => request<Job>(`/api/tracks/${id}/transcribe`, { method: 'POST' }),

  alignLyrics: (id: string) => request<Job>(`/api/tracks/${id}/align-lyrics`, { method: 'POST' }),

  burnVideo: (
    id: string,
    body: {
      stem: Stem;
      pitch_semitones: number;
      tempo_percent: number;
      trim_start?: number;
      trim_end?: number | null;
      fade_in?: number;
      fade_out?: number;
    },
  ) => request<Job>(`/api/tracks/${id}/burn-video`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }),

  backupDownloadUrl: (includeStems: boolean) => `${API_BASE}/api/backup?include_stems=${includeStems}`,

  restoreBackup: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<{ restored: number; skipped: number }>('/api/backup/restore', { method: 'POST', body: form });
  },
};
