import { describe, it, expect } from 'vitest';
import { shipTypeLabel } from './shipTypeLabel';

describe('shipTypeLabel', () => {
  it('returns — for null', () => {
    expect(shipTypeLabel(null)).toBe('—');
  });

  it('returns Unknown for out-of-range values', () => {
    expect(shipTypeLabel(-1)).toBe('Unknown');
    expect(shipTypeLabel(100)).toBe('Unknown');
    expect(shipTypeLabel(150)).toBe('Unknown');
    expect(shipTypeLabel(256)).toBe('Unknown');
  });

  it('maps common exact codes', () => {
    expect(shipTypeLabel(30)).toBe('Fishing');
    expect(shipTypeLabel(35)).toBe('Military Ops');
    expect(shipTypeLabel(36)).toBe('Sailing');
    expect(shipTypeLabel(37)).toBe('Pleasure Craft');
    expect(shipTypeLabel(52)).toBe('Tug');
    expect(shipTypeLabel(55)).toBe('Law Enforcement');
  });

  it('maps 20–29 to Wing in Ground', () => {
    expect(shipTypeLabel(20)).toBe('Wing in Ground');
    expect(shipTypeLabel(25)).toBe('Wing in Ground');
    expect(shipTypeLabel(29)).toBe('Wing in Ground');
  });

  it('maps 40–49 to High Speed Craft', () => {
    expect(shipTypeLabel(40)).toBe('High Speed Craft');
    expect(shipTypeLabel(45)).toBe('High Speed Craft');
    expect(shipTypeLabel(49)).toBe('High Speed Craft');
  });

  it('maps 60–69 to Passenger', () => {
    expect(shipTypeLabel(60)).toBe('Passenger');
    expect(shipTypeLabel(65)).toBe('Passenger');
    expect(shipTypeLabel(69)).toBe('Passenger');
  });

  it('maps 70–79 to Cargo', () => {
    expect(shipTypeLabel(70)).toBe('Cargo');
    expect(shipTypeLabel(74)).toBe('Cargo');
    expect(shipTypeLabel(79)).toBe('Cargo');
  });

  it('maps 80–89 to Tanker', () => {
    expect(shipTypeLabel(80)).toBe('Tanker');
    expect(shipTypeLabel(84)).toBe('Tanker');
    expect(shipTypeLabel(89)).toBe('Tanker');
  });

  it('maps 90–99 to Other', () => {
    expect(shipTypeLabel(90)).toBe('Other');
    expect(shipTypeLabel(95)).toBe('Other');
    expect(shipTypeLabel(99)).toBe('Other');
  });

  it('returns Unknown for reserved / unassigned codes', () => {
    expect(shipTypeLabel(0)).toBe('Unknown');
    expect(shipTypeLabel(1)).toBe('Unknown');
    expect(shipTypeLabel(19)).toBe('Unknown');
    expect(shipTypeLabel(38)).toBe('Unknown');
    expect(shipTypeLabel(39)).toBe('Unknown');
  });
});
