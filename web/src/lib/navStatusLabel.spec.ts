import { describe, it, expect } from 'vitest';
import { navStatusLabel } from './navStatusLabel';

describe('navStatusLabel', () => {
  it('returns — for null', () => {
    expect(navStatusLabel(null)).toBe('—');
  });

  it('maps all standard codes 0–15', () => {
    expect(navStatusLabel(0)).toBe('Under way (engine)');
    expect(navStatusLabel(1)).toBe('At anchor');
    expect(navStatusLabel(2)).toBe('Not under command');
    expect(navStatusLabel(3)).toBe('Restricted manoeuvrability');
    expect(navStatusLabel(4)).toBe('Constrained by draught');
    expect(navStatusLabel(5)).toBe('Moored');
    expect(navStatusLabel(6)).toBe('Aground');
    expect(navStatusLabel(7)).toBe('Engaged in fishing');
    expect(navStatusLabel(8)).toBe('Under way sailing');
    expect(navStatusLabel(9)).toBe('Reserved (HSC)');
    expect(navStatusLabel(10)).toBe('Reserved (WIG)');
    expect(navStatusLabel(11)).toBe('Towing astern');
    expect(navStatusLabel(12)).toBe('Pushing ahead / towing alongside');
    expect(navStatusLabel(13)).toBe('Reserved');
    expect(navStatusLabel(14)).toBe('AIS-SART / MOB-AIS / EPIRB-AIS');
    expect(navStatusLabel(15)).toBe('Undefined');
  });

  it('returns Unknown for out-of-range codes', () => {
    expect(navStatusLabel(-1)).toBe('Unknown');
    expect(navStatusLabel(16)).toBe('Unknown');
    expect(navStatusLabel(255)).toBe('Unknown');
  });
});
