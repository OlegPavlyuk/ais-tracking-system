import { describe, it, expect } from 'vitest';
import { shipTypeLabel } from './shipTypeLabel';

describe('shipTypeLabel', () => {
  it('returns Cargo for code 70', () => {
    expect(shipTypeLabel(70)).toBe('Cargo');
  });

  it('returns Tanker for code 80', () => {
    expect(shipTypeLabel(80)).toBe('Tanker');
  });

  it('returns Passenger for code 60', () => {
    expect(shipTypeLabel(60)).toBe('Passenger');
  });

  it('returns Type 99 for unknown code 99', () => {
    expect(shipTypeLabel(99)).toBe('Type 99');
  });

  it('returns — for null', () => {
    expect(shipTypeLabel(null)).toBe('—');
  });
});
