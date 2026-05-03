export interface BackoffOptions {
  baseMs?: number;
  capMs?: number;
  jitter?: number;
  random?: () => number;
}

/**
 * Exponential backoff with optional symmetric jitter.
 *
 * `attempt` is 0-based (0 → baseMs). Series with defaults:
 * 1s, 2s, 4s, 8s, 16s, 30s, 30s, ... (each multiplied by [1-jitter, 1+jitter]).
 */
export function nextBackoffMs(attempt: number, opts: BackoffOptions = {}): number {
  const base = opts.baseMs ?? 1000;
  const cap = opts.capMs ?? 30_000;
  const jitter = opts.jitter ?? 0.2;
  const rand = opts.random ?? Math.random;
  const safeAttempt = Math.max(0, Math.floor(attempt));
  const exp = Math.min(cap, base * 2 ** safeAttempt);
  const factor = 1 + (rand() * 2 - 1) * jitter;
  return Math.max(0, Math.round(exp * factor));
}
