import { useEffect, useRef, useState } from 'react';
import { api, STEMS_FOR_COUNT, type ExportFormat, type Job, type Stem, type Track } from '../api/client';
import { STEM_LABELS } from '../stems';
import { WaveformEditor } from './WaveformEditor';

export function ExportDialog({
  track,
  initialStem,
  initialPitch,
  initialTempo,
  onClose,
}: {
  track: Track;
  initialStem: Stem;
  initialPitch: number;
  initialTempo: number;
  onClose: () => void;
}) {
  const [stem, setStem] = useState<Stem | 'all'>(initialStem);
  const [format, setFormat] = useState<ExportFormat>('mp3');
  const [bitrate, setBitrate] = useState(192);
  const [pitch, setPitch] = useState(initialPitch);
  const [tempo, setTempo] = useState(initialTempo);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState<number | ''>('');
  const [fadeIn, setFadeIn] = useState(0);
  const [fadeOut, setFadeOut] = useState(0);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const availableStems: Stem[] = track.status === 'separated' ? STEMS_FOR_COUNT[track.stem_count] : [];

  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  const isAllStems = stem === 'all';

  const startExport = async () => {
    setError(null);
    setJob(null);
    try {
      const created = await api.exportTrack(track.id, {
        // `stem` is ignored server-side when all_stems is set; instrumental
        // is just a harmless placeholder to satisfy the request shape.
        stem: isAllStems ? 'instrumental' : stem,
        all_stems: isAllStems,
        format,
        bitrate_kbps: bitrate,
        pitch_semitones: pitch,
        tempo_percent: tempo,
        trim_start: trimStart,
        trim_end: trimEnd === '' ? null : trimEnd,
        fade_in: fadeIn,
        fade_out: fadeOut,
      });
      setJob(created);
      pollRef.current = window.setInterval(async () => {
        const updated = await api.getJob(created.id);
        setJob(updated);
        if (updated.status === 'done' || updated.status === 'error') {
          if (pollRef.current) window.clearInterval(pollRef.current);
        }
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h2>Export “{track.title}”</h2>

        <label className="field">
          Stem
          <select value={stem} onChange={(e) => setStem(e.target.value as Stem | 'all')}>
            <option value="original">Original (mixed)</option>
            {availableStems.map((s) => (
              <option key={s} value={s}>
                {STEM_LABELS[s]}
              </option>
            ))}
            {availableStems.length > 0 && <option value="all">All stems separately (ZIP)</option>}
          </select>
        </label>

        <label className="field">
          Format
          <select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
            <option value="mp3">MP3</option>
            <option value="wav">WAV</option>
            <option value="m4a">M4A / AAC</option>
            <option value="flac">FLAC</option>
          </select>
        </label>

        {(format === 'mp3' || format === 'm4a') && (
          <label className="field">
            Bitrate (kbps)
            <select value={bitrate} onChange={(e) => setBitrate(Number(e.target.value))}>
              {[128, 192, 256, 320].map((br) => (
                <option key={br} value={br}>
                  {br}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="field">
          Pitch: {pitch > 0 ? `+${pitch}` : pitch} semitones
          <input type="range" min={-12} max={12} step={0.5} value={pitch} onChange={(e) => setPitch(Number(e.target.value))} />
        </label>

        <label className="field">
          Tempo: {tempo}%
          <input type="range" min={50} max={150} step={1} value={tempo} onChange={(e) => setTempo(Number(e.target.value))} />
        </label>

        {isAllStems && (
          <p className="lyrics-hint">
            Every stem is baked with the same pitch/tempo/trim settings below and bundled into one ZIP — the waveform previews
            the instrumental for reference.
          </p>
        )}

        <label className="field">
          Trim &amp; loop region — drag the edges on the waveform, or set start/end below
          <WaveformEditor
            url={api.streamUrl(track.id, isAllStems ? 'instrumental' : stem === 'original' ? 'original' : stem)}
            trimStart={trimStart}
            trimEnd={trimEnd === '' ? null : trimEnd}
            onRegionChange={(start, end) => {
              setTrimStart(Math.round(start * 100) / 100);
              setTrimEnd(Math.round(end * 100) / 100);
            }}
          />
        </label>

        <div className="grid-2">
          <label className="field">
            Trim start (s)
            <input type="number" min={0} step={0.1} value={trimStart} onChange={(e) => setTrimStart(Number(e.target.value))} />
          </label>
          <label className="field">
            Trim end (s, blank = end)
            <input
              type="number"
              min={0}
              step={0.1}
              value={trimEnd}
              onChange={(e) => setTrimEnd(e.target.value === '' ? '' : Number(e.target.value))}
            />
          </label>
          <label className="field">
            Fade in (s)
            <input type="number" min={0} step={0.1} value={fadeIn} onChange={(e) => setFadeIn(Number(e.target.value))} />
          </label>
          <label className="field">
            Fade out (s)
            <input type="number" min={0} step={0.1} value={fadeOut} onChange={(e) => setFadeOut(Number(e.target.value))} />
          </label>
        </div>

        <div className="modal-actions">
          <button className="button" onClick={onClose}>
            Close
          </button>
          <button className="button primary" onClick={startExport} disabled={job?.status === 'queued' || job?.status === 'running'}>
            Render export
          </button>
        </div>

        {error && <p className="error-text">{error}</p>}

        {job && (
          <div className="export-status">
            {job.status === 'queued' && <p>Queued…</p>}
            {job.status === 'running' && <p>{isAllStems ? 'Rendering every stem — this takes longer than a single export…' : 'Rendering…'}</p>}
            {job.status === 'error' && <p className="error-text">Failed: {job.error_message}</p>}
            {job.status === 'done' && (
              <a className="button primary" href={api.exportDownloadUrl(job.id)} download>
                {isAllStems ? 'Download ZIP' : `Download ${format.toUpperCase()}`}
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
