import type { Stem } from '../api/client';
import type { StemState } from '../hooks/useMixerPlayer';
import { STEM_LABELS } from '../stems';

export function StemMixer({
  stems,
  stemState,
  soloStem,
  onVolumeChange,
  onPanChange,
  onToggleMute,
  onToggleSolo,
}: {
  stems: Stem[];
  stemState: Partial<Record<Stem, StemState>>;
  soloStem: Stem | null;
  onVolumeChange: (stem: Stem, volume: number) => void;
  onPanChange: (stem: Stem, pan: number) => void;
  onToggleMute: (stem: Stem) => void;
  onToggleSolo: (stem: Stem) => void;
}) {
  return (
    <div className="mixer">
      {stems.map((stem) => {
        const state = stemState[stem];
        if (!state) return null;
        return (
          <div key={stem} className="mixer-channel">
            <div className="mixer-channel-header">
              <span className="mixer-channel-name">{STEM_LABELS[stem]}</span>
              <div className="mixer-channel-buttons">
                <button
                  className={`mixer-toggle ${state.muted ? 'active mute' : ''}`}
                  title="Mute"
                  onClick={() => onToggleMute(stem)}
                >
                  M
                </button>
                <button
                  className={`mixer-toggle ${soloStem === stem ? 'active solo' : ''}`}
                  title="Solo"
                  onClick={() => onToggleSolo(stem)}
                >
                  S
                </button>
              </div>
            </div>
            <label className="mixer-row">
              <span>Vol</span>
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.01}
                value={state.volume}
                onChange={(e) => onVolumeChange(stem, Number(e.target.value))}
              />
            </label>
            <label className="mixer-row">
              <span>Pan</span>
              <input
                type="range"
                min={-1}
                max={1}
                step={0.1}
                value={state.pan}
                onChange={(e) => onPanChange(stem, Number(e.target.value))}
              />
            </label>
          </div>
        );
      })}
    </div>
  );
}
