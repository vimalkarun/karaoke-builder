import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type Job, type Track } from '../api/client';
import { activeLineIndex, buildLrc, mergeTimings, parseLrc } from '../lrc';

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

type Mode = 'paste' | 'sync' | 'view';

function modeFor(track: Track): Mode {
  if (track.lyrics_lrc) return 'view';
  if (track.lyrics_text) return 'sync';
  return 'paste';
}

export function LyricsPanel({
  track,
  onTrackChanged,
  currentTime,
  duration,
  isPlaying,
  onPlay,
  onPause,
  onSeek,
  canTranscribe,
}: {
  track: Track;
  onTrackChanged: (track: Track) => void;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (time: number) => void;
  canTranscribe: boolean;
}) {
  const [mode, setMode] = useState<Mode>(() => modeFor(track));
  const [pasteText, setPasteText] = useState(track.lyrics_text ?? '');
  const [times, setTimes] = useState<(number | null)[]>([]);
  const [transcribeJob, setTranscribeJob] = useState<Job | null>(null);
  const [alignJob, setAlignJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const alignPollRef = useRef<number | null>(null);
  const activeLineRef = useRef<HTMLParagraphElement | null>(null);
  // App.tsx doesn't remount this panel on track switch (that would tear
  // down and rebuild the shared AudioContext), so a transcribe job's
  // busy/error state has to be scoped manually — otherwise switching tracks
  // while a job is in flight makes it look like every track is transcribing.
  const currentTrackIdRef = useRef(track.id);
  currentTrackIdRef.current = track.id;

  const syncLines = useMemo(
    () => (track.lyrics_text ?? '').split('\n').map((l) => l.trim()).filter(Boolean),
    [track.lyrics_text],
  );

  useEffect(() => {
    setMode(modeFor(track));
    setPasteText(track.lyrics_text ?? '');
    // Belongs to whichever track started it — don't show a stale busy/error
    // state on a different track's panel. Any poll already in flight for
    // the previous track keeps running in the background (see
    // startTranscribe) so its result still lands via onTrackChanged; it
    // just won't render here anymore.
    setTranscribeJob(null);
    setAlignJob(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id]);

  useEffect(() => {
    if (mode !== 'sync') return;
    // Carry over timestamps for lines whose text didn't change — fixing a
    // typo or adding a humming line shouldn't force retapping everything.
    // Only genuinely new/changed lines come back needing a tap.
    const previous = parseLrc(track.lyrics_lrc ?? '');
    setTimes(mergeTimings(previous, syncLines));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, syncLines]);

  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      if (alignPollRef.current) window.clearInterval(alignPollRef.current);
    };
  }, []);

  const viewLines = useMemo(() => parseLrc(track.lyrics_lrc ?? ''), [track.lyrics_lrc]);
  const activeIndex = activeLineIndex(viewLines, currentTime);

  useEffect(() => {
    activeLineRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeIndex]);

  const savePastedText = async () => {
    // lyrics_lrc is deliberately left alone here — the sync screen merges it
    // against the new text so unedited lines keep their timing.
    const updated = await api.updateLyrics(track.id, { lyrics_text: pasteText });
    onTrackChanged(updated);
    setMode('sync');
  };

  const hasExistingLyrics = Boolean(track.lyrics_text || track.lyrics_lrc);

  const startTranscribe = async () => {
    if (hasExistingLyrics) {
      const proceed = window.confirm(
        'This replaces your current lyrics and timing with an auto-transcribed draft — that can\'t be undone. Continue?',
      );
      if (!proceed) return;
    }
    const trackId = track.id;
    const isCurrentTrack = () => currentTrackIdRef.current === trackId;

    if (isCurrentTrack()) setError(null);
    try {
      const job = await api.transcribeTrack(trackId);
      if (isCurrentTrack()) setTranscribeJob(job);

      // Capture this interval's own id rather than relying on the shared
      // pollRef — if the user switches tracks and starts another transcribe
      // before this one finishes, a shared ref would let the second job's
      // interval overwrite the first's id, so the first job could end up
      // clearing the *second* job's interval instead of its own.
      const intervalId = window.setInterval(async () => {
        const updatedJob = await api.getJob(job.id);
        if (isCurrentTrack()) setTranscribeJob(updatedJob);
        if (updatedJob.status === 'done' || updatedJob.status === 'error') {
          window.clearInterval(intervalId);
          if (updatedJob.status === 'done') {
            const updatedTrack = await api.getTrack(trackId);
            onTrackChanged(updatedTrack);
          }
        }
      }, 2000);
      pollRef.current = intervalId;
    } catch (err) {
      if (isCurrentTrack()) setError(err instanceof Error ? err.message : String(err));
    }
  };

  const canAlign = Boolean(track.vocals_path);

  const startAlign = async () => {
    const hasPartialTaps = times.some((t) => t !== null);
    if (hasPartialTaps || track.lyrics_lrc) {
      const proceed = window.confirm(
        "This replaces the current lyric timing with an automatic vocal alignment — you can still tweak it afterward. Continue?",
      );
      if (!proceed) return;
    }
    const trackId = track.id;
    const isCurrentTrack = () => currentTrackIdRef.current === trackId;

    if (isCurrentTrack()) setError(null);
    try {
      const job = await api.alignLyrics(trackId);
      if (isCurrentTrack()) setAlignJob(job);

      // Same self-clearing-interval pattern as startTranscribe — see that
      // comment for why a shared ref would clear the wrong job's timer.
      const intervalId = window.setInterval(async () => {
        const updatedJob = await api.getJob(job.id);
        if (isCurrentTrack()) setAlignJob(updatedJob);
        if (updatedJob.status === 'done' || updatedJob.status === 'error') {
          window.clearInterval(intervalId);
          if (updatedJob.status === 'done') {
            const updatedTrack = await api.getTrack(trackId);
            onTrackChanged(updatedTrack);
            if (isCurrentTrack()) {
              // Land directly in the tweak-able editor, pre-filled with the
              // aligned times, rather than a silent view-mode update.
              setTimes(mergeTimings(parseLrc(updatedTrack.lyrics_lrc ?? ''), syncLines));
              setMode('sync');
            }
          }
        }
      }, 2000);
      alignPollRef.current = intervalId;
    } catch (err) {
      if (isCurrentTrack()) setError(err instanceof Error ? err.message : String(err));
    }
  };

  const nextUntimedIndex = times.findIndex((t) => t === null);

  // Any line can be tapped, nudged, or directly typed at any time — not
  // just the next untimed one — so a mistimed line can be corrected without
  // resetting the whole sync.
  const tapLine = (index: number) => {
    setTimes((prev) => prev.map((t, i) => (i === index ? currentTime : t)));
  };

  const setLineTime = (index: number, value: number | null) => {
    setTimes((prev) => prev.map((t, i) => (i === index ? value : t)));
  };

  const nudgeLine = (index: number, delta: number) => {
    setTimes((prev) => prev.map((t, i) => (i === index && t !== null ? Math.max(0, Math.round((t + delta) * 100) / 100) : t)));
  };

  const saveTiming = async () => {
    const lines = syncLines.map((text, i) => ({ time: times[i] ?? 0, text }));
    const lrc = buildLrc(lines);
    const updated = await api.updateLyrics(track.id, { lyrics_lrc: lrc, lyrics_source: 'manual' });
    onTrackChanged(updated);
    setMode('view');
  };

  const transcribeBusy = transcribeJob?.status === 'queued' || transcribeJob?.status === 'running';

  const transcribeControl = canTranscribe && (
    <button className="button" onClick={startTranscribe} disabled={transcribeBusy}>
      {transcribeJob?.status === 'running'
        ? 'Transcribing…'
        : hasExistingLyrics
          ? 'Re-transcribe (replaces current lyrics)'
          : 'No lyrics? Auto-transcribe (draft)'}
    </button>
  );

  const alignBusy = alignJob?.status === 'queued' || alignJob?.status === 'running';

  const alignControl = canAlign && (
    <button className="button" onClick={startAlign} disabled={alignBusy} title="Uses word-level ASR timing matched against your lyric lines — a starting point, not exact">
      {alignJob?.status === 'running' ? 'Aligning to vocals…' : 'Auto-align to vocals'}
    </button>
  );

  const transcribeStatus = (
    <>
      {error && <p className="error-text">{error}</p>}
      {transcribeJob?.status === 'error' && <p className="error-text">Transcription failed: {transcribeJob.error_message}</p>}
      {alignJob?.status === 'error' && <p className="error-text">Alignment failed: {alignJob.error_message}</p>}
    </>
  );

  if (mode === 'paste') {
    return (
      <div className="lyrics-panel">
        <h3>Lyrics</h3>
        <label className="field">
          Paste lyrics (one line per line)
          <textarea rows={8} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Verse 1 line one&#10;Verse 1 line two&#10;…" />
        </label>
        {track.lyrics_lrc && (
          <p className="lyrics-hint">Lines you don't change keep their existing timing — only new or edited lines will need a tap.</p>
        )}
        <div className="player-actions">
          <button className="button primary" onClick={savePastedText} disabled={!pasteText.trim()}>
            Save &amp; sync timing
          </button>
          {transcribeControl}
        </div>
        {transcribeStatus}
      </div>
    );
  }

  if (mode === 'sync') {
    return (
      <div className="lyrics-panel">
        <h3>Sync lyrics timing</h3>
        <p className="lyrics-hint">
          Play and tap each line as it starts, or type/nudge the exact seconds directly. Retapping or re-typing a line only changes that one.
        </p>
        <div className="sync-transport">
          <button className="button" onClick={() => onSeek(0)} title="Restart">
            ⏮
          </button>
          <button className="button primary" onClick={isPlaying ? onPause : onPlay}>
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <input
            type="range"
            className="seek-bar"
            min={0}
            max={duration || 0}
            step={0.01}
            value={Math.min(currentTime, duration || 0)}
            onChange={(e) => onSeek(Number(e.target.value))}
            disabled={duration === 0}
            style={{ ['--seek-progress' as string]: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
          />
          <span className="time">{formatTime(currentTime)}</span>
        </div>
        <ul className="sync-lines">
          {syncLines.map((line, i) => {
            const value = times[i];
            const done = value !== null;
            const isNext = i === nextUntimedIndex;
            return (
              <li key={i} className={`sync-line ${isNext ? 'next' : ''} ${done ? 'done' : ''}`}>
                <button className="sync-tap" onClick={() => tapLine(i)} title="Set to current playback position">
                  Tap
                </button>
                <div className="sync-time-adjust">
                  <button type="button" className="sync-nudge" disabled={!done} onClick={() => nudgeLine(i, -0.5)} title="-0.5s">
                    −
                  </button>
                  <input
                    type="number"
                    className="sync-time-input"
                    step={0.1}
                    min={0}
                    placeholder="—"
                    value={value === null ? '' : Math.round(value * 100) / 100}
                    onChange={(e) => {
                      const parsed = Number(e.target.value);
                      setLineTime(i, e.target.value === '' || Number.isNaN(parsed) ? null : parsed);
                    }}
                  />
                  <button type="button" className="sync-nudge" disabled={!done} onClick={() => nudgeLine(i, 0.5)} title="+0.5s">
                    +
                  </button>
                </div>
                <span className="sync-line-text">{line}</span>
              </li>
            );
          })}
        </ul>
        <div className="player-actions">
          <button className="button" onClick={() => setTimes(syncLines.map(() => null))}>
            Reset all
          </button>
          <button className="button" onClick={() => setMode('paste')}>
            Edit text
          </button>
          <button className="button primary" onClick={saveTiming} disabled={nextUntimedIndex !== -1}>
            Save timing
          </button>
          {alignControl}
          {transcribeControl}
        </div>
        {transcribeStatus}
      </div>
    );
  }

  return (
    <div className="lyrics-panel">
      <h3>Lyrics</h3>
      {track.lyrics_source === 'whisper-draft' && (
        <div className="callout-inline">
          Auto-transcribed draft — likely to contain errors.{' '}
          <button className="button" onClick={() => setMode('paste')}>
            Edit lyrics
          </button>
        </div>
      )}
      {track.lyrics_source === 'auto-aligned' && (
        <div className="callout-inline">
          Timing auto-aligned to the vocal track — a starting point, review before relying on it.{' '}
          <button className="button" onClick={() => setMode('sync')}>
            Fix timing
          </button>
        </div>
      )}
      <div className="karaoke-display">
        {viewLines.map((line, i) => (
          <p
            key={i}
            ref={i === activeIndex ? activeLineRef : undefined}
            className={i === activeIndex ? 'karaoke-active' : i < activeIndex ? 'karaoke-past' : 'karaoke-future'}
          >
            {line.text}
          </p>
        ))}
      </div>
      <div className="player-actions">
        <button className="button" onClick={() => setMode('sync')}>
          Fix timing
        </button>
        <button className="button" onClick={() => setMode('paste')}>
          Edit text
        </button>
        {alignControl}
        {transcribeControl}
      </div>
      {transcribeStatus}
    </div>
  );
}
