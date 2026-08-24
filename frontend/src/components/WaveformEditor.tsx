import { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin, { type Region } from 'wavesurfer.js/plugins/regions';

/**
 * Visual trim/fade region selection over a waveform (plan §Phase 2 "waveform
 * editor: trim intro/outro"), plus a loop-preview button — useful both for
 * picking an export range and for looping a section during practice.
 * Playback here is always at original pitch/tempo; the pitch-shifted
 * performance mixer is a separate playback engine (see useMixerPlayer).
 */
export function WaveformEditor({
  url,
  trimStart,
  trimEnd,
  onRegionChange,
}: {
  url: string;
  trimStart: number;
  trimEnd: number | null;
  onRegionChange: (start: number, end: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionRef = useRef<Region | null>(null);
  const applyingExternalUpdate = useRef(false);
  const loopRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loop, setLoop] = useState(false);

  useEffect(() => {
    loopRef.current = loop;
  }, [loop]);

  useEffect(() => {
    if (!containerRef.current) return;
    const regions = RegionsPlugin.create();
    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#4f7cff99',
      progressColor: '#4f7cff',
      cursorColor: '#fff',
      height: 64,
      url,
      plugins: [regions],
    });
    wsRef.current = ws;

    ws.on('ready', () => {
      const duration = ws.getDuration();
      const region = regions.addRegion({
        start: trimStart,
        end: trimEnd ?? duration,
        color: 'rgba(79, 124, 255, 0.25)',
        drag: true,
        resize: true,
      });
      regionRef.current = region;
      setReady(true);

      region.on('update-end', () => {
        if (applyingExternalUpdate.current) return;
        onRegionChange(region.start, region.end);
      });
    });

    regions.on('region-out', (region) => {
      if (loopRef.current) void ws.play(region.start, region.end);
    });

    ws.on('play', () => setIsPlaying(true));
    ws.on('pause', () => setIsPlaying(false));
    ws.on('finish', () => setIsPlaying(false));

    return () => {
      ws.destroy();
      wsRef.current = null;
      regionRef.current = null;
      setReady(false);
    };
    // Deliberately only re-init on URL change — trimStart/trimEnd are synced
    // via the effect below so dragging the region doesn't reset itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => {
    const region = regionRef.current;
    if (!region) return;
    const end = trimEnd ?? wsRef.current?.getDuration() ?? region.end;
    if (Math.abs(region.start - trimStart) < 0.01 && Math.abs(region.end - end) < 0.01) return;
    applyingExternalUpdate.current = true;
    region.setOptions({ start: trimStart, end });
    applyingExternalUpdate.current = false;
  }, [trimStart, trimEnd]);

  const togglePlay = () => {
    const ws = wsRef.current;
    const region = regionRef.current;
    if (!ws || !region) return;
    if (ws.isPlaying()) {
      ws.pause();
    } else {
      void ws.play(region.start, region.end);
    }
  };

  return (
    <div className="waveform-editor">
      <div ref={containerRef} className="waveform-container" />
      {ready && (
        <div className="waveform-controls">
          <button type="button" className="button" onClick={togglePlay}>
            {isPlaying ? 'Pause' : 'Preview selection'}
          </button>
          <label className="checkbox-field inline">
            <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
            <span>Loop</span>
          </label>
        </div>
      )}
    </div>
  );
}
