import { useCallback, useEffect, useRef, useState } from 'react';
import { PitchShifter } from 'soundtouchjs';
import type { Stem } from '../api/client';

const semitonesToRatio = (semitones: number) => Math.pow(2, semitones / 12);

interface Channel {
  shifter: PitchShifter;
  gain: GainNode;
  panner: StereoPannerNode;
}

export interface StemState {
  volume: number; // 0-1
  muted: boolean;
  pan: number; // -1..1
}

/**
 * Plays one or more stems in sync, each through its own volume/pan/mute
 * chain (the per-stem mixer, plan §Phase 2), with pitch/tempo applied
 * uniformly across every stem so they stay musically in sync. A single-stem
 * load (e.g. "original" before separation) is just the N=1 case.
 *
 * Real-time preview only — see backend/app/services/audio.py for the
 * higher-fidelity Rubber Band bake used at export time.
 */
export function useMixerPlayer() {
  const ctxRef = useRef<AudioContext | null>(null);
  const channelsRef = useRef<Map<Stem, Channel>>(new Map());
  const primaryStemRef = useRef<Stem | null>(null);
  const durationRef = useRef(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [stemState, setStemState] = useState<Partial<Record<Stem, StemState>>>({});
  const [soloStem, setSoloStem] = useState<Stem | null>(null);

  const ensureContext = () => {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    return ctxRef.current;
  };

  const teardown = useCallback(() => {
    channelsRef.current.forEach((ch) => {
      ch.shifter.off();
      try {
        ch.shifter.disconnect();
      } catch {
        /* already disconnected */
      }
    });
    channelsRef.current.clear();
    primaryStemRef.current = null;
    durationRef.current = 0;
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setStemState({});
    setSoloStem(null);
  }, []);

  const load = useCallback(
    async (stemUrls: Partial<Record<Stem, string>>, pitchSemitones: number, tempoPercent: number) => {
      teardown();
      setError(null);
      setIsLoading(true);
      try {
        const ctx = ensureContext();
        const entries = Object.entries(stemUrls) as [Stem, string][];
        if (entries.length === 0) throw new Error('No stems to load');

        const pitchRatio = semitonesToRatio(pitchSemitones);
        const tempoRatio = tempoPercent / 100;
        const initialState: Partial<Record<Stem, StemState>> = {};

        // Fetch + decode every stem in parallel — sequential loading of a
        // 6-stem, multi-minute track took 20s+ end to end.
        const decoded = await Promise.all(
          entries.map(async ([stem, url]) => {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Failed to fetch ${stem} (${res.status})`);
            const arrayBuffer = await res.arrayBuffer();
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
            return [stem, audioBuffer] as const;
          }),
        );

        let maxDuration = 0;
        for (const [stem, audioBuffer] of decoded) {
          maxDuration = Math.max(maxDuration, audioBuffer.duration);

          const shifter = new PitchShifter(ctx, audioBuffer, 4096);
          shifter.tempo = tempoRatio;
          shifter.pitch = pitchRatio;

          const gain = ctx.createGain();
          const panner = ctx.createStereoPanner();
          gain.connect(panner);
          panner.connect(ctx.destination);

          channelsRef.current.set(stem, { shifter, gain, panner });
          initialState[stem] = { volume: 1, muted: false, pan: 0 };
        }

        // Only one channel needs to drive the shared playback clock.
        const primary = entries[0][0];
        primaryStemRef.current = primary;
        channelsRef.current.get(primary)?.shifter.on('play', (detail) => setCurrentTime(detail.timePlayed));

        durationRef.current = maxDuration;
        setDuration(maxDuration);
        setStemState(initialState);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsLoading(false);
      }
    },
    [teardown],
  );

  // Sync actual audio-graph gain/pan whenever mixer state changes.
  useEffect(() => {
    channelsRef.current.forEach((ch, stem) => {
      const s = stemState[stem];
      if (!s) return;
      const silenced = soloStem ? soloStem !== stem : s.muted;
      ch.gain.gain.value = silenced ? 0 : s.volume;
      ch.panner.pan.value = s.pan;
    });
  }, [stemState, soloStem]);

  const play = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx || channelsRef.current.size === 0) return;
    channelsRef.current.forEach((ch) => ch.shifter.connect(ch.gain));
    void ctx.resume();
    setIsPlaying(true);
  }, []);

  const pause = useCallback(() => {
    channelsRef.current.forEach((ch) => {
      try {
        ch.shifter.disconnect();
      } catch {
        /* already disconnected */
      }
    });
    setIsPlaying(false);
  }, []);

  const seek = useCallback((time: number) => {
    const duration = durationRef.current;
    if (duration <= 0 || channelsRef.current.size === 0) return;
    const clamped = Math.max(0, Math.min(time, duration));
    // soundtouchjs's PitchShifter supports seeking via percentagePlayed —
    // it just repositions the internal frame cursor, safe whether playing
    // or paused. NOTE: despite the name (and despite the getter returning a
    // 0-100 scale), the setter's own math has no /100 in it, so it actually
    // wants a 0-1 fraction — passing 0-100 here overshoots the buffer by up
    // to 100x and silently clamps to the end. Every channel is seeked
    // together to stay in sync.
    const fraction = clamped / duration;
    channelsRef.current.forEach((ch) => {
      ch.shifter.percentagePlayed = fraction;
    });
    setCurrentTime(clamped);
  }, []);

  const setPitch = useCallback((semitones: number) => {
    const ratio = semitonesToRatio(semitones);
    channelsRef.current.forEach((ch) => (ch.shifter.pitch = ratio));
  }, []);

  const setTempo = useCallback((percent: number) => {
    const ratio = percent / 100;
    channelsRef.current.forEach((ch) => (ch.shifter.tempo = ratio));
  }, []);

  const setVolume = useCallback((stem: Stem, volume: number) => {
    setStemState((prev) => ({ ...prev, [stem]: { ...(prev[stem] as StemState), volume } }));
  }, []);

  const setPan = useCallback((stem: Stem, pan: number) => {
    setStemState((prev) => ({ ...prev, [stem]: { ...(prev[stem] as StemState), pan } }));
  }, []);

  const toggleMute = useCallback((stem: Stem) => {
    setStemState((prev) => {
      const current = prev[stem] as StemState;
      return { ...prev, [stem]: { ...current, muted: !current.muted } };
    });
  }, []);

  const toggleSolo = useCallback((stem: Stem) => {
    setSoloStem((prev) => (prev === stem ? null : stem));
  }, []);

  useEffect(() => teardown, [teardown]);

  return {
    load,
    play,
    pause,
    seek,
    teardown,
    setPitch,
    setTempo,
    setVolume,
    setPan,
    toggleMute,
    toggleSolo,
    isPlaying,
    isLoading,
    duration,
    currentTime,
    error,
    stemState,
    soloStem,
  };
}
