// Control UI Alive page: smooths raw PCM RMS levels into a perceptually
// linear 0..1 value suitable for driving a visual (the 3D sphere's scale).
//
// Constants mirror apps/macos/Sources/OpenClaw/MicLevelMonitor.swift so the
// web orb feels like the native mic-level orb: an exponential moving average
// plus a throttled publish (time OR delta gated) so the UI doesn't re-render
// on every raw audio-processor callback (~every 85-256ms depending on
// sample rate / buffer size).

const SMOOTHING_PREVIOUS_WEIGHT = 0.45;
const SMOOTHING_NEW_WEIGHT = 0.55;
const MIN_PUBLISH_INTERVAL_MS = 125;
const MIN_PUBLISH_DELTA = 0.02;
const DB_FLOOR = -50;
const SILENCE_EPSILON = 1e-9;

export function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

/** Maps a linear RMS amplitude (0..1) onto a perceptually-normalized 0..1 level. */
export function normalizeRmsLevel(rms: number): number {
  const db = 20 * Math.log10(Math.max(rms, 0) + SILENCE_EPSILON);
  return clamp01((db - DB_FLOOR) / -DB_FLOOR);
}

export type LevelMeter = {
  /** Feed a raw linear RMS sample; returns the smoothed level if it should be
   * published now (time or delta threshold crossed), or null to skip a render. */
  push(rms: number, nowMs?: number): number | null;
  /** Current smoothed level without affecting publish throttling. */
  current(): number;
  reset(): void;
};

export function createLevelMeter(): LevelMeter {
  let smoothed = 0;
  let lastPublished = 0;
  let lastPublishedAtMs = 0;

  return {
    push(rms: number, nowMs = Date.now()): number | null {
      const normalized = normalizeRmsLevel(rms);
      smoothed = smoothed * SMOOTHING_PREVIOUS_WEIGHT + normalized * SMOOTHING_NEW_WEIGHT;
      const elapsed = nowMs - lastPublishedAtMs;
      const delta = Math.abs(smoothed - lastPublished);
      if (elapsed < MIN_PUBLISH_INTERVAL_MS && delta < MIN_PUBLISH_DELTA) {
        return null;
      }
      lastPublished = smoothed;
      lastPublishedAtMs = nowMs;
      return smoothed;
    },
    current(): number {
      return smoothed;
    },
    reset(): void {
      smoothed = 0;
      lastPublished = 0;
      lastPublishedAtMs = 0;
    },
  };
}
