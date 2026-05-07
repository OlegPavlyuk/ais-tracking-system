import { describe, it, expect } from 'vitest';
import { markerShape } from './markerShape';

describe('markerShape', () => {
  it('returns circle for At anchor (1)', () => {
    expect(markerShape(1, null)).toBe('circle');
    expect(markerShape(1, 5)).toBe('circle');
  });

  it('returns circle for Moored (5)', () => {
    expect(markerShape(5, null)).toBe('circle');
  });

  it('returns circle for Aground (6)', () => {
    expect(markerShape(6, null)).toBe('circle');
  });

  it('returns arrow for underway codes', () => {
    expect(markerShape(0, 10)).toBe('arrow');
    expect(markerShape(8, 5)).toBe('arrow');
  });

  it('returns arrow for other nav status codes', () => {
    expect(markerShape(2, null)).toBe('arrow'); // Not under command
    expect(markerShape(3, null)).toBe('arrow'); // Restricted manoeuvrability
    expect(markerShape(7, null)).toBe('arrow'); // Engaged in fishing
  });

  it('returns circle when navStatus is null and SOG is at or below threshold', () => {
    expect(markerShape(null, 0)).toBe('circle');
    expect(markerShape(null, 0.3)).toBe('circle');
  });

  it('returns circle when navStatus is 15 (Undefined) and SOG is at or below threshold', () => {
    expect(markerShape(15, 0)).toBe('circle');
    expect(markerShape(15, 0.3)).toBe('circle');
  });

  it('returns arrow when navStatus is null and SOG is above threshold', () => {
    expect(markerShape(null, 0.31)).toBe('arrow');
    expect(markerShape(null, 5)).toBe('arrow');
  });

  it('returns arrow when navStatus is 15 and SOG is above threshold', () => {
    expect(markerShape(15, 0.31)).toBe('arrow');
    expect(markerShape(15, 5)).toBe('arrow');
  });

  it('returns arrow when both navStatus and sog are null', () => {
    expect(markerShape(null, null)).toBe('arrow');
  });

  it('stationary navStatus overrides high SOG', () => {
    expect(markerShape(1, 10)).toBe('circle');
    expect(markerShape(5, 8)).toBe('circle');
  });
});
