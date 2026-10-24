// Control UI test covers Alive page audio-level smoothing/throttling.
import { describe, expect, it } from "vitest";
import { clamp01, createLevelMeter, normalizeRmsLevel } from "./audio-level-meter.ts";

describe("clamp01", () => {
  it("clamps out-of-range and NaN values", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(Number.NaN)).toBe(0);
  });
});

describe("normalizeRmsLevel", () => {
  it("maps silence near zero and full-scale RMS near one", () => {
    expect(normalizeRmsLevel(0)).toBe(0);
    expect(normalizeRmsLevel(1)).toBeCloseTo(1, 5);
  });

  it("is monotonically increasing with amplitude", () => {
    const quiet = normalizeRmsLevel(0.001);
    const medium = normalizeRmsLevel(0.05);
    const loud = normalizeRmsLevel(0.3);
    expect(quiet).toBeLessThan(medium);
    expect(medium).toBeLessThan(loud);
  });
});

describe("createLevelMeter", () => {
  it("publishes the first sample immediately", () => {
    const meter = createLevelMeter();
    const result = meter.push(0.2, 1_000);
    expect(result).not.toBeNull();
    expect(result).toBeGreaterThan(0);
  });

  it("throttles rapid, low-delta updates within the min interval", () => {
    const meter = createLevelMeter();
    // Let the EMA converge on a steady level first — otherwise even a tiny
    // change in raw RMS still produces a large jump in the smoothed value,
    // since the first couple of samples are still catching up from zero.
    for (let i = 0; i < 20; i += 1) {
      meter.push(0.2, 1_000 + i);
    }
    const throttled = meter.push(0.201, 1_020);
    expect(throttled).toBeNull();
  });

  it("publishes again once the min interval elapses", () => {
    const meter = createLevelMeter();
    meter.push(0.2, 1_000);
    const later = meter.push(0.2, 1_200);
    expect(later).not.toBeNull();
  });

  it("publishes early when the delta is large enough, even inside the interval", () => {
    const meter = createLevelMeter();
    meter.push(0.01, 1_000);
    const jump = meter.push(0.9, 1_020);
    expect(jump).not.toBeNull();
  });

  it("smooths toward louder input rather than jumping instantly", () => {
    const meter = createLevelMeter();
    meter.push(0.01, 1_000);
    const before = meter.current();
    meter.push(0.9, 2_000);
    const after = meter.current();
    expect(after).toBeGreaterThan(before);
    expect(after).toBeLessThan(normalizeRmsLevel(0.9));
  });

  it("reset() clears smoothed state and publish throttling", () => {
    const meter = createLevelMeter();
    meter.push(0.5, 1_000);
    meter.reset();
    expect(meter.current()).toBe(0);
    const result = meter.push(0.5, 1_001);
    expect(result).not.toBeNull();
  });
});
