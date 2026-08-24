import { useRef, useState } from 'react';
import { api, type Track } from '../api/client';

type RecordingState = 'idle' | 'requesting' | 'recording' | 'recorded';

/**
 * Sing over the backing track via mic, then compare against the original
 * vocals (plan §Phase 4). Deliberately client-side only — no server
 * persistence for v1; the take can be downloaded instead.
 */
export function PracticeMode({
  track,
  onPlay,
  onPause,
  onSeek,
  vocalsAvailable,
  vocalsMuted,
  onToggleVocalsMute,
}: {
  track: Track;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (time: number) => void;
  vocalsAvailable: boolean;
  vocalsMuted: boolean;
  onToggleVocalsMute: () => void;
}) {
  const [state, setState] = useState<RecordingState>('idle');
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const wasVocalsMutedRef = useRef(false);

  const startRecording = async () => {
    setError(null);
    setState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        setRecordedUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });
        stream.getTracks().forEach((mediaTrack) => mediaTrack.stop());
      };
      recorderRef.current = recorder;

      // Mute the original vocal so the singer hears only the backing track,
      // restoring whatever the mixer's mute state was before we started.
      wasVocalsMutedRef.current = vocalsMuted;
      if (vocalsAvailable && !vocalsMuted) onToggleVocalsMute();

      onSeek(0);
      recorder.start();
      onPlay();
      setState('recording');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Microphone access was denied.');
      setState('idle');
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    onPause();
    if (vocalsAvailable && !wasVocalsMutedRef.current && vocalsMuted) onToggleVocalsMute();
    setState('recorded');
  };

  const recordAgain = () => {
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    setRecordedUrl(null);
    setState('idle');
  };

  return (
    <div className="lyrics-panel">
      <h3>Practice mode</h3>
      <p className="lyrics-hint">Record yourself singing over the backing track, then compare against the original vocals.</p>

      {state === 'idle' && (
        <button className="button primary" onClick={startRecording}>
          Start recording
        </button>
      )}
      {state === 'requesting' && <p className="empty-state">Waiting for microphone permission…</p>}
      {state === 'recording' && (
        <button className="button primary" onClick={stopRecording}>
          Stop recording
        </button>
      )}

      {error && <p className="error-text">{error}</p>}

      {state === 'recorded' && recordedUrl && (
        <div className="practice-compare">
          <div className="practice-track">
            <span className="mixer-channel-name">Your take</span>
            <audio controls src={recordedUrl} />
            <a className="button" href={recordedUrl} download={`${track.title} - practice take.webm`}>
              Download
            </a>
          </div>
          {vocalsAvailable && (
            <div className="practice-track">
              <span className="mixer-channel-name">Original vocals</span>
              <audio controls src={api.streamUrl(track.id, 'vocals')} />
            </div>
          )}
          <button className="button" onClick={recordAgain}>
            Record again
          </button>
        </div>
      )}
    </div>
  );
}
