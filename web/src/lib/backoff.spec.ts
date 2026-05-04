import { describe, expect, it } from 'vitest';
import {
  BACKOFF_CAP_MS,
  BACKOFF_JITTER,
  BACKOFF_SERIES_MS,
  nextBackoffMs,
} from './backoff';

describe('nextBackoffMs', () => {
  it('returns the series base values when rng() === 0.5 (zero jitter)', () => {
    const rng = () => 0.5;
    for (let i = 0; i < BACKOFF_SERIES_MS.length; i++) {
      expect(nextBackoffMs(i, { rng })).toBe(BACKOFF_SERIES_MS[i]);
    }
  });

  it('caps at BACKOFF_CAP_MS once attempts exceed the series', () => {
    const rng = () => 0.5;
    expect(nextBackoffMs(BACKOFF_SERIES_MS.length, { rng })).toBe(BACKOFF_CAP_MS);
    expect(nextBackoffMs(BACKOFF_SERIES_MS.length + 5, { rng })).toBe(BACKOFF_CAP_MS);
    expect(nextBackoffMs(99, { rng })).toBe(BACKOFF_CAP_MS);
  });

  it('keeps results within +/-20% jitter band for every series step and the cap', () => {
    const samples = [0, 0.25, 0.5, 0.75, 0.999];
    const inputs = [...BACKOFF_SERIES_MS.map((_, i) => i), BACKOFF_SERIES_MS.length, 50];
    for (const attempt of inputs) {
      const base =
        attempt < BACKOFF_SERIES_MS.length
          ? (BACKOFF_SERIES_MS[attempt] as number)
          : BACKOFF_CAP_MS;
      const lo = Math.round(base * (1 - BACKOFF_JITTER));
      const hi = Math.round(base * (1 + BACKOFF_JITTER));
      for (const r of samples) {
        const ms = nextBackoffMs(attempt, { rng: () => r });
        expect(ms).toBeGreaterThanOrEqual(lo);
        expect(ms).toBeLessThanOrEqual(hi);
      }
    }
  });

  it('floors negative or fractional attempts to 0', () => {
    const rng = () => 0.5;
    expect(nextBackoffMs(-1, { rng })).toBe(BACKOFF_SERIES_MS[0]);
    expect(nextBackoffMs(0.7, { rng })).toBe(BACKOFF_SERIES_MS[0]);
  });

  it('never returns a negative duration even with extreme jitter', () => {
    expect(nextBackoffMs(0, { rng: () => 0 })).toBeGreaterThanOrEqual(0);
    expect(nextBackoffMs(99, { rng: () => 0 })).toBeGreaterThanOrEqual(0);
  });
});
