export const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function pitchClassIndex(name: string): number | null {
  const idx = PITCH_CLASSES.indexOf(name);
  return idx === -1 ? null : idx;
}

/** "C# minor" -> "C#" */
export function keyRoot(key: string): string | null {
  const root = key.trim().split(/\s+/)[0];
  return PITCH_CLASSES.includes(root) ? root : null;
}

/** Smallest-distance semitone shift (±6) to move a detected key's root to a target pitch class. */
export function suggestedPitchShift(detectedKey: string, targetPitchClass: string): number {
  const from = pitchClassIndex(keyRoot(detectedKey) ?? '');
  const to = pitchClassIndex(targetPitchClass);
  if (from === null || to === null) return 0;
  let diff = (to - from) % 12;
  if (diff > 6) diff -= 12;
  if (diff < -6) diff += 12;
  return diff;
}
