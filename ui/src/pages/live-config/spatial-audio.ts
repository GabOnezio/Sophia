// Control UI "Configuração Viva": pure logic for the Alive page's spatial
// audio distance settings (talk.realtime.spatialAudio) — how fast the
// voice's volume falls off as the camera moves away from the orb in the
// Alive page's 3D scene. Shared by the settings form here and by the Alive
// page itself, which reads these to configure its Web Audio PannerNode.

export type SpatialAudioSettings = {
  /** Distance (world units) at which volume starts falling off. */
  refDistance: number;
  /** Distance (world units) beyond which the falloff calculation stops increasing. */
  maxDistance: number;
  /** Falloff steepness past refDistance — lower is more gradual. */
  rolloffFactor: number;
};

export const SPATIAL_AUDIO_DEFAULTS: SpatialAudioSettings = {
  refDistance: 2,
  maxDistance: 16,
  rolloffFactor: 1.4,
};

export const SPATIAL_AUDIO_FIELD_LIMITS: Record<keyof SpatialAudioSettings, { min: number; max: number; step: number }> = {
  refDistance: { min: 0.5, max: 30, step: 0.5 },
  maxDistance: { min: 1, max: 100, step: 1 },
  rolloffFactor: { min: 0, max: 10, step: 0.1 },
};

function readNumberField(
  record: Record<string, unknown> | undefined,
  key: keyof SpatialAudioSettings,
): number {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : SPATIAL_AUDIO_DEFAULTS[key];
}

/** Reads talk.realtime.spatialAudio, falling back field-by-field to the
 * Alive page's original hardcoded defaults for anything unset. */
export function readSpatialAudioSettings(
  configObject: Record<string, unknown> | null,
): SpatialAudioSettings {
  const talk = configObject?.talk as Record<string, unknown> | undefined;
  const realtime = talk?.realtime as Record<string, unknown> | undefined;
  const spatialAudio = realtime?.spatialAudio as Record<string, unknown> | undefined;
  return {
    refDistance: readNumberField(spatialAudio, "refDistance"),
    maxDistance: readNumberField(spatialAudio, "maxDistance"),
    rolloffFactor: readNumberField(spatialAudio, "rolloffFactor"),
  };
}
