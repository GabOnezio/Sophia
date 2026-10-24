// Control UI chat module implements realtime talk audio behavior.
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function floatToPcm16(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return bytes;
}

function pcm16ToFloat(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Float32Array(Math.floor(bytes.byteLength / 2));
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return samples;
}

/** RMS + peak (both 0..1) over a block of float PCM samples. */
export function measurePcmLevel(samples: Float32Array): { rms: number; peak: number } {
  let sumSquares = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i] ?? 0;
    sumSquares += value * value;
    const magnitude = Math.abs(value);
    if (magnitude > peak) {
      peak = magnitude;
    }
  }
  const rms = samples.length > 0 ? Math.sqrt(sumSquares / samples.length) : 0;
  return { rms, peak };
}

export class RealtimeTalkPcmOutputQueue {
  private playhead = 0;
  private readonly sources = new Set<AudioBufferSourceNode>();

  /** When set, playback connects here instead of straight to
   * outputContext.destination — lets a caller (e.g. the Alive page) route
   * output through a PannerNode for distance-based spatial audio. Left
   * null, behavior is unchanged (Chat page never sets this). */
  spatialDestination: AudioNode | null = null;

  constructor(private readonly onLevel?: (rms: number, peak: number) => void) {}

  get queuedUntil(): number {
    return this.playhead;
  }

  get isPlaying(): boolean {
    return this.sources.size > 0;
  }

  play(base64: string, outputContext: AudioContext | null, outputSampleRateHz: number): void {
    if (!outputContext) {
      return;
    }
    const samples = pcm16ToFloat(base64ToBytes(base64));
    if (samples.length === 0) {
      return;
    }
    if (this.onLevel) {
      const { rms, peak } = measurePcmLevel(samples);
      this.onLevel(rms, peak);
    }
    const buffer = outputContext.createBuffer(1, samples.length, outputSampleRateHz);
    buffer.getChannelData(0).set(samples);
    const source = outputContext.createBufferSource();
    this.sources.add(source);
    source.addEventListener("ended", () => this.sources.delete(source));
    source.buffer = buffer;
    source.connect(this.spatialDestination ?? outputContext.destination);
    const startAt = Math.max(outputContext.currentTime, this.playhead);
    source.start(startAt);
    this.playhead = startAt + buffer.duration;
  }

  stop(outputContext: AudioContext | null): void {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {}
    }
    this.sources.clear();
    this.playhead = outputContext?.currentTime ?? 0;
  }
}
