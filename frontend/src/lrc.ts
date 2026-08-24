import type { LyricLine } from './api/client';

const LRC_LINE = /^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/;

export function parseLrc(text: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of text.split('\n')) {
    const match = LRC_LINE.exec(raw.trim());
    if (!match) continue;
    const [, minutes, seconds, lyric] = match;
    lines.push({ time: Number(minutes) * 60 + Number(seconds), text: lyric.trim() });
  }
  return lines.sort((a, b) => a.time - b.time);
}

export function buildLrc(lines: LyricLine[]): string {
  return [...lines]
    .sort((a, b) => a.time - b.time)
    .map((line) => {
      const time = Math.max(0, line.time);
      const minutes = Math.floor(time / 60);
      const seconds = time % 60;
      return `[${String(minutes).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}]${line.text}`;
    })
    .join('\n');
}

/** Index of the currently active line for a given playback position. */
export function activeLineIndex(lines: LyricLine[], currentTime: number): number {
  let active = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= currentTime) active = i;
    else break;
  }
  return active;
}

/**
 * Carries timestamps over from a previous sync when the lyric text is
 * edited — a spelling fix, an added humming line, a removed line. Each new
 * line keeps the old timestamp of the next not-yet-consumed identical-text
 * line (so a repeated chorus still lines up in order); anything genuinely
 * new comes back unset (null), needing a fresh tap. Re-tapping timing from
 * scratch after every small text edit doesn't make sense.
 */
export function mergeTimings(previousLines: LyricLine[], newTexts: string[]): (number | null)[] {
  const queueByText = new Map<string, number[]>();
  for (const line of previousLines) {
    const queue = queueByText.get(line.text) ?? [];
    queue.push(line.time);
    queueByText.set(line.text, queue);
  }
  return newTexts.map((text) => {
    const queue = queueByText.get(text);
    if (queue && queue.length > 0) return queue.shift() as number;
    return null;
  });
}
