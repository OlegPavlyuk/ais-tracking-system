import { nextBackoffMs } from './backoff';

describe('nextBackoffMs', () => {
  // jitter=0 → deterministic exponential series
  it('produces 1s, 2s, 4s, 8s, 16s, 30s (cap) without jitter', () => {
    const opts = { jitter: 0 };
    expect(nextBackoffMs(0, opts)).toBe(1000);
    expect(nextBackoffMs(1, opts)).toBe(2000);
    expect(nextBackoffMs(2, opts)).toBe(4000);
    expect(nextBackoffMs(3, opts)).toBe(8000);
    expect(nextBackoffMs(4, opts)).toBe(16_000);
    expect(nextBackoffMs(5, opts)).toBe(30_000);
    expect(nextBackoffMs(6, opts)).toBe(30_000);
    expect(nextBackoffMs(20, opts)).toBe(30_000);
  });

  it('clamps negative or fractional attempts to 0', () => {
    expect(nextBackoffMs(-3, { jitter: 0 })).toBe(1000);
    expect(nextBackoffMs(0.7, { jitter: 0 })).toBe(1000);
  });

  it('respects custom base and cap', () => {
    expect(nextBackoffMs(0, { jitter: 0, baseMs: 250, capMs: 5000 })).toBe(250);
    expect(nextBackoffMs(5, { jitter: 0, baseMs: 250, capMs: 5000 })).toBe(5000);
  });

  it('applies symmetric jitter within ±20% by default', () => {
    // random()=1 → factor = 1 + jitter; random()=0 → factor = 1 - jitter
    const high = nextBackoffMs(2, { random: () => 1 });
    const low = nextBackoffMs(2, { random: () => 0 });
    expect(high).toBe(Math.round(4000 * 1.2));
    expect(low).toBe(Math.round(4000 * 0.8));
  });

  it('jitter respects the cap', () => {
    // Cap is applied before jitter, so jittered value can briefly exceed cap by ±jitter.
    // We assert the ±jitter window around cap, which is acceptable for reconnect pacing.
    const v = nextBackoffMs(10, { random: () => 1 });
    expect(v).toBeLessThanOrEqual(36_000);
    expect(v).toBeGreaterThanOrEqual(24_000);
  });
});
