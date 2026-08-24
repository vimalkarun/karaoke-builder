import { useEffect, useRef, useState } from 'react';
import {
  api,
  STEMS_FOR_COUNT,
  type Job,
  type SeparationQuality,
  type Stem,
  type StemCount,
  type Track,
} from '../api/client';
import { useMixerPlayer } from '../hooks/useMixerPlayer';
import { BurnVideoDialog } from './BurnVideoDialog';
import { ExportDialog } from './ExportDialog';
import { LyricsPanel } from './LyricsPanel';
import { PracticeMode } from './PracticeMode';
import { StemMixer } from './StemMixer';
import { PITCH_CLASSES, keyRoot, suggestedPitchShift } from '../musicTheory';

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function Player({ track, onTrackChanged }: { track: Track; onTrackChanged: (track: Track) => void }) {
  const player = useMixerPlayer();
  const [pitch, setPitchState] = useState(track.preferred_pitch_semitones);
  const [tempo, setTempoState] = useState(track.preferred_tempo_percent);
  const [stemCount, setStemCount] = useState<StemCount>(track.stem_count);
  const [quality, setQuality] = useState<SeparationQuality>(track.separation_quality);
  const [gpuAvailable, setGpuAvailable] = useState(false);
  const [separateJob, setSeparateJob] = useState<Job | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [showBurnVideo, setShowBurnVideo] = useState(false);
  const [targetKey, setTargetKey] = useState(() => keyRoot(track.musical_key ?? '') ?? 'C');
  const pollRef = useRef<number | null>(null);
  // Player isn't remounted on track switch (that would tear down and
  // rebuild the shared AudioContext) — a separation job's error state has
  // to be scoped manually so it doesn't linger on a different track's view.
  const currentTrackIdRef = useRef(track.id);
  currentTrackIdRef.current = track.id;

  useEffect(() => {
    api
      .systemInfo()
      .then((info) => setGpuAvailable(info.gpu_available))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setPitchState(track.preferred_pitch_semitones);
    setTempoState(track.preferred_tempo_percent);
    setStemCount(track.stem_count);
    setQuality(track.separation_quality);
    setTargetKey(keyRoot(track.musical_key ?? '') ?? 'C');
    setSeparateJob(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id]);

  useEffect(() => {
    if (track.status === 'importing') return;
    const stems: Stem[] = track.status === 'separated' ? STEMS_FOR_COUNT[track.stem_count] : ['original'];
    const urls: Partial<Record<Stem, string>> = {};
    for (const stem of stems) urls[stem] = api.streamUrl(track.id, stem);
    void player.load(urls, pitch, tempo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id, track.status, track.stem_count]);

  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  const handlePitchChange = (value: number) => {
    setPitchState(value);
    player.setPitch(value);
  };

  const handleTempoChange = (value: number) => {
    setTempoState(value);
    player.setTempo(value);
  };

  const saveAsDefault = async () => {
    const updated = await api.updateTrackSettings(track.id, {
      preferred_pitch_semitones: pitch,
      preferred_tempo_percent: tempo,
    });
    onTrackChanged(updated);
  };

  const startSeparation = async () => {
    const trackId = track.id;
    const isCurrentTrack = () => currentTrackIdRef.current === trackId;

    const job = await api.separateTrack(trackId, stemCount, quality);
    if (isCurrentTrack()) setSeparateJob(job);
    onTrackChanged({ ...track, status: 'separating' });

    // Capture this interval's own id rather than the shared pollRef — see
    // the identical note in LyricsPanel.startTranscribe for why a shared
    // ref can clear the wrong job's interval once more than one is in flight.
    const intervalId = window.setInterval(async () => {
      const updatedJob = await api.getJob(job.id);
      if (isCurrentTrack()) setSeparateJob(updatedJob);
      if (updatedJob.status === 'done' || updatedJob.status === 'error') {
        window.clearInterval(intervalId);
        const updatedTrack = await api.getTrack(trackId);
        onTrackChanged(updatedTrack);
      }
    }, 2000);
    pollRef.current = intervalId;
  };

  if (track.status === 'importing') {
    return (
      <div className="player">
        <h2>{track.title}</h2>
        <p className="empty-state">Downloading from YouTube…</p>
      </div>
    );
  }

  const progress = player.duration > 0 ? player.currentTime / player.duration : 0;
  const defaultExportStem: Stem = track.status === 'separated' ? 'instrumental' : 'original';

  return (
    <div className="player">
      <h2>{track.title}</h2>
      {track.artist && <p className="player-artist">{track.artist}</p>}

      {track.status !== 'separated' && (
        <div className="separate-cta">
          <div className="separate-options">
            <label className="field-inline">
              Stems
              <select value={stemCount} onChange={(e) => setStemCount(Number(e.target.value) as StemCount)}>
                <option value={2}>2 — vocals / instrumental</option>
                <option value={4}>4 — vocals / drums / bass / other</option>
                <option value={6}>6 — + piano / guitar</option>
              </select>
            </label>
            {stemCount !== 6 && (
              <label className="field-inline">
                Quality
                <select value={quality} onChange={(e) => setQuality(e.target.value as SeparationQuality)}>
                  <option value="fast">Fast{!gpuAvailable ? ' (recommended on CPU)' : ''}</option>
                  <option value="high">High{gpuAvailable ? ' (GPU detected)' : ' (slow on CPU)'}</option>
                </select>
              </label>
            )}
          </div>
          <button className="button" onClick={startSeparation} disabled={track.status === 'separating'}>
            {track.status === 'separating' ? 'Separating…' : 'Separate'}
          </button>
          {separateJob?.status === 'error' && <p className="error-text">Failed: {separateJob.error_message}</p>}
        </div>
      )}

      <div className="transport">
        <button className="button" onClick={() => player.seek(0)} disabled={player.isLoading} title="Restart">
          ⏮
        </button>
        <button className="button primary" onClick={player.isPlaying ? player.pause : player.play} disabled={player.isLoading}>
          {player.isLoading ? 'Loading…' : player.isPlaying ? 'Pause' : 'Play'}
        </button>
        <input
          type="range"
          className="seek-bar"
          min={0}
          max={player.duration || 0}
          step={0.01}
          value={Math.min(player.currentTime, player.duration || 0)}
          onChange={(e) => player.seek(Number(e.target.value))}
          disabled={player.isLoading || player.duration === 0}
          style={{ ['--seek-progress' as string]: `${progress * 100}%` }}
        />
        <span className="time">
          {formatTime(player.currentTime)} / {formatTime(player.duration)}
        </span>
      </div>

      {player.error && <p className="error-text">{player.error}</p>}

      <label className="field">
        Pitch: {pitch > 0 ? `+${pitch}` : pitch} semitones
        <input type="range" min={-12} max={12} step={0.5} value={pitch} onChange={(e) => handlePitchChange(Number(e.target.value))} />
      </label>

      <label className="field">
        Tempo: {tempo}%
        <input type="range" min={50} max={150} step={1} value={tempo} onChange={(e) => handleTempoChange(Number(e.target.value))} />
      </label>

      {track.musical_key && (
        <div className="key-suggest">
          <span className="key-suggest-detected">
            Detected key: <strong>{track.musical_key}</strong>
            {track.bpm ? ` · ${Math.round(track.bpm)} BPM` : ''}
          </span>
          <label className="field-inline">
            Sing in
            <select value={targetKey} onChange={(e) => setTargetKey(e.target.value)}>
              {PITCH_CLASSES.map((pc) => (
                <option key={pc} value={pc}>
                  {pc}
                </option>
              ))}
            </select>
          </label>
          <button className="button" onClick={() => handlePitchChange(suggestedPitchShift(track.musical_key!, targetKey))}>
            Apply suggested shift ({(() => {
              const shift = suggestedPitchShift(track.musical_key!, targetKey);
              return shift > 0 ? `+${shift}` : shift;
            })()})
          </button>
        </div>
      )}

      {track.status === 'separated' && (
        <StemMixer
          stems={STEMS_FOR_COUNT[track.stem_count]}
          stemState={player.stemState}
          soloStem={player.soloStem}
          onVolumeChange={player.setVolume}
          onPanChange={player.setPan}
          onToggleMute={player.toggleMute}
          onToggleSolo={player.toggleSolo}
        />
      )}

      <div className="player-actions">
        <button className="button" onClick={saveAsDefault}>
          Save as default for this track
        </button>
        <button className="button" onClick={() => setShowExport(true)}>
          Export…
        </button>
        <button className="button" onClick={() => setShowBurnVideo(true)}>
          Burn to video…
        </button>
      </div>

      {showExport && (
        <ExportDialog track={track} initialStem={defaultExportStem} initialPitch={pitch} initialTempo={tempo} onClose={() => setShowExport(false)} />
      )}

      {showBurnVideo && (
        <BurnVideoDialog
          track={track}
          initialStem={defaultExportStem}
          initialPitch={pitch}
          initialTempo={tempo}
          onClose={() => setShowBurnVideo(false)}
        />
      )}

      <LyricsPanel
        track={track}
        onTrackChanged={onTrackChanged}
        currentTime={player.currentTime}
        duration={player.duration}
        isPlaying={player.isPlaying}
        onPlay={player.play}
        onPause={player.pause}
        onSeek={player.seek}
        canTranscribe
      />

      {track.status === 'separated' && (
        <PracticeMode
          track={track}
          onPlay={player.play}
          onPause={player.pause}
          onSeek={player.seek}
          vocalsAvailable
          vocalsMuted={player.stemState.vocals?.muted ?? false}
          onToggleVocalsMute={() => player.toggleMute('vocals')}
        />
      )}
    </div>
  );
}
