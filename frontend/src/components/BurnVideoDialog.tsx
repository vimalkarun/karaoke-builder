import { useEffect, useRef, useState } from 'react';
import { api, STEMS_FOR_COUNT, type Job, type Stem, type Track } from '../api/client';
import { STEM_LABELS } from '../stems';
import { WaveformEditor } from './WaveformEditor';

export function BurnVideoDialog({
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
  const [stem, setStem] = useState<Stem>(initialStem);
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

  const startBurn = async () => {
    setError(null);
    setJob(null);
    try {
      const created = await api.burnVideo(track.id, {
        stem,
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
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h2>Burn “{track.title}” to video</h2>
        <p className="lyrics-hint">
          Renders an MP4 (backing track + synced lyrics on a plain background) for playback on a TV or projector.
          {!track.lyrics_lrc && ' No synced lyrics yet — the video will have audio only, no captions.'}
        </p>

        <label className="field">
          Stem
          <select value={stem} onChange={(e) => setStem(e.target.value as Stem)}>
            <option value="original">Original (mixed)</option>
            {availableStems.map((s) => (
              <option key={s} value={s}>
                {STEM_LABELS[s]}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          Pitch: {pitch > 0 ? `+${pitch}` : pitch} semitones
          <input type="range" min={-12} max={12} step={0.5} value={pitch} onChange={(e) => setPitch(Number(e.target.value))} />
        </label>

        <label className="field">
          Tempo: {tempo}%
          <input type="range" min={50} max={150} step={1} value={tempo} onChange={(e) => setTempo(Number(e.target.value))} />
        </label>

        <label className="field">
          Trim region
          <WaveformEditor
            url={api.streamUrl(track.id, stem)}
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
          <button className="button primary" onClick={startBurn} disabled={job?.status === 'queued' || job?.status === 'running'}>
            Render video
          </button>
        </div>

        {error && <p className="error-text">{error}</p>}

        {job && (
          <div className="export-status">
            {job.status === 'queued' && <p>Queued…</p>}
            {job.status === 'running' && <p>Rendering — this can take a while for a full-length song…</p>}
            {job.status === 'error' && <p className="error-text">Failed: {job.error_message}</p>}
            {job.status === 'done' && (
              <a className="button primary" href={api.exportDownloadUrl(job.id)} download>
                Download MP4
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
