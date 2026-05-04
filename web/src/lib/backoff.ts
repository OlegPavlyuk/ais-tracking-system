const SERIES_MS = [1000, 2000, 4000, 8000, 16000];
const CAP_MS = 30000;
const JITTER = 0.2;

export interface BackoffOptions {
  rng?: () => number;
}

// Mirrors backend AISStream adapter: 1s, 2s, 4s, 8s, 16s, then capped at 30s,
// each step +/-20% jitter. attempt is 0-indexed (0 = first retry).
export function nextBackoffMs(attempt: number, opts: BackoffOptions = {}): number {
  const rng = opts.rng ?? Math.random;
  const idx = Math.max(0, Math.floor(attempt));
  const base = idx < SERIES_MS.length ? (SERIES_MS[idx] as number) : CAP_MS;
  const jitterRange = base * JITTER;
  const offset = (rng() * 2 - 1) * jitterRange;
  return Math.max(0, Math.round(base + offset));
}

export const BACKOFF_SERIES_MS = SERIES_MS;
export const BACKOFF_CAP_MS = CAP_MS;
export const BACKOFF_JITTER = JITTER;
