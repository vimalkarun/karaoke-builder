declare module 'soundtouchjs' {
  export interface PitchShifterPlayDetail {
    timePlayed: number;
    formattedTimePlayed: string;
    percentagePlayed: number;
  }

  export class PitchShifter {
    constructor(context: AudioContext, buffer: AudioBuffer, bufferSize?: number);
    tempo: number;
    pitch: number;
    percentagePlayed: number;
    on(event: 'play' | 'end', handler: (detail: PitchShifterPlayDetail) => void): void;
    off(): void;
    connect(node: AudioNode): void;
    disconnect(): void;
  }
}
