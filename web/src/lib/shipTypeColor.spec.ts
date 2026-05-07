import { describe, it, expect } from 'vitest';
import { shipTypeColor, SHIP_TYPE_LEGEND } from './shipTypeColor';

const UNKNOWN_COLOR = '#95A5A6';

describe('shipTypeColor', () => {
  it('returns Unknown color for null', () => {
    expect(shipTypeColor(null)).toBe(UNKNOWN_COLOR);
  });

  it('returns Unknown color for out-of-range values', () => {
    expect(shipTypeColor(-1)).toBe(UNKNOWN_COLOR);
    expect(shipTypeColor(100)).toBe(UNKNOWN_COLOR);
    expect(shipTypeColor(150)).toBe(UNKNOWN_COLOR);
    expect(shipTypeColor(256)).toBe(UNKNOWN_COLOR);
  });

  it('returns correct colors for each category', () => {
    expect(shipTypeColor(70)).toBe('#2ECC71'); // Cargo
    expect(shipTypeColor(79)).toBe('#2ECC71');

    expect(shipTypeColor(80)).toBe('#E53935'); // Tanker
    expect(shipTypeColor(89)).toBe('#E53935');

    expect(shipTypeColor(60)).toBe('#3498DB'); // Passenger
    expect(shipTypeColor(69)).toBe('#3498DB');

    expect(shipTypeColor(30)).toBe('#E67E22'); // Fishing

    expect(shipTypeColor(35)).toBe('#8E44AD'); // Military
    expect(shipTypeColor(55)).toBe('#8E44AD'); // Law Enforcement

    expect(shipTypeColor(52)).toBe('#1ABC9C'); // Tug
    expect(shipTypeColor(31)).toBe('#1ABC9C'); // Towing
    expect(shipTypeColor(58)).toBe('#1ABC9C'); // Medical Transport

    expect(shipTypeColor(40)).toBe('#F1C40F'); // High Speed Craft
    expect(shipTypeColor(49)).toBe('#F1C40F');
    expect(shipTypeColor(20)).toBe('#F1C40F'); // WIG
    expect(shipTypeColor(29)).toBe('#F1C40F');

    expect(shipTypeColor(36)).toBe('#FF4FC3'); // Sailing
    expect(shipTypeColor(37)).toBe('#FF4FC3'); // Pleasure Craft
  });

  it('returns Unknown color for reserved / unassigned codes', () => {
    expect(shipTypeColor(0)).toBe(UNKNOWN_COLOR);
    expect(shipTypeColor(1)).toBe(UNKNOWN_COLOR);
    expect(shipTypeColor(38)).toBe(UNKNOWN_COLOR);
    expect(shipTypeColor(90)).toBe(UNKNOWN_COLOR); // Other → Unknown/Other color
  });
});

describe('SHIP_TYPE_LEGEND', () => {
  it('has 9 entries', () => {
    expect(SHIP_TYPE_LEGEND).toHaveLength(9);
  });

  it('every entry has a non-empty category and a hex color', () => {
    for (const entry of SHIP_TYPE_LEGEND) {
      expect(entry.category.length).toBeGreaterThan(0);
      expect(entry.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
