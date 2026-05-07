import { describe, it, expect } from 'vitest';
import { relativeTime } from './relativeTime';

const NOW = new Date('2025-06-01T12:00:00Z').getTime();
const iso = (ms: number) => new Date(NOW - ms).toISOString();

describe('relativeTime', () => {
  it('returns — for null', () => {
    expect(relativeTime(null, NOW)).toBe('—');
  });

  it('returns — for an unparseable string', () => {
    expect(relativeTime('not-a-date', NOW)).toBe('—');
    expect(relativeTime('', NOW)).toBe('—');
  });

  it('returns just now for future timestamps', () => {
    expect(relativeTime(new Date(NOW + 5000).toISOString(), NOW)).toBe('just now');
  });

  it('returns < 1 min ago for less than 60 seconds', () => {
    expect(relativeTime(iso(0), NOW)).toBe('< 1 min ago');
    expect(relativeTime(iso(59_000), NOW)).toBe('< 1 min ago');
  });

  it('returns N min ago for minutes under an hour', () => {
    expect(relativeTime(iso(60_000), NOW)).toBe('1 min ago');
    expect(relativeTime(iso(5 * 60_000), NOW)).toBe('5 min ago');
    expect(relativeTime(iso(59 * 60_000), NOW)).toBe('59 min ago');
  });

  it('returns N h ago for hours under a day', () => {
    expect(relativeTime(iso(60 * 60_000), NOW)).toBe('1 h ago');
    expect(relativeTime(iso(3 * 60 * 60_000), NOW)).toBe('3 h ago');
    expect(relativeTime(iso(23 * 60 * 60_000), NOW)).toBe('23 h ago');
  });

  it('returns N d ago for 24+ hours', () => {
    expect(relativeTime(iso(24 * 60 * 60_000), NOW)).toBe('1 d ago');
    expect(relativeTime(iso(3 * 24 * 60 * 60_000), NOW)).toBe('3 d ago');
  });
});
